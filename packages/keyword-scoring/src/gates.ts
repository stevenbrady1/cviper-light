/**
 * Eligibility and language gates — the checks that run BEFORE the score and
 * are never averaged into it (L-156).
 *
 * ============================================================================
 * WHY A GATE, AND WHY IT IS NOT A NUMBER
 * ============================================================================
 * A 78-out-of-100 match on an advert that says "must be a UK citizen" is a
 * lie of omission for a candidate who needs sponsorship. The score measures
 * how well the CV's words fit the advert's words; it has nothing to say about
 * whether the user is allowed to apply at all, and folding "not allowed" into
 * a percentage would produce a 40 that reads as "needs work" when the honest
 * answer is "do not spend the evening on this one". So the gate is a separate
 * verdict, computed from the ADVERT and the PROFILE — never from the CV — and
 * `match_score` is untouched by it.
 *
 * ============================================================================
 * CONSERVATIVE ON PURPOSE. SILENCE IS NEVER A FAIL.
 * ============================================================================
 * The gate is the one place the app is allowed to say "hard stop", so a false
 * positive costs the user an application. Every rule below therefore errs
 * towards `flag` — "check this yourself" — and reaches `fail` only when BOTH
 * documents speak: the advert states a requirement AND the profile states
 * the opposite. An advert that says nothing passes. A profile that says
 * nothing flags. A requirement that is only "nice to have" can never fail.
 * Clearance never passes, even for a citizen: clearance is granted after
 * vetting, not held by right, and the app cannot know it was.
 *
 * ============================================================================
 * PURE, LIKE THE SCORER
 * ============================================================================
 * No network, no clock, no randomness, no lexicon file. Same input, same
 * output — `gates.test.ts` pins that. The sentence is the unit of evidence:
 * a requirement is a language name and a bar word in the SAME sentence, and
 * the sentence is what gets quoted back so the user can read the advert's own
 * words rather than trust a label.
 *
 * Language names are matched CAPITALISED (or all-caps) and only when the
 * sentence also carries a bar or soft word. "polish the deliverables" is a
 * verb; "Polish" at the start of a sentence followed by an object is still a
 * verb; "Fluent Polish is essential" is a requirement. Profile names match
 * case-insensitively and exactly — "Chinese" does not satisfy "Mandarin",
 * because guessing which Chinese the advert means is the user's call.
 */
import { type ProfileLanguage } from '@cviper/core-types';

import { escapeRegExp } from './spelling';

export type GateKind = 'eligibility' | 'language';
export type GateVerdict = 'pass' | 'fail' | 'flag';

export interface GateResult {
  readonly kind: GateKind;
  readonly verdict: GateVerdict;
  /** The advert's own sentence, or `null` when the advert was silent. */
  readonly quote: string | null;
  /** The language a `language` result is about; `null` for eligibility. */
  readonly language: string | null;
  /** One or two plain sentences saying why, addressed to the user. */
  readonly reason: string;
}

export interface GateInput {
  readonly advertText: string;
  readonly languages: readonly ProfileLanguage[];
  /** The profile's free-text work-rights line, or `null`. */
  readonly workRights: string | null;
}

/** Longest quote returned, in characters, including the ellipsis. */
export const GATE_QUOTE_MAX_CHARS = 200;

export const SILENT_ELIGIBILITY_REASON =
  'The advert states no citizenship, residency or clearance requirement.';

// ── Sentences ────────────────────────────────────────────────────────────────

/**
 * The advert as trimmed sentences. Split on sentence punctuation, line breaks
 * and bullet glyphs, because adverts are lists more often than they are prose
 * and a requirements bullet rarely ends in a full stop.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|[\r\n]+|[•·▪◦►]/u)
    .map((sentence) => sentence.replace(/\s+/gu, ' ').trim())
    .filter((sentence) => sentence.length > 0);
}

function quoteOf(sentence: string): string {
  if (sentence.length <= GATE_QUOTE_MAX_CHARS) return sentence;
  return sentence.slice(0, GATE_QUOTE_MAX_CHARS - 1).trimEnd() + '…';
}

// ── Eligibility ──────────────────────────────────────────────────────────────

type RequirementKind = 'citizenship' | 'residency' | 'sponsorship' | 'clearance';

/**
 * What an advert says when it is closing the door. Each pattern is the SHAPE
 * of a requirement, not a keyword: "citizens" alone appears in "citizens of
 * every country", so citizenship needs a bar word in the sentence too.
 */
