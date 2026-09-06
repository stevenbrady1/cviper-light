/**
 * The shipped board list, and the exact URL each board produces.
 *
 * ============================================================================
 * FULL STRINGS, NOT SUBSTRINGS.
 * ============================================================================
 * Every expectation below is the whole URL. A `toContain('business-analyst')`
 * passes just as happily on `https://www.reed.co.uk/jobs/business-analyst-jobs-in-`
 * as on the address that actually opens a page, and the dangling connector is
 * precisely the bug this feature had to solve. If a template changes, the
 * expected string changes with it and a human reads both.
 *
 * These assertions are bound to `job-boards.json` rather than to a copy of it,
 * so the file and the test cannot drift apart.
 */
import { buildBoardUrl } from '@cviper/job-apis';
import { BoardTemplateSchema } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { SHIPPED_BOARDS, SHIPPED_BOARDS_PROBLEM } from './defaults';

/** The worked example, used for every board. */
const WORKED = { keywords: 'business analyst', location: 'Milton Keynes' };

const EXPECTED_IDS = [
  'linkedin',
  'indeed',
  'totaljobs',
  'cv-library',
  'reed',
  'adzuna',
  'google-jobs',
  'guardian',
  'jobserve',
];

/** `id -> the whole URL`, for `business analyst` in `Milton Keynes`. */
const WORKED_URLS: Readonly<Record<string, string>> = {
  linkedin:
    'https://www.linkedin.com/jobs/search/?keywords=business+analyst&location=Milton+Keynes',
  indeed: 'https://uk.indeed.com/jobs?q=business+analyst&l=Milton+Keynes',
  totaljobs: 'https://www.totaljobs.com/jobs/business-analyst/in-Milton-Keynes',
  'cv-library': 'https://www.cv-library.co.uk/business-analyst-jobs-in-Milton-Keynes',
  reed: 'https://www.reed.co.uk/jobs/business-analyst-jobs-in-Milton-Keynes',
  adzuna: 'https://www.adzuna.co.uk/search?q=business+analyst&w=Milton+Keynes',
  'google-jobs':
    'https://www.google.com/search?q=business+analyst+jobs+Milton+Keynes&udm=8&hl=en&gl=uk',
  guardian: 'https://jobs.theguardian.com/jobs/business-analyst/',
  jobserve: 'https://www.jobserve.com/gb/en/JobSearch.aspx?q=business+analyst&l=Milton+Keynes',
};

/** The same search with the location box left empty. */
const NO_LOCATION_URLS: Readonly<Record<string, string>> = {
  linkedin: 'https://www.linkedin.com/jobs/search/?keywords=business+analyst',
  indeed: 'https://uk.indeed.com/jobs?q=business+analyst',
  totaljobs: 'https://www.totaljobs.com/jobs/business-analyst',
  'cv-library': 'https://www.cv-library.co.uk/business-analyst-jobs',
  reed: 'https://www.reed.co.uk/jobs/business-analyst-jobs',
  adzuna: 'https://www.adzuna.co.uk/search?q=business+analyst',
  'google-jobs': 'https://www.google.com/search?q=business+analyst+jobs&udm=8&hl=en&gl=uk',
  guardian: 'https://jobs.theguardian.com/jobs/business-analyst/',
  jobserve: 'https://www.jobserve.com/gb/en/JobSearch.aspx?q=business+analyst',
};

function boardById(id: string) {
  const found = SHIPPED_BOARDS.find((board) => board.id === id);
  if (found === undefined) throw new Error(`no shipped board with id ${id}`);
  return found;
}

describe('the shipped job-board config', () => {
  it('parses, and every entry is a BoardTemplate', () => {
    // `SHIPPED_BOARDS_PROBLEM` is the whole reason a malformed file degrades
    // instead of crashing the app. This is the check that stops one shipping.
    expect(SHIPPED_BOARDS_PROBLEM).toBeNull();

    for (const board of SHIPPED_BOARDS) {
      expect(BoardTemplateSchema.safeParse(board).success, board.id).toBe(true);
    }
  });

  it('holds exactly these nine ids, in this order', () => {
    expect(SHIPPED_BOARDS.map((board) => board.id)).toEqual(EXPECTED_IDS);
  });

  it('gives every board a label, a {keyword} and an https template', () => {
    for (const board of SHIPPED_BOARDS) {
      expect(board.label.trim(), board.id).not.toBe('');
      expect(board.urlTemplate, board.id).toContain('{keyword}');
      expect(board.urlTemplate.startsWith('https://'), board.id).toBe(true);
    }
  });

  it('keeps the literal word `jobs` in the Google template', () => {
    // Not a stray space to be tidied away: on Google's jobs tab it is the
    // difference between the role and adverts for the role.
    expect(boardById('google-jobs').urlTemplate).toContain('+jobs+');
  });

  it('has no {location} in the Guardian template, and that is correct', () => {
    // Guardian Jobs searches by keyword only. A location is simply ignored
    // there — it is not a missing feature and not a bug.
    expect(boardById('guardian').urlTemplate).not.toContain('{location}');
  });
});

describe('every shipped board — business analyst, Milton Keynes', () => {
  it.each(EXPECTED_IDS)('%s produces exactly one known URL', (id) => {
    expect(buildBoardUrl(boardById(id), WORKED)).toBe(WORKED_URLS[id]);
  });

  it('never puts a raw # or a brace in any of them', () => {
    for (const board of SHIPPED_BOARDS) {
      const url = buildBoardUrl(board, WORKED);
      expect(url, board.id).not.toContain('#');
      expect(url, board.id).not.toContain('{');
      expect(new URL(url).protocol, board.id).toBe('https:');
    }
  });
});

describe('every shipped board — with the location box empty', () => {
  it.each(EXPECTED_IDS)('%s still produces exactly one known URL', (id) => {
    expect(buildBoardUrl(boardById(id), { ...WORKED, location: '' })).toBe(NO_LOCATION_URLS[id]);
  });

  it('every one of them is a valid, opened-in-a-browser URL', () => {
    for (const board of SHIPPED_BOARDS) {
      const url = buildBoardUrl(board, { ...WORKED, location: '' });

      expect(() => new URL(url), board.id).not.toThrow();
      expect(new URL(url).protocol, board.id).toBe('https:');
      // No dangling connector, no empty parameter, no `//` in the path.
      // A trailing `/` is NOT a dangling connector — Guardian's template ends
      // in one on purpose, and a path may legitimately finish with a slash.
      expect(url, board.id).not.toMatch(/[-+]$|=($|&)|[-/](in|at|near)$/);
      expect(new URL(url).pathname, board.id).not.toContain('//');
    }
  });
});

describe('every shipped board — C# is escaped, not truncated', () => {
  it.each(EXPECTED_IDS)('%s escapes the # rather than truncating there', (id) => {
    const url = buildBoardUrl(boardById(id), { keywords: 'C# developer', location: 'Leeds' });

    expect(url, id).toContain('C%23');
    expect(url, id).not.toContain('#');
    expect(new URL(url).hash, id).toBe('');
  });
});
