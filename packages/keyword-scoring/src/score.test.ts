/**
 * The public entry point: one CV, one advert, one `CvAnalysis`.
 *
 * The whole point of this package is that the object it returns is
 * INDISTINGUISHABLE IN SHAPE from the one the AI path produces, so the UI has
 * one component and one code path. Every test that builds an analysis here
 * therefore ends by putting it through `CvAnalysisSchema`.
 */
import { describe, expect, it } from 'vitest';
import { CvAnalysisSchema, deriveVerdict, isErr, isOk } from '@cviper/core-types';
import { MIN_SCORABLE_CHARS, scoreByKeywords } from './score';

// ── Realistic fixtures ───────────────────────────────────────────────────────

const CV = [
  'Jane Okafor',
  'Business Analyst',
  '',
  'PROFILE',
  'Business analyst with eight years in London investment banking, delivering',
  'regulatory change across derivatives and settlements.',
  '',
  'EXPERIENCE',
  'Business Analyst, Barclays (2020-2026)',
  '- Gathered and documented requirements for a trade reporting platform',
  '- Wrote SQL to reconcile derivatives positions across two systems',
  '- Ran stakeholder management across front office, risk and compliance',
  '- Delivered in an Agile team using Jira and Confluence',
  '',
  'SKILLS',
  'SQL, requirements gathering, stakeholder management, business analysis,',
  'Agile, Jira, Confluence, Excel, data analysis',
].join('\n');

const ADVERT = [
  'Senior Business Analyst',
  'Nomura',
  'London, United Kingdom',
  '',
  'We are hiring a Senior Business Analyst for our markets technology division.',
  'You will work across derivatives, settlements and regulatory reporting.',
  '',
  'Requirements:',
  '- Strong SQL and data analysis capability',
  '- Proven requirements gathering and stakeholder management',
  '- Experience of Agile delivery, ideally with Jira',
  '- Exposure to Python for data work is an advantage',
  '- Knowledge of Tableau reporting would be useful',
].join('\n');

/** A real CV for a completely different job — long enough to be scannable. */
const UNRELATED_CV = [
  'Tom Reilly',
  'Pastry Chef',
  '',
  'Fifteen years in London kitchens, running a section of eight.',
  'Bread, viennoiserie and plated desserts for 200 covers a night.',
  'Ordering, stock rotation and food hygiene records.',
].join('\n');

function analyse(cv: string, advert: string) {
  const result = scoreByKeywords(cv, advert);
  if (!isOk(result)) throw new Error(`expected success, got ${result.error.code}`);
  return result.value;
}

// ── Shape ────────────────────────────────────────────────────────────────────

describe('the result is shaped exactly like the AI path', () => {
  it('passes CvAnalysisSchema', () => {
    const parsed = CvAnalysisSchema.safeParse(analyse(CV, ADVERT));
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['a strong candidate', CV, ADVERT],
    ['a hopeless candidate', UNRELATED_CV, ADVERT],
    ['a prose advert with no stated skills', CV, 'Barista wanted\n\nBe warm and reliable please.'],
    ['a CV that is one long line', CV.replace(/\n/g, ' '), ADVERT],
    [
      'text with no lexicon overlap at all',
      'aaaa bbbb cccc dddd eeee ffff',
      'gggg hhhh iiii jjjj kkkk llll',
    ],
  ])('passes CvAnalysisSchema for %s', (_label, cv, advert) => {
    const parsed = CvAnalysisSchema.safeParse(analyse(cv, advert));
    expect(parsed.success).toBe(true);
  });

  it('has every required field populated with the right type', () => {
    const analysis = analyse(CV, ADVERT);
    expect(Number.isInteger(analysis.match_score)).toBe(true);
    expect(['strong', 'possible', 'weak']).toContain(analysis.verdict);
    expect(typeof analysis.summary).toBe('string');
    expect(analysis.summary.length).toBeGreaterThan(20);
    for (const field of [
      analysis.matched_skills,
      analysis.missing_skills,
      analysis.matched_keywords,
      analysis.keyword_gaps,
      analysis.ats_notes,
    ]) {
      expect(Array.isArray(field)).toBe(true);
    }
  });
});

// ── The verdict is derived, never invented here ──────────────────────────────

describe('verdict', () => {
  it('always equals deriveVerdict(match_score)', () => {
    for (const [cv, advert] of [
      [CV, ADVERT],
      [UNRELATED_CV, ADVERT],
      [CV, 'Business Analyst\n\nSQL and stakeholder management needed here please'],
    ] as const) {
      const analysis = analyse(cv, advert);
      expect(analysis.verdict).toBe(deriveVerdict(analysis.match_score));
    }
  });
});