const REQUIREMENT_PATTERNS: readonly (readonly [RequirementKind, RegExp])[] = [
  ['citizenship', /\bcitizens?\s+only\b/iu],
  ['citizenship', /\bcitizenship\b.*\b(?:required?|requirements?|essential|must|only|needed)\b/iu],
  [
    'citizenship',
    /\b(?:must|required?|requires|requirement|needs?|need to|only|essential)\b.*\bcitizens?(?:ship)?\b/iu,
  ],
  [
    'residency',
    /\b(?:must|required?|requires|requirement|needs?|need to|only|essential|hold|holds|holding|have)\b.*\b(?:permanent\s+residen(?:t|ce|cy)|indefinite\s+leave\s+to\s+remain|\bILR\b|(?:pre-)?settled\s+status|green\s+card)/iu,
  ],
  [
    'residency',
    /\b(?:permanent\s+residen(?:t|ce|cy)|indefinite\s+leave\s+to\s+remain|ILR|(?:pre-)?settled\s+status|green\s+card)\b.*\b(?:required?|essential|must|only|needed)\b/iu,
  ],
  ['sponsorship', /\bno\s+(?:visa\s+)?sponsorship\b/iu],
  ['sponsorship', /\bwithout\s+(?:visa\s+)?sponsorship\b/iu],
  [
    'sponsorship',
    /\b(?:cannot|can't|can\s+not|unable\s+to|not\s+able\s+to|will\s+not|won't|do\s+not|don't|does\s+not|doesn't|not\s+in\s+a\s+position\s+to)\s+(?:\w+\s+){0,3}?sponsor/iu,
  ],
  [
    'sponsorship',
    /\bsponsorship\s+(?:is\s+|will\s+be\s+)?(?:not|un)(?:\s+be)?\s*(?:available|offered|provided|possible)\b/iu,
  ],
  [
    'sponsorship',
    /\bright\s+to\s+work\b.*\bwithout\s+(?:any\s+)?(?:restrictions?|sponsorship|limitation)/iu,
  ],
  ['sponsorship', /\bunrestricted\s+right\s+to\s+work\b/iu],
  ['clearance', /\bsecurity\s+clearance\b/iu],
  ['clearance', /\beligible\s+for\s+(?:\w+\s+){0,2}?clearance\b/iu],
  [
    'clearance',
    /\b(?:obtain|hold|holding|undergo|subject\s+to|gain|achieve)\s+(?:\w+\s+){0,3}?clearance\b/iu,
  ],
  // Case-SENSITIVE: the vetting levels are always written as initialisms, and
  // a lowercase "sc" or "dv" in prose is a fragment of something else.
  ['clearance', /\b(?:SC|DV|CTC|BPSS|NPPV)\b/u],
  ['clearance', /\b(?:SC|DV)[- ]cleared\b/iu],
];

interface Requirement {
  readonly kind: RequirementKind;
  readonly sentence: string;
}

function findRequirements(advert: readonly string[]): Requirement[] {
  const found: Requirement[] = [];
  for (const sentence of advert) {
    for (const [kind, pattern] of REQUIREMENT_PATTERNS) {
      if (pattern.test(sentence)) {
        found.push({ kind, sentence });
        break;
      }
    }
  }
  return found;
}

/**
 * What the profile's work-rights line says, in three buckets.
 *
 * A negated need ("no visa needed", "no sponsorship required") is read as a
 * right BEFORE the need patterns run, because "sponsorship" is in both and
 * the negation is the fact. A visa of any kind is read as a need before the
 * right patterns run, because "right to work on a Skilled Worker visa" is a
 * right the advert's "no sponsorship" line has just withdrawn.
 */
type Standing = 'needs-sponsorship' | 'holds-right' | 'unknown';

