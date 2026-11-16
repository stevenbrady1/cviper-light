/**
 * A distance travels with its unit (L-421).
 *
 * The box on Search is miles in the United Kingdom and the United States and
 * kilometres everywhere else. Adzuna wants kilometres and Reed wants miles, so
 * a bare number is the thing that went wrong once already (L-394): what crosses
 * to Rust is the number AND its unit, or no distance at all.
 */
import { describe, expect, it } from 'vitest';

import { type BoardTemplate } from '@cviper/core-types';

import { ADZUNA_COUNTRIES, DISTANCE_UNITS, distanceUnitFor, isDistanceUnit } from './countries';
import { buildBoardUrl } from './links';
import { buildSearchParams, type SearchInput } from './params';

const SENSIBLE = { keywords: 'credit risk analyst', location: 'London' };
const BOTH = ['adzuna', 'reed'] as const;

describe('distanceUnitFor — the one rule for which unit a country searches in', () => {
  it('there are exactly two units', () => {
    expect([...DISTANCE_UNITS]).toEqual(['miles', 'km']);
  });

  it.each(['gb', 'us'] as const)('happy: %s searches in miles', (country) => {
    expect(distanceUnitFor(country)).toBe('miles');
  });

  it.each(ADZUNA_COUNTRIES.filter((country) => country !== 'gb' && country !== 'us'))(
    'happy: %s searches in kilometres',
    (country) => {
      expect(distanceUnitFor(country)).toBe('km');
    },
  );

  it('covers all nineteen: two in miles, seventeen in kilometres', () => {
    const units = ADZUNA_COUNTRIES.map((country) => distanceUnitFor(country));
    expect(units.filter((unit) => unit === 'miles')).toHaveLength(2);
    expect(units.filter((unit) => unit === 'km')).toHaveLength(17);
  });

  it('edge: a country that is not on the list ("Another country") is kilometres', () => {
    expect(distanceUnitFor('other')).toBe('km');
    expect(distanceUnitFor('xx')).toBe('km');
  });

  it('boundary: a search that names no country is a United Kingdom search, so miles', () => {
    expect(distanceUnitFor(null)).toBe('miles');
    expect(distanceUnitFor(undefined)).toBe('miles');
  });

  it('negative: case and spaces count, as they do for a country code', () => {
    expect(distanceUnitFor('GB')).toBe('km');
    expect(distanceUnitFor(' us')).toBe('km');
  });
});

describe('isDistanceUnit', () => {
  it('accepts the two and nothing else', () => {
    expect(isDistanceUnit('miles')).toBe(true);
    expect(isDistanceUnit('km')).toBe(true);
    for (const bad of ['Miles', 'KM', 'mi', 'kilometres', '', ' km', 'constructor', 1, null]) {
      expect(isDistanceUnit(bad), String(bad)).toBe(false);
    }
  });
});