// ── Skills vs keywords are genuinely different questions ─────────────────────

describe('skills and keywords are distinct', () => {
  it('matched_skills and matched_keywords diverge on the same input', () => {
    const analysis = analyse(CV, ADVERT);
    expect(analysis.matched_skills.length).toBeGreaterThan(0);
    expect(analysis.matched_keywords.length).toBeGreaterThan(0);
    // Not the same list, and neither is a copy of the other.
    expect(analysis.matched_keywords).not.toEqual(analysis.matched_skills);
    const skillSet = new Set(analysis.matched_skills.map((s) => s.toLowerCase()));
    const onlyKeywords = analysis.matched_keywords.filter((k) => !skillSet.has(k.toLowerCase()));
    expect(onlyKeywords.length).toBeGreaterThan(0);
  });

  it('keyword_gaps carries advert words that are not skills at all', () => {
    // "regulatory", "markets", "division" are words an applicant tracking
    // system scans for and no lexicon calls a skill.
    const analysis = analyse(UNRELATED_CV, ADVERT);
    const gaps = analysis.keyword_gaps.map((g) => g.toLowerCase());
    const missing = new Set(analysis.missing_skills.map((s) => s.toLowerCase()));
    expect(gaps.some((gap) => !missing.has(gap))).toBe(true);
  });

  it('a candidate can be missing a keyword without missing the skill', () => {
    // The CV says "requirements gathering" but never the advert's word
    // "reporting" — a wording gap, not a capability gap.
    const analysis = analyse(CV, ADVERT);
    const missing = new Set(analysis.missing_skills.map((s) => s.toLowerCase()));
    expect(analysis.keyword_gaps.length).toBeGreaterThan(0);
    expect(analysis.keyword_gaps.some((gap) => !missing.has(gap.toLowerCase()))).toBe(true);
  });

  it('never populates one list by copying the other', () => {
    const analysis = analyse(CV, ADVERT);
    expect(analysis.keyword_gaps).not.toEqual(analysis.missing_skills);
  });
});

// ── Rarity weighting, end to end ─────────────────────────────────────────────

describe('rarity weighting survives all the way to the public API', () => {
  // Neither CV below claims a title resembling "Infrastructure Specialist", so
  // the title signal is zero for both and the ONLY thing separating them is
  // how the five requirements are weighted. An earlier version of this test
  // gave both CVs a matching job title, and it passed with the weighting
  // deliberately broken — it was measuring the title floor, not the weights.
  const advert = [
    'Infrastructure Specialist',
    '',
    'You will need kubernetes and docker running in production.',
    'You will also work in an agile team, using git and jira daily.',
  ].join('\n');

  const RARE_CV = 'Ran kubernetes and docker across three production clusters for four years.';
  const COMMON_CV = 'Worked in agile teams for four years, using git and jira every single day.';

  it('rates two rare skills above three common ones', () => {
    const rare = analyse(RARE_CV, advert);
    const common = analyse(COMMON_CV, advert);
    expect(rare.match_score).toBeGreaterThan(common.match_score);
  });

  it('does so even though the common CV covers MORE of the requirements', () => {
    // The inversion is the point. Count the matches instead of weighting them
    // and the three-requirement CV wins, which is the behaviour this whole
    // package exists to avoid.
    const rare = analyse(RARE_CV, advert);
    const common = analyse(COMMON_CV, advert);
    expect(common.matched_skills.length).toBeGreaterThan(rare.matched_skills.length);
    expect(rare.match_score).toBeGreaterThan(common.match_score);
  });

  it('gives neither CV a title advantage', () => {
    // Guards the guard: if a future edit makes one of these titles match, the
    // test above starts passing for the wrong reason again.
    for (const cv of [RARE_CV, COMMON_CV]) {
      const suggestions = analyse(cv, advert).suggestions;
      expect(suggestions.some((s) => s.section === 'Job title')).toBe(true);
    }
  });
});

// ── UK/US spelling ───────────────────────────────────────────────────────────