const NEGATED_NEED =
  /\b(?:no|not|without|never|don't|do\s+not|doesn't|does\s+not|won't)\s+(?:\w+\s+){0,2}?(?:sponsor\w*|visa)\b/iu;
const NEED =
  /\b(?:sponsor\w*|visa|tier\s*2|tier\s*4|skilled\s+worker|graduate\s+route|student\s+route)\b/iu;
const RIGHT =
  /\b(?:citizen\w*|british|ilr|indefinite\s+leave|settled|no\s+restrictions?|unrestricted|without\s+restrictions?|right\s+to\s+work|permanent\s+resident\w*|green\s+card|national)\b/iu;

function standingOf(workRights: string | null): Standing {
  const text = workRights?.trim() ?? '';
  if (text.length === 0) return 'unknown';
  if (NEGATED_NEED.test(text)) return 'holds-right';
  if (NEED.test(text)) return 'needs-sponsorship';
  if (RIGHT.test(text)) return 'holds-right';
  return 'unknown';
}

const REQUIREMENT_NOUN: Record<RequirementKind, string> = {
  citizenship: 'citizenship',
  residency: 'permanent residency',
  sponsorship: 'the right to work without sponsorship',
  clearance: 'security clearance',
};

function eligibilityGate(advert: readonly string[], workRights: string | null): GateResult {
  const requirements = findRequirements(advert);
  const first = requirements[0];
  if (first === undefined) {
    return {
      kind: 'eligibility',
      verdict: 'pass',
      quote: null,
      language: null,
      reason: SILENT_ELIGIBILITY_REASON,
    };
  }

  // Clearance outranks the others for the verdict: it is the one requirement
  // a citizen still cannot claim to meet. Quote the clearance sentence when
  // that is what decides the verdict, otherwise the first requirement found.
  const clearance = requirements.find((requirement) => requirement.kind === 'clearance');
  const standing = standingOf(workRights);
  const base = { kind: 'eligibility' as const, language: null };
  const noun = REQUIREMENT_NOUN[first.kind];

  if (standing === 'unknown') {
    const trimmed = workRights?.trim() ?? '';
    return {
      ...base,
      verdict: 'flag',
      quote: quoteOf((clearance ?? first).sentence),
      reason:
        trimmed.length === 0
          ? `The advert asks for ${noun}. Your profile does not say what your work rights are.`
          : `The advert asks for ${noun}. Your profile says "${trimmed}", which does not answer it either way — check before you apply.`,
    };
  }

  if (standing === 'needs-sponsorship') {
    return {
      ...base,
      verdict: 'fail',
      quote: quoteOf((clearance ?? first).sentence),
      reason: `The advert asks for ${noun}. Your profile says you need sponsorship, so as written this advert rules you out.`,
    };
  }

  if (clearance !== undefined) {
    return {
      ...base,
      verdict: 'flag',
      quote: quoteOf(clearance.sentence),
      reason:
        'The advert asks for security clearance. Your profile says you have the right to work, but clearance is granted after vetting, not held by right — check whether you hold it or can get it.',
    };
  }

  return {
    ...base,
    verdict: 'pass',
    quote: quoteOf(first.sentence),
    reason: `The advert asks for ${noun}. Your profile says you have the right to work, which answers it.`,
  };
}

// ── Language ─────────────────────────────────────────────────────────────────

/** Display names. Matched capitalised or all-caps; see the header. */
export const LANGUAGE_NAMES: readonly string[] = [
  'English',
  'French',
  'German',
  'Spanish',
  'Italian',
  'Portuguese',
  'Dutch',
  'Polish',
  'Danish',
  'Swedish',
  'Norwegian',
  'Finnish',
  'Russian',
  'Ukrainian',
  'Czech',
  'Hungarian',
  'Romanian',
  'Greek',
  'Turkish',
  'Arabic',
  'Hebrew',
  'Hindi',
  'Urdu',
  'Bengali',
  'Punjabi',
  'Mandarin',
  'Cantonese',
  'Chinese',
  'Japanese',
  'Korean',
  'Thai',
  'Vietnamese',
  'Indonesian',
  'Malay',
  'Tagalog',
  'Swahili',
  'Afrikaans',
  'Welsh',
  'Irish',
  'Gaelic',
];

/** Words that make a language mention a requirement. */
const BAR_WORD =
  /\b(?:fluent|fluency|native|bilingual|business[- ]level|professional|proficien(?:t|cy)|mother\s+tongue|C1|C2|B2|required?|essential|must)\b/iu;

/** Bars that a basic or intermediate profile level does not clear. */
const HIGH_BAR = /\b(?:fluent|fluency|native|bilingual|mother\s+tongue|C1|C2)\b/iu;

/** Words that make the mention a wish rather than a requirement. */
const SOFT_WORD =
  /\b(?:nice[- ]to[- ]have|desirable|a\s+plus|advantageous|an\s+advantage|a\s+bonus|beneficial|preferred|preferable|would\s+be\s+(?:useful|welcome|helpful))\b/iu;

/** Profile levels that do not clear a high bar. */
const LOW_LEVEL = /\b(?:basic|A1|A2|B1|conversational|elementary|intermediate|beginner)\b/iu;

/**
 * A capitalised language name followed by an object is the verb or the
 * adjective, not the language: "Polish the deliverables", "Polish your
 * writing". Only "Polish" has a common English homograph, but the check is
 * cheap and the same shape for every name.
 */
const VERB_OBJECT = /^\s+(?:the|a|an|your|our|my|their|its|it|them|this|these|those|up|off)\b/iu;

const LANGUAGE_PATTERN = new RegExp(
  '\\b(' +
    LANGUAGE_NAMES.map((name) => escapeRegExp(name) + '|' + escapeRegExp(name.toUpperCase())).join(
      '|',
    ) +
    ')\\b',
  'gu',
);

/** The display name for a matched form (`POLISH` → `Polish`). */
function canonicalName(matched: string): string {
  const lower = matched.toLowerCase();
  return LANGUAGE_NAMES.find((name) => name.toLowerCase() === lower) ?? matched;
}

function languagesIn(sentence: string): string[] {
  const names: string[] = [];
  for (const match of sentence.matchAll(LANGUAGE_PATTERN)) {
    const matched = match[1];
    if (matched === undefined) continue;
    const after = sentence.slice(match.index + matched.length);
    if (VERB_OBJECT.test(after)) continue;
    const name = canonicalName(matched);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

interface LanguageRequirement {
  readonly language: string;
  readonly sentence: string;
  /** False when every mention was a wish; true when any was a requirement. */
  readonly hard: boolean;
  readonly highBar: boolean;
}

function findLanguageRequirements(advert: readonly string[]): LanguageRequirement[] {
  const byName = new Map<string, LanguageRequirement>();
  for (const sentence of advert) {
    const soft = SOFT_WORD.test(sentence);
    const bar = BAR_WORD.test(sentence);
    if (!soft && !bar) continue;
    const hard = !soft;
    const highBar = HIGH_BAR.test(sentence);
    for (const language of languagesIn(sentence)) {
      const existing = byName.get(language);
      if (existing === undefined) {
        byName.set(language, { language, sentence, hard, highBar });
      } else if (hard && !existing.hard) {
        // A firm requirement outranks an earlier wish for the same language.
        byName.set(language, { language, sentence, hard, highBar });
      } else if (hard === existing.hard && highBar && !existing.highBar) {
        byName.set(language, { language, sentence, hard, highBar });
      }
    }
  }
  return [...byName.values()];
}

function languageGate(
  requirement: LanguageRequirement,
  profile: readonly ProfileLanguage[],
): GateResult {
  const { language, hard, highBar } = requirement;
  const quote = quoteOf(requirement.sentence);
  const base = { kind: 'language' as const, language, quote };
  const wants = hard ? 'requires' : 'would like';

  if (profile.length === 0) {
    return {
      ...base,
      verdict: 'flag',
      reason: `The advert ${wants} ${language}. Your profile lists no languages, so this cannot be checked.`,
    };
  }

  const held = profile.find((entry) => entry.name.trim().toLowerCase() === language.toLowerCase());
  if (held === undefined) {
    return {
      ...base,
      verdict: hard ? 'fail' : 'flag',
      reason: hard
        ? `The advert requires ${language}. Your profile does not list it.`
        : `The advert would like ${language} but does not require it. Your profile does not list it.`,
    };
  }

  const level = held.level.trim();
  if (highBar && LOW_LEVEL.test(level)) {
    return {
      ...base,
      verdict: 'flag',
      reason: `The advert asks for fluent ${language}; your profile puts yours at ${level}.`,
    };
  }

  return {
    ...base,
    verdict: 'pass',
    reason:
      level.length === 0
        ? `The advert ${wants} ${language} and your profile lists it.`
        : `The advert ${wants} ${language} and your profile lists it (${level}).`,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Run both gates over an advert. Always exactly one `eligibility` result,
 * first, then zero or more `language` results in the order the advert first
 * names each language.
 */
export function runGates(input: GateInput): GateResult[] {
  const advert = sentences(input.advertText);
  return [
    eligibilityGate(advert, input.workRights),
    ...findLanguageRequirements(advert).map((requirement) =>
      languageGate(requirement, input.languages),
    ),
  ];
}
