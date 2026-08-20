/**
 * The awkward adverts, as fixtures.
 *
 * PORTED FROM: backend/tests/companies/test_salary_utils.py  (CViper repo, @ e87d07df)
 *   `test_competitive_returns_none`, `test_doe_returns_none`,
 *   `test_annual_range_with_k_suffix`, `test_hourly_rate`,
 *   `test_daily_rate` / `test_daily_rate_range`
 * and backend/tests/api/test_email_extraction.py  (CViper repo, @ e8a5e8b0)
 *   `_REALISTIC_EMAIL` — the Hays agency email about a Tier 1 bank.
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when either source changes. This corpus is shared on
 * purpose: a case added there and not here means one product is tested against
 * a real-world advert shape the other is not.
 *
 * ============================================================================
 * WHY THESE LIVE IN ONE FILE
 * ============================================================================
 * They are the SAME advert text used by the clamp tests, the orchestration
 * tests and the app's tracker tests. Written out three times they would drift,
 * and the drift would be invisible: each copy would keep passing its own suite
 * while the three stopped describing the same advert.
 *
 * Each fixture carries the model reply BEFORE clamping — deliberately, and in
 * several cases deliberately WRONG, because the whole point of half of these is
 * what happens when a 3B model answers with a number it should have refused.
 *
 * Three of the eight cover behaviour THE SOURCE APP DOES NOT HAVE:
 *   - `proRata`     — zero coverage upstream; `normalize_salary` reads
 *                     "£45,000 pro rata" as a full £45,000 salary.
 *   - `dayRate`     — upstream multiplies by 230 working days and stores a
 *                     yearly figure. `SalaryPeriod` in `entities.ts` exists
 *                     because this project already shipped that bug once.
 *   - `hybrid`      — the string appears in the source's own fixture email and
 *                     NO TEST ASSERTS ANYTHING ABOUT IT; the pipeline reduces
 *                     "City of London (hybrid, 3 days on site)" to "City of
 *                     London" and there is no work-mode field anywhere.
 */
import { type JobExtraction } from '@cviper/core-types';

export interface AdvertFixture {
  /** Shown in the test name. */
  readonly name: string;
  /** What the user pastes. */
  readonly text: string;
  /** What the model returns, before any clamping. */
  readonly modelReply: Record<string, unknown>;
  /** What `extractJob` must produce, field by field, after clamping. */
  readonly expected: Partial<JobExtraction>;
  /** Substrings the final `description` must contain. */
  readonly descriptionContains?: readonly string[];
}

const BASE_REPLY = {
  title: null,
  company: null,
  location: null,
  url: null,
  description: null,
  posted_date: null,
  salary_currency: null,
  salary_min: null,
  salary_max: null,
};

// ── Ported: the cases the source app already tests ──────────────────────────

/** `test_annual_range_with_k_suffix` — the one case where numbers survive. */
export const K_RANGE: AdvertFixture = {
  name: 'a plain annual range written with k suffixes',
  text: [
    'Credit Risk Analyst',
    'Lloyds Banking Group — City of London',
    'Salary: £45k-£55k depending on the desk, plus bonus and pension.',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    location: 'City of London',
    description: 'Second-line credit risk for the wholesale book.',
    salary_currency: 'GBP',
    salary_min: 45000,
    salary_max: 55000,
  },
  expected: {
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    salary_min: 45000,
    salary_max: 55000,
    salary_currency: 'GBP',
  },
};

/** `test_competitive_returns_none` — and the model inventing a figure anyway. */
export const COMPETITIVE: AdvertFixture = {
  name: 'a competitive salary with no figure anywhere',
  text: [
    'Market Risk Manager',
    'A leading investment bank, City of London.',
    'Competitive salary and discretionary bonus. Salary DOE.',
  ].join('\n'),
  // The model guesses. This is exactly the failure the clamp exists for.
  modelReply: {
    ...BASE_REPLY,
    title: 'Market Risk Manager',
    company: 'A leading investment bank',
    location: 'City of London',
    description: 'Market risk oversight.',
    salary_currency: 'GBP',
    salary_min: 85000,
    salary_max: 110000,
  },
  expected: {
    title: 'Market Risk Manager',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
  },
  descriptionContains: ['Competitive'],
};

/** `test_hourly_rate` — £50/hour, annualised upstream, null here. */
export const HOURLY: AdvertFixture = {
  name: 'an hourly rate',
  text: ['Temporary Reconciliations Clerk', 'Canary Wharf', 'Paying £50/hour for six weeks.'].join(
    '\n',
  ),
  modelReply: {
    ...BASE_REPLY,
    title: 'Temporary Reconciliations Clerk',
    location: 'Canary Wharf',
    description: 'Short-term reconciliations cover.',
    salary_currency: 'GBP',
    // 50 × 1840 working hours — what `normalize_salary` would store.
    salary_min: 92000,
    salary_max: 92000,
  },
  expected: { salary_min: null, salary_max: null, salary_currency: null },
  descriptionContains: ['£50/hour'],
};