describe('UK and US spelling fold together', () => {
  it('matches a US-spelled advert against a UK-spelled CV', () => {
    const ukCv = 'I organise programmes and analyse data, driving cost optimisation work';
    const usAdvert = 'Analyst\n\nYou will organize teams, analyze data and drive optimization here';
    const ukAdvert = 'Analyst\n\nYou will organise teams, analyse data and drive optimisation here';
    const crossSpelling = analyse(ukCv, usAdvert);
    const sameSpelling = analyse(ukCv, ukAdvert);
    // The SCORE folds: spelling the same word the other way costs nothing.
    expect(crossSpelling.match_score).toBe(sameSpelling.match_score);
    expect(crossSpelling.matched_keywords.length).toBe(sameSpelling.matched_keywords.length);
    // The reported keywords deliberately do NOT fold — they quote the advert's
    // own spelling, because that is the string the employer's screening system
    // will look for. Telling a candidate to write "optimisation" when the
    // advert says "optimization" would be advising them into a miss.
    expect(crossSpelling.matched_keywords).toContain('optimization');
    expect(sameSpelling.matched_keywords).toContain('optimisation');
  });

  it('finds the CV term regardless of which side spells it which way', () => {
    const usCv = 'Cost optimization and data analyze work, organized delivery';
    const analysis = analyse(usCv, 'Role\n\nWe need optimisation and organisation skills here');
    expect(analysis.matched_keywords).toContain('optimisation');
  });
});

// ── The summary must be honest ───────────────────────────────────────────────

describe('summary honesty', () => {
  const FORBIDDEN = [
    /\bAI\b/i,
    /\bartificial intelligence\b/i,
    /\blanguage model\b/i,
    /\bLLM\b/i,
    /\bGPT\b/i,
    /\bClaude\b/i,
    /\bmodel\b/i,
    /\bunderstood\b/i,
    /\bread your cv\b/i,
  ];

  it.each([
    ['a strong candidate', CV, ADVERT],
    ['a weak candidate', UNRELATED_CV, ADVERT],
    ['a prose advert', CV, 'Barista wanted\n\nBe warm and reliable and cheerful please'],
  ])('never implies a language model was involved for %s', (_label, cv, advert) => {
    const { summary } = analyse(cv, advert);
    for (const pattern of FORBIDDEN) {
      expect(summary, `"${summary}" matched ${pattern}`).not.toMatch(pattern);
    }
  });

  it('says it is a keyword match', () => {
    expect(analyse(CV, ADVERT).summary.toLowerCase()).toContain('keyword');
  });

  it('names how many of the advert requirements were found', () => {
    const analysis = analyse(CV, ADVERT);
    // "N of the M things this advert asks for"
    expect(analysis.summary).toMatch(/\d+ of the \d+/);
  });

  it('says something different when the advert states no requirements', () => {
    const prose = analyse(CV, 'Barista wanted\n\nBe warm and reliable and cheerful please');
    const normal = analyse(CV, ADVERT);
    expect(prose.summary).not.toBe(normal.summary);
    expect(prose.summary.toLowerCase()).toContain('keyword');
  });
});

// ── Suggestions ──────────────────────────────────────────────────────────────

describe('suggestions', () => {
  it('are capped at 5 so the panel stays readable', () => {
    for (const [cv, advert] of [
      [CV, ADVERT],
      [UNRELATED_CV, ADVERT],
      ['', ''],
    ] as const) {
      if (!cv || !advert) continue;
      expect(analyse(cv, advert).suggestions.length).toBeLessThanOrEqual(5);
    }
  });

  it('only uses the three allowed priorities', () => {
    for (const suggestion of analyse(UNRELATED_CV, ADVERT).suggestions) {
      expect(['high', 'medium', 'low']).toContain(suggestion.priority);
    }
  });

  it('has all four flat string fields filled on every suggestion', () => {
    for (const suggestion of analyse(UNRELATED_CV, ADVERT).suggestions) {
      expect(suggestion.section.length).toBeGreaterThan(0);
      expect(suggestion.issue.length).toBeGreaterThan(0);
      expect(suggestion.recommendation.length).toBeGreaterThan(0);
    }
  });

  it('leads with the biggest gap', () => {
    // Python and Tableau are role-defining and missing; Jira is boilerplate.
    const analysis = analyse(CV, ADVERT);
    const first = analysis.suggestions[0];
    expect(first).toBeDefined();
    expect(first?.priority).toBe('high');
  });

  it('says nothing about missing skills when nothing is missing', () => {
    const analysis = analyse(
      'Kubernetes and terraform in production here',
      'Platform Engineer\n\nkubernetes and terraform needed in production here',
    );
    expect(analysis.missing_skills).toEqual([]);
    for (const suggestion of analysis.suggestions) {
      expect(suggestion.issue).not.toMatch(/does not mention/i);
    }
  });
});

// ── ats_notes ────────────────────────────────────────────────────────────────

