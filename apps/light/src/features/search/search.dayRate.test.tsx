// @vitest-environment jsdom
/**
 * ============================================================================
 * REGRESSION: A REED DAY RATE MUST NEVER RENDER AS AN ANNUAL SALARY.
 * ============================================================================
 * The bug, in the CViper web application it was ported from
 * (`backend/job_sites_api.py`):
 *
 *   Reed returns salary figures with NO period unit. `ReedAPI._format_salary`
 *   worked out that £457 had to be a day rate, and then threw that answer away
 *   into a string suffix — `"£457 - £550 per day"`. Downstream,
 *   `normalize_salary` had to parse it back out, and did not: it read the bare
 *   `457` as an annual salary, its "looks-like-thousands" guard inflated it to
 *   £457,000, and it re-divided that into £1,987 a day.
 *
 *   Nothing errored. A good contract role simply rendered as a terrible
 *   permanent one, and the user skipped it.
 *
 * The fix has three parts and this file guards the whole chain end to end:
 *
 *   1. `classifyReedSalaryPeriod` returns the period as DATA, not prose.
 *   2. `normaliseReedResponse` stores it in `Job.salary_period`.
 *   3. `formatSalary` states it once, at the point of display.
 *
 * This test drives a REAL Reed response body through the REAL parser and into
 * the real screen, so a break anywhere along that chain fails here — not just a
 * break in the formatter. That is the difference between a regression test and
 * a unit test that agrees with itself.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DAY_RATE_CEILING,
  emptyQuota,
  normaliseReedResponse,
  type SearchResultJob,
} from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { Search } from './Search';
import { createFakeSearchPort, outcomeOf } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const KEYS: Record<'adzuna' | 'reed', KeyState> = { adzuna: 'missing', reed: 'configured' };

/**
 * A Reed response, in Reed's own shape.
 *
 * The figures are the ones from the source comment: `457` and `550`, with no
 * unit anywhere in the payload. That absence IS the bug.
 */
const REED_BODY = JSON.stringify({
  results: [
    {
      jobId: 99900001,
      jobTitle: 'Credit Risk Contractor',
      employerName: 'Lloyds',
      locationName: 'London',
      minimumSalary: 457,
      maximumSalary: 550,
      contractType: 'Contract',
      jobDescription:
        'A day-rate contract inside IR35 building IFRS 9 impairment models for a London bank, ' +
        'running stress tests and reporting to the chief risk officer.',
      jobUrl: 'https://www.reed.co.uk/jobs/99900001',
      date: '14/08/2026',
    },
    {
      jobId: 99900002,
      jobTitle: 'Credit Risk Analyst',
      employerName: 'Barclays',
      locationName: 'London',
      // Above the ceiling, so this one really is annual — the other half of the
      // classification, and the half a broken fix would also get wrong.
      minimumSalary: 65000,
      maximumSalary: 80000,
      jobDescription:
        'A permanent role in a London credit risk team, building models and reporting capital ' +
        'numbers to the regulator each quarter.',
      jobUrl: 'https://www.reed.co.uk/jobs/99900002',
      date: '18/08/2026',
    },
  ],
});

/** Parse the body with the REAL parser, exactly as a live search would. */
function parsedReedResults(): readonly SearchResultJob[] {
  const parsed = normaliseReedResponse(REED_BODY, {
    createdAt: NOW.toISOString(),
    newId: (() => {
      let index = 0;
      return () => `reed-${(index += 1)}`;
    })(),
  });

  if (!parsed.ok) throw new Error(`the Reed fixture no longer parses: ${parsed.error.message}`);
  return parsed.value;
}

async function runSearch(): Promise<void> {
  const user = userEvent.setup();
  const port = createFakeSearchPort();
  port.nextOutcome(outcomeOf(parsedReedResults(), emptyQuota(TODAY)));

  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => KEYS}
      now={NOW}
      newId={() => 'application-1'}
    />,
  );

  await screen.findByTestId('search-empty');
  await user.type(screen.getByTestId('search-keywords'), 'credit risk');
  await user.click(screen.getByTestId('search-submit'));
  await screen.findByTestId('result-reed-1');
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('a Reed contract quoted as a day rate', () => {
  it('renders "per day", and never as an annual figure', async () => {
    await runSearch();

    const salary = screen.getByTestId('result-salary-reed-1').textContent ?? '';

    expect(salary).toBe('£457–£550 per day');
    expect(salary).not.toContain('per year');
  });

  it('never shows any of the inflated figures the original produced', async () => {
    await runSearch();

    const card = screen.getByTestId('result-reed-1').textContent ?? '';

    // £457k was the inflated annual figure; £1,987 was what it was re-divided
    // into. Either on screen means the period was lost somewhere between the
    // parser and the card.
    expect(card).not.toContain('457,000');
    expect(card).not.toContain('£457,000');
    expect(card).not.toContain('1,987');
  });

  it('says the same thing to a screen reader, without relying on a dash', async () => {
    await runSearch();

    // "£457–£550 per day" read aloud as "457 550 per day" is a worse claim than
    // the one on screen.
    expect(screen.getByTestId('result-salary-reed-1').getAttribute('aria-label')).toBe(
      '£457 to £550 per day',
    );
  });

  it('carries the contract type through as well', async () => {
    await runSearch();

    expect(screen.getByTestId('result-reed-1').textContent ?? '').toContain('Contract');
  });
});

describe('the other half of the same classification', () => {
  it('renders a genuinely annual Reed salary as "per year"', async () => {
    // A fix that stamped "per day" on everything would pass the tests above and
    // be just as wrong. Both sides of `DAY_RATE_CEILING` are asserted.
    await runSearch();

    expect(screen.getByTestId('result-salary-reed-2').textContent).toBe('£65,000–£80,000 per year');
  });

  it('boundary: the ceiling is the one the port documents', async () => {
    // Pins the two fixture figures either side of the real threshold, so this
    // file cannot quietly stop testing the boundary if the constant moves.
    expect(DAY_RATE_CEILING).toBe(2000);
    expect(457).toBeLessThan(DAY_RATE_CEILING);
    expect(65000).toBeGreaterThan(DAY_RATE_CEILING);
  });
});

describe('the whole chain, not just the formatter', () => {
  it('the period survives the real Reed parser as DATA', async () => {
    // If this ever fails, the bug is upstream of the screen — in
    // `classifyReedSalaryPeriod` or `normaliseReedResponse` — and the card is
    // innocent. Asserting it here says which half broke.
    const [contract, permanent] = parsedReedResults();

    expect(contract?.job.salary_period).toBe('day');
    expect(permanent?.job.salary_period).toBe('year');
    // And it is a VALUE, not a string with a unit baked into it. The original
    // bug was exactly this distinction.
    expect(contract?.job.salary_min).toBe(457);
    expect(String(contract?.job.salary_min)).not.toContain('per');
  });
});