/** The source's DEFAULT case: an agency posting, not the employer. */
export const AGENCY: AdvertFixture = {
  name: 'an agency posting where the client is described but not named',
  text: [
    'Hi — I am working on a Quantitative Analyst role with a Tier 1 investment bank.',
    'Based in the City of London. Salary £90,000 to £110,000.',
    '',
    'Best regards,',
    'Jane Smith',
    'Principal Consultant, Harrington Search',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Quantitative Analyst',
    // Our flat schema has no `agency` field, so the recruiter IS the company.
    // The source would have split these across `company` and `agency`.
    company: 'Harrington Search',
    location: 'City of London',
    description: 'Quantitative analysis for a Tier 1 investment bank.',
    salary_currency: 'GBP',
    salary_min: 90000,
    salary_max: 110000,
  },
  expected: {
    title: 'Quantitative Analyst',
    company: 'Harrington Search',
    salary_min: 90000,
    salary_max: 110000,
  },
};

// ── Built: the three gaps the source app does not cover ─────────────────────

/**
 * GAP 1. `pro rata` appears NOWHERE in the source repo — not in the backend,
 * not in the frontend, not in the e2e specs.
 */
export const PRO_RATA: AdvertFixture = {
  name: 'pro-rata pay for a part-time role',
  text: [
    'Part-time Financial Controller',
    'Three days a week, City of London.',
    'Salary £45,000 pro rata.',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Part-time Financial Controller',
    location: 'City of London',
    description: 'Part-time control function.',
    salary_currency: 'GBP',
    // What `normalize_salary("£45,000 pro rata")` returns today: a full salary.
    salary_min: 45000,
    salary_max: 45000,
  },
  expected: { salary_min: null, salary_max: null, salary_currency: null },
  descriptionContains: ['£45,000 pro rata'],
};

/** GAP 2. A day rate is the London contractor norm and has no yearly meaning. */
export const DAY_RATE: AdvertFixture = {
  name: 'a contract day rate',
  text: [
    'Regulatory Reporting Contractor',
    'Canary Wharf, 6 months.',
    'The rate is £650 per day, outside IR35.',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Regulatory Reporting Contractor',
    location: 'Canary Wharf',
    description: 'Six-month regulatory reporting contract.',
    salary_currency: 'GBP',
    // 650 × 230 working days — what `normalize_salary` would store.
    salary_min: 149500,
    salary_max: 149500,
  },
  expected: { salary_min: null, salary_max: null, salary_currency: null },
  descriptionContains: ['£650 per day'],
};

/**
 * GAP 3. The string is lifted from the source's own `_REALISTIC_EMAIL`
 * (test_email_extraction.py line 69), where no test asserts anything about it
 * and the pipeline reduces it to "City of London".
 */
export const HYBRID: AdvertFixture = {
  name: 'a hybrid location with days on site',
  text: [
    'Credit Risk Analyst',
    'Barclays',
    'City of London (hybrid, 3 days on site)',
    'Salary £70,000.',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Credit Risk Analyst',
    company: 'Barclays',
    location: 'City of London (hybrid, 3 days on site)',
    description: 'Second-line credit risk.',
    salary_currency: 'GBP',
    salary_min: 70000,
    salary_max: 70000,
  },
  expected: {
    // VERBATIM. Not "City of London".
    location: 'City of London (hybrid, 3 days on site)',
    salary_min: 70000,
  },
};

/** Fully remote, the other half of the work-mode gap. */
export const REMOTE: AdvertFixture = {
  name: 'a fully remote role',
  text: [
    'Data Engineer',
    'Fully remote (UK), occasional travel to London.',
    'Salary £85,000.',
  ].join('\n'),
  modelReply: {
    ...BASE_REPLY,
    title: 'Data Engineer',
    location: 'Fully remote (UK), occasional travel to London',
    description: 'Remote data engineering.',
    salary_currency: 'GBP',
    salary_min: 85000,
    salary_max: 85000,
  },
  expected: { location: 'Fully remote (UK), occasional travel to London' },
};

/** Not a job advert at all — the source's "newsletter, shopping list" case. */
export const JUNK: AdvertFixture = {
  name: 'a paste that is not a job advert at all',
  text: 'milk, bread, pick up the dry cleaning, ring mum back',
  modelReply: { ...BASE_REPLY },
  expected: {
    title: null,
    company: null,
    location: null,
    salary_min: null,
    salary_max: null,
  },
};

export const ADVERT_FIXTURES: readonly AdvertFixture[] = [
  K_RANGE,
  COMPETITIVE,
  HOURLY,
  AGENCY,
  PRO_RATA,
  DAY_RATE,
  HYBRID,
  REMOTE,
  JUNK,
];