describe('buildSearchParams — the distance and its unit', () => {
  it('happy: 20 km for Germany crosses as 20 km', () => {
    const built = buildSearchParams('adzuna', {
      ...SENSIBLE,
      country: 'de',
      distance: { value: 20, unit: 'km' },
    });

    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.distance).toEqual({ value: 20, unit: 'km' });
  });

  it('happy: 25 miles for the United Kingdom crosses as 25 miles, on both boards', () => {
    for (const provider of BOTH) {
      const built = buildSearchParams(provider, {
        ...SENSIBLE,
        distance: { value: 25, unit: 'miles' },
      });

      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(JSON.stringify(built.value)).toBe(
          '{"keywords":"credit risk analyst","location":"London","limit":20,' +
            '"distance":{"value":25,"unit":"miles"},"salaryMin":null,"employmentType":null}',
        );
      }
    }
  });

  it('no distance asked for: `distance` is null, and no bare number field exists', () => {
    for (const input of [SENSIBLE, { ...SENSIBLE, distance: null }]) {
      const built = buildSearchParams('adzuna', input);

      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.distance).toBeNull();
        expect('distanceMiles' in built.value).toBe(false);
      }
    }
  });

  it.each(['furlongs', 'Miles', 'KM', 'mi', 'kilometres', '', ' km', 'constructor', null, 7])(
    'negative: a unit outside the two (%j) is refused, never guessed',
    (unit) => {
      for (const provider of BOTH) {
        const built = buildSearchParams(provider, {
          ...SENSIBLE,
          distance: { value: 25, unit },
        } as unknown as SearchInput);

        expect(built.ok).toBe(false);
        if (!built.ok) {
          expect(built.error.kind).toBe('bad-request');
          // Fixed words: what was sent is never repeated back.
          expect(built.error.message).toBe('The search could not be sent. Try again.');
        }
      }
    },
  );

  it.each([[25], ['25'], [{ value: 25 }], [[25, 'miles']]])(
    'negative: a distance with no unit (%j) is refused, not sent as a bare number',
    (distance) => {
      const built = buildSearchParams('adzuna', {
        ...SENSIBLE,
        distance,
      } as unknown as SearchInput);

      expect(built.ok).toBe(false);
    },
  );

  it.each([0, -10, Number.NaN, 'ten', null])(
    'a number that cannot be read (%j) is dropped, as every unreadable filter is',
    (value) => {
      const built = buildSearchParams('adzuna', {
        ...SENSIBLE,
        distance: { value, unit: 'km' },
      } as unknown as SearchInput);

      expect(built.ok).toBe(true);
      if (built.ok) expect(built.value.distance).toBeNull();
    },
  );

  it('boundary: 1 and the largest whole number pass, in either unit', () => {
    for (const unit of DISTANCE_UNITS) {
      for (const value of [1, Number.MAX_SAFE_INTEGER]) {
        const built = buildSearchParams('adzuna', { ...SENSIBLE, distance: { value, unit } });

        expect(built.ok).toBe(true);
        if (built.ok) expect(built.value.distance).toEqual({ value, unit });
      }
    }
  });

  it('edge: a fraction is floored, as it always was, and keeps its unit', () => {
    const built = buildSearchParams('adzuna', {
      ...SENSIBLE,
      distance: { value: 20.9, unit: 'km' },
    });

    expect(built.ok).toBe(true);
    if (built.ok) expect(built.value.distance).toEqual({ value: 20, unit: 'km' });
  });
});

describe('buildBoardUrl — a board link converts from the search’s unit to the board’s', () => {
  const board = (radius: NonNullable<BoardTemplate['filters']>['radius']): BoardTemplate => ({
    id: 'b',
    label: 'Board',
    urlTemplate: 'https://example.invalid/jobs?q={keyword}&radius={radius}',
    encoding: 'plus',
    ...(radius === undefined ? {} : { filters: { radius } }),
  });
  const radius = (
    template: BoardTemplate,
    distanceMiles: string,
    distanceUnit?: 'miles' | 'km',
  ): string | null =>
    new URL(
      buildBoardUrl(template, {
        keywords: 'tester',
        location: '',
        distanceMiles,
        ...(distanceUnit === undefined ? {} : { distanceUnit }),
      }),
    ).searchParams.get('radius');

  const MILES_STEPS = board({ unit: 'miles', steps: [5, 10, 15, 25, 50] });

  it('happy: a km search opens a miles board at the nearest step that covers it', () => {
    // 20 km is 12.4 miles: 12, and the smallest step not narrower than that is 15.
    expect(radius(MILES_STEPS, '20', 'km')).toBe('15');
  });

  it('a km search on a miles board with no steps sends the nearest whole mile', () => {
    expect(radius(board({ unit: 'miles' }), '20', 'km')).toBe('12');
    expect(radius(board({ unit: 'miles' }), '100', 'km')).toBe('62');
  });

  it('a km search on a km board sends the number as typed: converted once, not twice', () => {
    expect(radius(board({ unit: 'km' }), '20', 'km')).toBe('20');
    expect(radius(board({ unit: 'km', steps: [10, 25, 50] }), '20', 'km')).toBe('25');
  });

  it('a board that names no unit is a miles board, for a km search too', () => {
    expect(radius(board(undefined), '20', 'km')).toBe('12');
  });

  it('regression: a miles search is exactly what it was, named or not', () => {
    for (const unit of [undefined, 'miles'] as const) {
      expect(radius(MILES_STEPS, '10', unit)).toBe('10');
      expect(radius(MILES_STEPS, '20', unit)).toBe('25');
      expect(radius(board({ unit: 'km' }), '10', unit)).toBe('16');
      expect(radius(board(undefined), '10', unit)).toBe('10');
    }
  });

  it('boundary: 1 km never becomes a radius of nothing', () => {
    expect(radius(board({ unit: 'miles' }), '1', 'km')).toBe('1');
  });

  it('negative: a distance that is not a whole number adds nothing, in either unit', () => {
    for (const typed of ['', 'ten', '0', '-5', '2.5']) {
      expect(radius(MILES_STEPS, typed, 'km'), typed).toBeNull();
    }
  });
});
