/**
 * L-219: a board link carries every filter the board can take — distance,
 * minimum salary and contract type — as well as the keyword and location.
 * An empty or unusable filter adds nothing to the link; a filter the board
 * cannot take is simply not in its template.
 */
import { describe, expect, it } from 'vitest';

import { type BoardTemplate } from '@cviper/core-types';

import { boardFilterSupport, boardTemplateProblem, buildBoardUrl } from './links';

const QUERY_BOARD: BoardTemplate = {
  id: 'q',
  label: 'Query board',
  urlTemplate:
    'https://example.co.uk/jobs?q={keyword}&l={location}&radius={radius}&salary={salaryMin}&type={contract}',
  encoding: 'plus',
  filters: {
    radius: { unit: 'miles', steps: [5, 10, 15, 25, 50] },
    salaryMin: { steps: [20000, 30000, 40000, 50000, 60000, 80000, 100000] },
    contract: { permanent: 'permanent', contract: 'contract' },
  },
};

const ALL = {
  keywords: 'software tester',
  location: 'London',
  distanceMiles: '10',
  salaryMin: '60000',
  contract: 'permanent',
} as const;

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

describe('buildBoardUrl — the extra filters (L-219)', () => {
  it('happy: every filter goes in, each in the board’s own words', () => {
    expect(params(buildBoardUrl(QUERY_BOARD, ALL))).toEqual({
      q: 'software tester',
      l: 'London',
      radius: '10',
      salary: '60000',
      type: 'permanent',
    });
  });

  it('negative: no filters set — no filter parameter at all, not an empty one', () => {
    const url = buildBoardUrl(QUERY_BOARD, { keywords: 'tester', location: 'London' });
    expect(url).toBe('https://example.co.uk/jobs?q=tester&l=London');
  });

  it('"any" contract adds nothing; a contract the board has no word for adds nothing', () => {
    expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, contract: 'any' }))).not.toHaveProperty(
      'type',
    );
    const permanentOnly: BoardTemplate = {
      ...QUERY_BOARD,
      filters: { ...QUERY_BOARD.filters, contract: { permanent: 'perm' } },
    };
    expect(
      params(buildBoardUrl(permanentOnly, { ...ALL, contract: 'contract' })),
    ).not.toHaveProperty('type');
  });

  describe('distance', () => {
    it('boundary: snaps UP to the board’s next step, so no job the user wanted is cut off', () => {
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, distanceMiles: '12' }))['radius']).toBe(
        '15',
      );
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, distanceMiles: '5' }))['radius']).toBe(
        '5',
      );
    });

    it('boundary: beyond the widest step, the widest step', () => {
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, distanceMiles: '400' }))['radius']).toBe(
        '50',
      );
    });

    it('converts to kilometres for a board that measures in km', () => {
      const km: BoardTemplate = {
        ...QUERY_BOARD,
        filters: { ...QUERY_BOARD.filters, radius: { unit: 'km' } },
      };
      expect(params(buildBoardUrl(km, { ...ALL, distanceMiles: '10' }))['radius']).toBe('16');
    });

    it.each(['0', '-5', 'ten', '1.5.2', ' ', '99999'])(
      'negative: "%s" is not a distance, so none is sent',
      (typed) => {
        expect(
          params(buildBoardUrl(QUERY_BOARD, { ...ALL, distanceMiles: typed })),
        ).not.toHaveProperty('radius');
      },
    );

    it('a board with no steps gets the miles as typed, whole', () => {
      const free: BoardTemplate = {
        ...QUERY_BOARD,
        filters: { ...QUERY_BOARD.filters, radius: { unit: 'miles' } },
      };
      expect(params(buildBoardUrl(free, { ...ALL, distanceMiles: '12' }))['radius']).toBe('12');
    });
  });

  describe('minimum salary', () => {
    it('boundary: snaps DOWN to the board’s step, so a job paying what was asked is not hidden', () => {
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, salaryMin: '65000' }))['salary']).toBe(
        '60000',
      );
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, salaryMin: '60000' }))['salary']).toBe(
        '60000',
      );
    });

    it('boundary: below the lowest step there is no floor to send', () => {
      expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, salaryMin: '15000' }))).not.toHaveProperty(
        'salary',
      );
    });

    it('reads the ways people type a salary: £, commas, spaces and k', () => {
      for (const typed of ['£60,000', '60 000', '60k', '60K', '£60k']) {
        expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, salaryMin: typed }))['salary']).toBe(
          '60000',
        );
      }
    });

    it.each(['0', 'lots', '-1', '£', '60k60', '999999999'])(
      'negative: "%s" is not a salary, so none is sent',
      (typed) => {
        expect(params(buildBoardUrl(QUERY_BOARD, { ...ALL, salaryMin: typed }))).not.toHaveProperty(
          'salary',
        );
      },
    );
  });

  it('a value can never smuggle in another parameter', () => {
    const url = buildBoardUrl(QUERY_BOARD, { ...ALL, distanceMiles: '10&evil=1' });
    expect(params(url)).not.toHaveProperty('evil');
  });

  it('path boards: a filter in the query still drops cleanly when empty', () => {
    const path: BoardTemplate = {
      id: 'p',
      label: 'Path board',
      urlTemplate: 'https://example.co.uk/{keyword}-jobs-in-{location}?distance={radius}',
      encoding: 'hyphen',
      filters: { radius: { unit: 'miles' } },
    };
    expect(buildBoardUrl(path, { keywords: 'tester', location: 'Leeds' })).toBe(
      'https://example.co.uk/tester-jobs-in-Leeds',
    );
    expect(
      buildBoardUrl(path, { keywords: 'tester', location: 'Leeds', distanceMiles: '10' }),
    ).toBe('https://example.co.uk/tester-jobs-in-Leeds?distance=10');
  });

  it('a custom board (no filters section) gets plain values: miles, pounds, and the word', () => {
    const custom: BoardTemplate = {
      id: 'c',
      label: 'Custom',
      urlTemplate: 'https://example.co.uk/s?q={keyword}&r={radius}&min={salaryMin}&t={contract}',
      encoding: 'plus',
    };
    expect(params(buildBoardUrl(custom, { ...ALL, salaryMin: '£60k' }))).toEqual({
      q: 'software tester',
      r: '10',
      min: '60000',
      t: 'permanent',
    });
  });
});

