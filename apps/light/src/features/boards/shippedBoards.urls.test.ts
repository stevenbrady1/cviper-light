/**
 * L-219: the exact link each shipped board opens for the worked example —
 * "software tester", London, within 10 miles, £60,000 a year — once as
 * Permanent and once as Contract.
 *
 * Each filter is sent only where the board's own link format for it was
 * confirmed (research, 2026-10-08): Reed, Totaljobs and CV-Library take
 * distance, salary and contract type; Indeed and LinkedIn take distance, and
 * LinkedIn "Contract" (it has no "Permanent"); Google takes the contract type
 * as a word. Adzuna, Guardian Jobs and Jobserve take only what they took
 * before, until their formats are confirmed. A wrong parameter is worse than a
 * missing one.
 */
import { buildBoardUrl } from '@cviper/job-apis';
import { describe, expect, it } from 'vitest';

import { SHIPPED_BOARDS } from './defaults';

const EXAMPLE = {
  keywords: 'software tester',
  location: 'London',
  distanceMiles: '10',
  salaryMin: '£60,000',
} as const;

const PERMANENT: Readonly<Record<string, string>> = {
  linkedin:
    'https://www.linkedin.com/jobs/search/?keywords=software+tester&location=London&distance=10',
  indeed: 'https://uk.indeed.com/jobs?q=software+tester&l=London&radius=10',
  totaljobs:
    'https://www.totaljobs.com/jobs/permanent/software-tester/in-London?radius=10&salary=60000&salarytypeid=1',
  'cv-library':
    'https://www.cv-library.co.uk/software-tester-jobs-in-London?distance=10&salarymin=60000&salarytype=annum&permanent=true',
  reed: 'https://www.reed.co.uk/jobs/software-tester-jobs-in-London?proximity=10&salaryFrom=60000&perm=true',
  adzuna: 'https://www.adzuna.co.uk/search?q=software+tester&w=London',
  'google-jobs':
    'https://www.google.com/search?q=software+tester+permanent+jobs+London&udm=8&hl=en&gl=uk',
  guardian: 'https://jobs.theguardian.com/jobs/software-tester/',
  jobserve: 'https://www.jobserve.com/gb/en/JobSearch.aspx?q=software+tester&l=London',
};

const CONTRACT: Readonly<Record<string, string>> = {
  linkedin:
    'https://www.linkedin.com/jobs/search/?keywords=software+tester&location=London&distance=10&f_JT=C',
  indeed: 'https://uk.indeed.com/jobs?q=software+tester&l=London&radius=10',
  totaljobs:
    'https://www.totaljobs.com/jobs/contract/software-tester/in-London?radius=10&salary=60000&salarytypeid=1',
  'cv-library':
    'https://www.cv-library.co.uk/software-tester-jobs-in-London?distance=10&salarymin=60000&salarytype=annum&contract=true',
  reed: 'https://www.reed.co.uk/jobs/software-tester-jobs-in-London?proximity=10&salaryFrom=60000&contract=true',
  adzuna: 'https://www.adzuna.co.uk/search?q=software+tester&w=London',
  'google-jobs':
    'https://www.google.com/search?q=software+tester+contract+jobs+London&udm=8&hl=en&gl=uk',
  guardian: 'https://jobs.theguardian.com/jobs/software-tester/',
  jobserve: 'https://www.jobserve.com/gb/en/JobSearch.aspx?q=software+tester&l=London',
};

function board(id: string) {
  const found = SHIPPED_BOARDS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no shipped board ${id}`);
  return found;
}

describe('the exact link per board (L-219)', () => {
  it('covers every shipped board', () => {
    expect(Object.keys(PERMANENT).sort()).toEqual(SHIPPED_BOARDS.map((b) => b.id).sort());
    expect(Object.keys(CONTRACT).sort()).toEqual(SHIPPED_BOARDS.map((b) => b.id).sort());
  });

  it.each(Object.entries(PERMANENT))('Permanent — %s', (id, url) => {
    expect(buildBoardUrl(board(id), { ...EXAMPLE, contract: 'permanent' })).toBe(url);
  });

  it.each(Object.entries(CONTRACT))('Contract — %s', (id, url) => {
    expect(buildBoardUrl(board(id), { ...EXAMPLE, contract: 'contract' })).toBe(url);
  });

  it('boundary: 12 miles and £65,000 round to what each site offers — wider, and lower', () => {
    const odd = { ...EXAMPLE, distanceMiles: '12', salaryMin: '65000', contract: 'any' } as const;
    expect(buildBoardUrl(board('indeed'), odd)).toBe(
      'https://uk.indeed.com/jobs?q=software+tester&l=London&radius=15',
    );
    expect(buildBoardUrl(board('linkedin'), odd)).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=software+tester&location=London&distance=25',
    );
    expect(buildBoardUrl(board('cv-library'), odd)).toBe(
      'https://www.cv-library.co.uk/software-tester-jobs-in-London?distance=15&salarymin=65000&salarytype=annum',
    );
    expect(buildBoardUrl(board('totaljobs'), odd)).toBe(
      'https://www.totaljobs.com/jobs/software-tester/in-London?radius=12&salary=60000&salarytypeid=1',
    );
  });

  it('negative: Any contract type and no location — no contract part, no location part', () => {
    const bare = { keywords: 'software tester', location: '', contract: 'any' } as const;
    expect(buildBoardUrl(board('totaljobs'), bare)).toBe(
      'https://www.totaljobs.com/jobs/software-tester',
    );
    expect(buildBoardUrl(board('reed'), bare)).toBe(
      'https://www.reed.co.uk/jobs/software-tester-jobs',
    );
  });
});
