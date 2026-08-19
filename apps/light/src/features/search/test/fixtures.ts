import { type Job } from '@cviper/core-types';
import { type SearchResultJob } from '@cviper/job-apis';

/**
 * Adverts for the search screen's tests.
 *
 * The descriptions are long on purpose: `computeFingerprint` refuses to
 * fingerprint anything under `MIN_FINGERPRINT_TOKENS` (20) normalised tokens,
 * so a two-word description can never be grouped with anything and a
 * cross-post test written with one would pass while proving nothing.
 */

const CREATED_AT = '2026-08-19T09:00:00.000Z';

/** One advert's worth of prose, long enough to fingerprint. */
export const SHARED_DESCRIPTION =
  'We are looking for a credit risk analyst to join a London team building IFRS 9 impairment ' +
  'models, running stress tests against the regulatory scenarios, and reporting the results to ' +
  'the chief risk officer every quarter. Strong SQL and Python are essential, along with ' +
  'experience of Basel III capital reporting and stakeholder communication across the business.';

export function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    source: 'reed',
    external_id: '55512345',
    title: 'Credit Risk Analyst',
    company: 'Barclays',
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: SHARED_DESCRIPTION,
    url: 'https://www.reed.co.uk/jobs/55512345',
    posted_date: '2026-08-14',
    created_at: CREATED_AT,
    ...overrides,
  };
}

export function entry(
  overrides: Partial<Job> = {},
  contractType: SearchResultJob['contractType'] = 'Permanent',
): SearchResultJob {
  return { job: job(overrides), contractType };
}

/** The advert from the ported bug: a Reed contract quoted as a DAY RATE. */
export const REED_DAY_RATE: SearchResultJob = entry(
  {
    id: 'job-day-rate',
    source: 'reed',
    external_id: '99900001',
    title: 'Credit Risk Contractor',
    company: 'Lloyds',
    salary_min: 457,
    salary_max: 550,
    salary_currency: 'GBP',
    // The whole point. Reed's figures carry no unit; the classifier derived
    // this and stored it as data, and the card has to state it.
    salary_period: 'day',
    url: 'https://www.reed.co.uk/jobs/99900001',
  },
  'Contract',
);

/** A permanent Adzuna role, for the attribution and the merged-results tests. */
export const ADZUNA_PERMANENT: SearchResultJob = entry({
  id: 'job-adzuna',
  source: 'adzuna',
  external_id: 'adz-1001',
  title: 'Credit Risk Analyst',
  company: 'HSBC',
  salary_min: 65000,
  salary_max: 80000,
  salary_currency: 'GBP',
  salary_period: 'year',
  url: 'https://www.adzuna.co.uk/jobs/details/adz-1001',
});
