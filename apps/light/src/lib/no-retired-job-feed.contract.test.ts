/**
 * No shipped code reads a job feed that has closed (L-336).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Guardian Jobs closed on 2 September 2026. Its RSS address,
 * `jobs.theguardian.com/jobsrss/`, now answers with a redirect to an article
 * about the closure, so every browse that asked it for jobs got an HTML page
 * back and the user saw "Guardian Jobs sent something CViper could not read".
 * The feed was removed end to end: the Rust enum and its address, the
 * TypeScript source id, the reader and its fixture.
 *
 * A free feed that dies is not a code change anyone notices, so the address
 * coming back — a revert, a copy from an old branch — is the failure worth a
 * guard. This scans every shipped `.ts`, `.tsx` and `.rs` file (comments and
 * Rust test modules stripped, test files skipped) for the dead address.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * It never asserts which feeds exist beyond the one exact-set check on
 * `KEYLESS_SOURCE_IDS`, which is the closed set Rust and the screen both
 * enumerate. `'guardian'` as a historic `JobSource` is deliberately NOT
 * forbidden: jobs saved from the feed before it closed are still in people's
 * trackers and backups, and they must still load and still say where they
 * came from.
 *
 * ============================================================================
 * THE SITE ITSELF (L-337)
 * ============================================================================
 * The Guardian job BOARD link (`jobs.theguardian.com/jobs/{keyword}/`) in
 * `job-boards.json` outlived the feed by one release; the whole site answers
 * 403 now. With the board gone no shipped file has any reason to name the
 * host at all, so the second scan forbids `jobs.theguardian.com` anywhere in
 * shipped `.ts`, `.tsx`, `.rs` and `.json` — the board list is a `.json` file,
 * which is exactly where a copy-paste from an old branch would put it back.
 */
import { describe, expect, it } from 'vitest';

import { isOk, type Job } from '@cviper/core-types';
import { KEYLESS_SOURCE_IDS, KEYLESS_SOURCE_LABEL, SOURCE_LABEL } from '@cviper/job-apis';

import { TABLE_COLUMNS, jobFromRow, jobToValues } from '../db/rows';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

/** The closed feed's address, without a scheme, so either spelling is caught. */
const DEAD_FEED = 'jobs.theguardian.com/jobsrss';

const FILES = [
  ...walk(`${REPO_ROOT}apps`, { extensions: ['.ts', '.tsx', '.rs'] }),
  ...walk(`${REPO_ROOT}packages`, { extensions: ['.ts', '.tsx', '.rs'] }),
];

/** The closed site's host: the feed AND the board lived on it (L-337). */
const CLOSED_SITE = 'jobs.theguardian.com';

/** The site scan adds `.json`, where the shipped board list lives. */
const SITE_FILES = [
  ...walk(`${REPO_ROOT}apps`, { extensions: ['.ts', '.tsx', '.rs', '.json'] }),
  ...walk(`${REPO_ROOT}packages`, { extensions: ['.ts', '.tsx', '.rs', '.json'] }),
];

/**
 * A case-insensitive pattern that matches `literal` exactly, every regex
 * metacharacter escaped (so the `.` in a host is a dot, not "any character").
 * This scans FILE TEXT for a forbidden string; it is not a URL check, and a
 * pattern keeps that plain without a substring test on a host.
 */
