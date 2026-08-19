/**
 * clamp.ts — the near-miss repairs, applied BEFORE validation.
 *
 * ============================================================================
 * A CLOSED, NAMED LIST. NOT "COERCE ANYTHING THAT LOOKS CLOSE".
 * ============================================================================
 * A 3B quantised model gets the edges of a schema wrong in a new way every run:
 * `"87"` instead of `87`, `105` for a 0-100 field, `"urgent"` for a closed enum,
 * a whole array simply absent. Failing validation on any of those and spending
 * the single retry is wasteful when the answer underneath is fine.
 *
 * What makes this safe rather than sloppy is that every repair below is
 * enumerated, tested, and REPORTS ITSELF in `applied`. Nothing is guessed
 * silently. When a result looks wrong later, `applied` says which repair
 * touched it.
 *
 * The refusals matter as much as the repairs — see the `does NOT` block in the
 * tests. An absent `match_score`, an absent `summary`, a fraction that might be
 * either a percentage or a score of 1: those FAIL, and failing is what buys the
 * retry. Inventing them would ship a fabricated analysis under a real score.
 *
 * `verdict` is a special case: it is filled in from `match_score` when the model
 * gets it wrong, purely so validation can proceed. `analyzeCv` overwrites it
 * with `deriveVerdict` immediately afterwards regardless of what is here.
 */
import { deriveVerdict } from '@cviper/core-types';

/** The names reported in `applied`. Stable — tests and telemetry read them. */
export type ClampName = string;

export interface ClampResult {
  /** A COPY. The caller's object is never mutated. */
  readonly value: unknown;
  readonly applied: readonly ClampName[];
}

/** Every array field in the flat schema. */
const ARRAY_FIELDS = [
  'matched_skills',
  'missing_skills',
  'keyword_gaps',
  'matched_keywords',
  'ats_notes',
  'suggestions',
] as const;

/** Array fields whose items are plain strings, so a bare string can be split. */
const STRING_ARRAY_FIELDS = [
  'matched_skills',
  'missing_skills',
  'keyword_gaps',
  'matched_keywords',
  'ats_notes',
] as const;

const MIN_SCORE = 0;
const MAX_SCORE = 100;

const VERDICTS = new Set(['strong', 'possible', 'weak']);

/**
 * Priority synonyms seen from small models, mapped to the closed set.
 *
 * The numeric entries are not decoration: asked for "high, medium or low" a
 * small model will often answer `1`, having decided the list was ranked.
 */
const PRIORITY_SYNONYMS: Readonly<Record<string, 'high' | 'medium' | 'low'>> = {
  high: 'high',
  urgent: 'high',
  critical: 'high',
  important: 'high',
  severe: 'high',
  major: 'high',
  must: 'high',
  'must-have': 'high',
  p0: 'high',
  p1: 'high',
  '1': 'high',

  medium: 'medium',
  moderate: 'medium',
  normal: 'medium',
  med: 'medium',
  standard: 'medium',
  p2: 'medium',
  '2': 'medium',

  low: 'low',
  minor: 'low',
  optional: 'low',
  'nice to have': 'low',
  'nice-to-have': 'low',
  cosmetic: 'low',
  p3: 'low',
  '3': 'low',
};

/** The three values the schema actually accepts. */
const CANONICAL_PRIORITIES = new Set(['high', 'medium', 'low']);

/** Where an unrecognisable priority lands. Middle of the road, never dropped. */
const PRIORITY_FALLBACK = 'medium';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a number out of whatever the model wrote.
 *
 * Accepts an actual number, or a string that is ENTIRELY a number once
 * whitespace and a trailing percent sign are removed. `"very good"` and
 * `"87 out of 100"` return null on purpose — a partial match is a guess.
 */
function readNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/\s*%$/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Split a bare string into array items on commas or newlines. */
function splitToArray(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function clampPriority(raw: unknown, applied: string[]): unknown {
  if (typeof raw === 'string' && CANONICAL_PRIORITIES.has(raw)) return raw;

  const key = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : null;
  if (key === null) {
    applied.push('suggestions.priority:defaulted');
    return PRIORITY_FALLBACK;
  }

  const mapped = PRIORITY_SYNONYMS[key.trim().toLowerCase()];
  if (mapped === undefined) {
    applied.push('suggestions.priority:defaulted');
    return PRIORITY_FALLBACK;
  }

  applied.push('suggestions.priority:normalised');
  return mapped;
}

export function clampAnalysis(raw: unknown): ClampResult {
  if (!isPlainObject(raw)) return { value: raw, applied: [] };

  const applied: string[] = [];
  const out: Record<string, unknown> = { ...raw };

  // ── match_score ───────────────────────────────────────────────────────────
  // Only touched when the field is PRESENT. An absent score fails validation,
  // which is the intended behaviour.
  if ('match_score' in out) {
    const parsed = readNumber(out['match_score']);
    if (parsed !== null) {
      let score = parsed;

      if (typeof out['match_score'] === 'string') applied.push('match_score:string-to-number');

      if (!Number.isInteger(score)) {
        // Rounded, never rescaled. `0.84` becomes `1`, not `84` — see the test
        // `does not rescale a 0-to-1 fraction`.
        score = Math.round(score);
        applied.push('match_score:rounded');
      }
      if (score > MAX_SCORE) {
        score = MAX_SCORE;
        applied.push('match_score:clamped-to-ceiling');
      } else if (score < MIN_SCORE) {
        score = MIN_SCORE;
        applied.push('match_score:clamped-to-floor');
      }

      out['match_score'] = score;
    }
    // A non-numeric score is left exactly as it came, so validation fails and
    // the caller spends its one retry rather than shipping a made-up number.
  }

  // ── arrays ────────────────────────────────────────────────────────────────
  for (const field of ARRAY_FIELDS) {
    const current = out[field];

    if (current === undefined || current === null) {
      out[field] = [];
      applied.push(`${field}:absent-to-empty`);
      continue;
    }

    if (typeof current === 'string' && (STRING_ARRAY_FIELDS as readonly string[]).includes(field)) {
      out[field] = splitToArray(current);
      applied.push(`${field}:string-to-array`);
    }
    // Anything else — a number, an object, an array with odd members — is left
    // alone. Element-level coercion is where silent data loss starts.
  }

  // ── suggestions[].priority ────────────────────────────────────────────────
  const suggestions = out['suggestions'];
  if (Array.isArray(suggestions)) {
    out['suggestions'] = suggestions.map((entry) => {
      // A suggestion that is not an object is left as-is: turning a bare string
      // into a four-field object means inventing three of the four fields.
      if (!isPlainObject(entry)) return entry;
      return { ...entry, priority: clampPriority(entry['priority'], applied) };
    });
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  // Filled in only to let validation proceed. `analyzeCv` overwrites it from
  // `match_score` in every case, including this one.
  const verdict = out['verdict'];
  if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) {
    const score = readNumber(out['match_score']);
    out['verdict'] = deriveVerdict(score ?? Number.NaN);
    applied.push('verdict:derived');
  }

  return { value: out, applied };
}