describe('boardFilterSupport (L-219)', () => {
  it('says which filters a board’s link carries', () => {
    expect(boardFilterSupport(QUERY_BOARD)).toEqual({
      location: true,
      radius: true,
      salaryMin: true,
      contract: true,
    });
    expect(
      boardFilterSupport({
        id: 'g',
        label: 'G',
        urlTemplate: 'https://example.com/jobs/{keyword}/',
        encoding: 'hyphen',
      }),
    ).toEqual({ location: false, radius: false, salaryMin: false, contract: false });
  });
});

describe('boardTemplateProblem — the new placeholders (L-219)', () => {
  it('accepts a custom board that uses them', () => {
    expect(boardTemplateProblem(QUERY_BOARD.urlTemplate)).toBeNull();
  });

  it('negative: refuses one in the site’s name', () => {
    expect(boardTemplateProblem('https://{radius}.example.com/jobs?q={keyword}')).not.toBeNull();
  });
});

describe('board-specific rules (L-219)', () => {
  const RULES: BoardTemplate = {
    id: 'r',
    label: 'Rules',
    urlTemplate: 'https://example.co.uk/{keyword}-jobs?salary={salaryMin}&{contract}',
    encoding: 'hyphen',
    filters: {
      salaryMin: { with: '&salarytype=annum' },
      contract: { permanent: 'perm=true', contract: 'contract=true' },
    },
  };

  it('a companion parameter goes with the salary, and only with it', () => {
    expect(buildBoardUrl(RULES, { keywords: 'tester', location: '', salaryMin: '60000' })).toBe(
      'https://example.co.uk/tester-jobs?salary=60000&salarytype=annum',
    );
    expect(buildBoardUrl(RULES, { keywords: 'tester', location: '' })).toBe(
      'https://example.co.uk/tester-jobs',
    );
  });

  it('a contract word can be a whole parameter', () => {
    expect(buildBoardUrl(RULES, { keywords: 'tester', location: '', contract: 'permanent' })).toBe(
      'https://example.co.uk/tester-jobs?perm=true',
    );
  });

  it('a contract word can be a path segment, and the segment goes when it is empty', () => {
    const path: BoardTemplate = {
      id: 'p',
      label: 'Path',
      urlTemplate: 'https://example.co.uk/jobs/{contract}/{keyword}/in-{location}',
      encoding: 'hyphen',
      filters: { contract: { permanent: 'permanent' } },
    };
    expect(
      buildBoardUrl(path, { keywords: 'tester', location: 'Leeds', contract: 'permanent' }),
    ).toBe('https://example.co.uk/jobs/permanent/tester/in-Leeds');
    expect(
      buildBoardUrl(path, { keywords: 'tester', location: 'Leeds', contract: 'contract' }),
    ).toBe('https://example.co.uk/jobs/tester/in-Leeds');
  });
});