function literalPattern(literal: string): RegExp {
  return new RegExp(literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i');
}

const DEAD_FEED_PATTERN = literalPattern(DEAD_FEED);
const CLOSED_SITE_PATTERN = literalPattern(CLOSED_SITE);

/** Does this text name the closed feed? Case-insensitive: hosts are. */
export function namesDeadFeed(text: string): boolean {
  return DEAD_FEED_PATTERN.test(text);
}

/** Does this text name the closed site at all — feed, board or advert? */
export function namesClosedSite(text: string): boolean {
  return CLOSED_SITE_PATTERN.test(text);
}

describe('the keyless feeds are exactly the ones that still publish', () => {
  it('KEYLESS_SOURCE_IDS is Arbeitnow alone', () => {
    expect(KEYLESS_SOURCE_IDS).toEqual(['arbeitnow']);
  });

  it('negative: no label is left for a feed that is not in the set', () => {
    expect(Object.keys(KEYLESS_SOURCE_LABEL)).toEqual([...KEYLESS_SOURCE_IDS]);
  });
});

describe('a job saved from Guardian Jobs before it closed is kept', () => {
  // The feed is gone, but adverts saved from it are still in people's trackers
  // and backups. They must still load, and still say where they came from.
  const SAVED_FROM_GUARDIAN: Job = {
    id: 'job-guardian-0001',
    source: 'guardian',
    external_id: '10176723',
    title: 'Social Worker',
    company: 'Leeds City Council',
    agency: null,
    location: 'Leeds',
    salary_min: 32000,
    salary_max: 38000,
    salary_currency: 'GBP',
    salary_period: 'year',
    description: 'Children and families team.',
    url: 'https://jobs.theguardian.com/job/10176723/social-worker/',
    posted_date: '2026-08-19',
    created_at: '2026-08-20T09:00:00.000Z',
  };

  it('regression: still loads from its database row unchanged', () => {
    // The row's columns in table order, as the database hands them back.
    const values = jobToValues(SAVED_FROM_GUARDIAN);
    const row = Object.fromEntries(
      TABLE_COLUMNS.jobs.map((column, index) => [column, values[index]]),
    );
    const back = jobFromRow(row);
    expect(isOk(back) && back.value).toEqual(SAVED_FROM_GUARDIAN);
  });

  it('regression: is still labelled "Guardian Jobs"', () => {
    expect(SOURCE_LABEL[SAVED_FROM_GUARDIAN.source]).toBe('Guardian Jobs');
  });
});

describe('no shipped source names the closed Guardian Jobs feed', () => {
  it('scans the real tree', () => {
    // Anti-inert: an empty walk passes for ever. The Rust transport and the
    // TypeScript feed contract are the two files the address lived in.
    expect(FILES.length).toBeGreaterThan(80);
    expect(FILES.some((file) => file.endsWith('keyless.rs'))).toBe(true);
    expect(FILES.some((file) => file.replaceAll('\\', '/').endsWith('keyless/types.ts'))).toBe(
      true,
    );
  });

  it('would catch the address if it came back', () => {
    expect(namesDeadFeed('"https://jobs.theguardian.com/jobsrss/"')).toBe(true);
    expect(namesDeadFeed('HTTPS://JOBS.THEGUARDIAN.COM/JOBSRSS')).toBe(true);
    // The board link is a different address: the site scan below catches it.
    expect(namesDeadFeed('https://jobs.theguardian.com/jobs/{keyword}/')).toBe(false);
  });

  it('finds none', () => {
    const offenders = FILES.filter((file) => namesDeadFeed(shippedText(file))).map(displayPath);
    expect(
      offenders,
      'Guardian Jobs closed on 2 Sep 2026 and its feed redirects to an article. ' +
        'Do not read it again.',
    ).toEqual([]);
  });
});

describe('no shipped file names the closed Guardian Jobs site (L-337)', () => {
  it('scans the real tree, the board list included', () => {
    // Anti-inert: the board list is the file the host lived in last.
    expect(SITE_FILES.length).toBeGreaterThan(FILES.length);
    expect(
      SITE_FILES.some((file) => file.replaceAll('\\', '/').endsWith('config/job-boards.json')),
    ).toBe(true);
  });

  it('would catch the board link, the feed and an advert address if any came back', () => {
    expect(namesClosedSite('"urlTemplate": "https://jobs.theguardian.com/jobs/{keyword}/"')).toBe(
      true,
    );
    expect(namesClosedSite('HTTPS://JOBS.THEGUARDIAN.COM/JOBSRSS')).toBe(true);
    expect(namesClosedSite("host: 'jobs.theguardian.com'")).toBe(true);
    // Not a near miss: the newspaper itself is a different host.
    expect(namesClosedSite('https://www.theguardian.com/help/insideguardian')).toBe(false);
    // The dots are literal: the pattern is escaped, so `.` is not "any character".
    expect(namesClosedSite('jobsXtheguardianXcom')).toBe(false);
    expect(namesDeadFeed('jobs-theguardian-com/jobsrss')).toBe(false);
  });

  it('finds none', () => {
    const offenders = SITE_FILES.filter((file) => namesClosedSite(shippedText(file))).map(
      displayPath,
    );
    expect(
      offenders,
      'Guardian Jobs closed on 2 Sep 2026 and jobs.theguardian.com answers 403. ' +
        'Do not link to it again.',
    ).toEqual([]);
  });
});