describe('ats_notes', () => {
  it('reports the applicant-tracking keyword score', () => {
    const notes = analyse(CV, ADVERT).ats_notes;
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).toMatch(/\d+ out of 100/);
  });

  it('gives harsher advice to a CV that shares nothing with the advert', () => {
    const poor = analyse(UNRELATED_CV, ADVERT).ats_notes;
    expect(poor.join(' ')).toMatch(/add more keywords/i);
  });
});

// ── Errors: empty and near-empty input ───────────────────────────────────────

describe('errors', () => {
  it.each([
    ['', ADVERT, 'EMPTY_CV'],
    ['   \n\t  ', ADVERT, 'EMPTY_CV'],
    [CV, '', 'EMPTY_JOB_DESCRIPTION'],
    [CV, '   \n  ', 'EMPTY_JOB_DESCRIPTION'],
    ['', '', 'EMPTY_CV'],
  ])('returns %s for empty input', (cv, advert, code) => {
    const result = scoreByKeywords(cv, advert);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe(code);
  });

  it('returns a legible message, not a stack trace', () => {
    const result = scoreByKeywords('', ADVERT);
    if (!isErr(result)) throw new Error('expected an error');
    expect(result.error.message.length).toBeGreaterThan(40);
    expect(result.error.message).toMatch(/[.!]$/);
    expect(result.error.message).not.toMatch(/undefined|null|Error:/);
  });

  // BOUNDARY — exactly at the threshold works, one character below does not.
  it('accepts text of exactly MIN_SCORABLE_CHARS and rejects one less', () => {
    const advert = 'Business Analyst wanted with strong SQL skills';
    const justEnough = 'a'.repeat(MIN_SCORABLE_CHARS);
    const oneShort = 'a'.repeat(MIN_SCORABLE_CHARS - 1);
    expect(isOk(scoreByKeywords(justEnough, advert))).toBe(true);
    const short = scoreByKeywords(oneShort, advert);
    expect(isErr(short)).toBe(true);
    if (isErr(short)) expect(short.error.code).toBe('CV_TOO_SHORT');
  });

  it('rejects an advert that is too short to score against', () => {
    const result = scoreByKeywords(CV, 'SQL');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('JOB_DESCRIPTION_TOO_SHORT');
  });

  // NEGATIVE — a legible error, never a meaningless zero.
  it('never returns a score of 0 dressed up as an answer for empty input', () => {
    const result = scoreByKeywords('', '');
    expect(isOk(result)).toBe(false);
  });
});

// ── Score bounds ─────────────────────────────────────────────────────────────

describe('score bounds', () => {
  const CASES: readonly (readonly [string, string])[] = [
    [CV, ADVERT],
    [UNRELATED_CV, ADVERT],
    [CV, 'Barista wanted. Be warm and reliable and cheerful please.'],
    ['aaaa bbbb cccc dddd eeee', 'ffff gggg hhhh iiii jjjj'],
    [CV, CV],
    [ADVERT, ADVERT],
  ];

  it('always lands inside 0..100 as an integer', () => {
    for (const [cv, advert] of CASES) {
      const { match_score: score } = analyse(cv, advert);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('stays inside the ported keyword-only band of 10..95', () => {
    // The floor and cap are ported behaviour, not accidents: a keyword scan
    // has not read the CV, so it never claims certainty in either direction.
    for (const [cv, advert] of CASES) {
      const { match_score: score } = analyse(cv, advert);
      expect(score).toBeGreaterThanOrEqual(10);
      expect(score).toBeLessThanOrEqual(95);
    }
  });

  it('gives an identical CV and advert a high but sub-perfect score', () => {
    const analysis = analyse(ADVERT, ADVERT);
    expect(analysis.match_score).toBeGreaterThan(60);
    expect(analysis.match_score).toBeLessThan(100);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('gives byte-identical output for the same input, twice', () => {
    expect(analyse(CV, ADVERT)).toEqual(analyse(CV, ADVERT));
  });

  it('is unaffected by leading and trailing whitespace', () => {
    expect(analyse(`\n\n  ${CV}  \n`, ADVERT).match_score).toBe(analyse(CV, ADVERT).match_score);
  });

  // Regression: a soft hyphen inside a word is invisible on screen and would
  // otherwise let "Java­Script" register as the skill "java".
  it('is not fooled by a soft hyphen hiding inside a word', () => {
    const analysis = analyse(`${CV}\nJava\u00adScript everywhere`, 'Role\n\nWe need java here now');
    expect(analysis.matched_keywords.map((k) => k.toLowerCase())).not.toContain('java');
  });
});
