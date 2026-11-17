/**
 * A built-in board ships for a country ONLY if its address was proved (L-422).
 *
 * ============================================================================
 * THE OWNER'S RULE, AND THE TABLE IT WAS APPLIED TO
 * ============================================================================
 * Each address below was opened in a real browser on 17 November 2026 and
 * showed that country's job results. The ones NOT here were tried and did not:
 * Adzuna's own site for us, br, ca, mx, nz, sg and za asks every visitor to
 * prove they are human before it shows anything; Google Jobs shows an empty
 * page for at, be, fr and nl and plain web results for au, nz and pl.
 *
 * So this test holds `job-boards.json` to the table in BOTH directions: nothing
 * missing, and nothing extra. Adding a board for a country means proving its
 * address first and adding it here, where a person reads both.
 *
 * The United Kingdom's nine are pinned, link by link, in `defaults.test.ts`
 * and `shippedBoards.urls.test.ts`.
 */
import { ADZUNA_COUNTRIES, buildBoardUrl } from '@cviper/job-apis';
import { describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS, OUTBOUND_HOST_NAMES } from '../../lib/outbound-hosts';

import { SHIPPED_BOARDS, SHIPPED_BOARDS_PROBLEM, shippedBoardsFor } from './defaults';

const INDEED_SITES: Readonly<Record<string, string>> = {
  us: 'www.indeed.com',
  at: 'at.indeed.com',
  au: 'au.indeed.com',
  be: 'be.indeed.com',
  br: 'br.indeed.com',
  ca: 'ca.indeed.com',
  ch: 'ch.indeed.com',
  de: 'de.indeed.com',
  es: 'es.indeed.com',
  fr: 'fr.indeed.com',
  in: 'in.indeed.com',
  it: 'it.indeed.com',
  mx: 'mx.indeed.com',
  nl: 'nl.indeed.com',
  nz: 'nz.indeed.com',
  pl: 'pl.indeed.com',
  sg: 'sg.indeed.com',
  za: 'za.indeed.com',
};

const ADZUNA_SITES: Readonly<Record<string, string>> = {
  at: 'www.adzuna.at',
  au: 'www.adzuna.com.au',
  be: 'www.adzuna.be',
  ch: 'www.adzuna.ch',
  de: 'www.adzuna.de',
  es: 'www.adzuna.es',
  fr: 'www.adzuna.fr',
  in: 'www.adzuna.in',
  it: 'www.adzuna.it',
  nl: 'www.adzuna.nl',
  pl: 'www.adzuna.pl',
};

const GOOGLE_COUNTRIES: readonly string[] = [
  'us',
  'ca',
  'br',
  'ch',
  'de',
  'es',
  'in',
  'it',
  'mx',
  'sg',
  'za',
];

const OTHER_COUNTRIES = ADZUNA_COUNTRIES.filter((country) => country !== 'gb');

/** `country | id | address`, for every proved board that belongs to one country. */
const PROVED: readonly string[] = OTHER_COUNTRIES.flatMap((country) => [
  `${country} | indeed-${country} | https://${INDEED_SITES[country] ?? '?'}/jobs?q={keyword}&l={location}&radius={radius}`,
  ...(country in ADZUNA_SITES
    ? [
        `${country} | adzuna-${country} | https://${ADZUNA_SITES[country] ?? '?'}/search?q={keyword}&w={location}`,
      ]
    : []),
  ...(GOOGLE_COUNTRIES.includes(country)
    ? [
        `${country} | google-jobs-${country} | https://www.google.com/search?q={keyword}+{contract}+jobs+{location}&udm=8&hl=en&gl=${country}`,
      ]
    : []),
]);

/** What the file really ships for the other eighteen, in the same words. */
const SHIPPED: readonly string[] = SHIPPED_BOARDS.flatMap((board) =>
  (board.countries ?? [])
    .filter((country) => country !== 'gb')
    .map((country) => `${country} | ${board.id} | ${board.urlTemplate}`),
);

const EXAMPLE = { keywords: 'data analyst', location: 'Berlin', distanceMiles: '20' } as const;

function board(id: string) {
  const found = SHIPPED_BOARDS.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no shipped board ${id}`);
  return found;
}

describe('a board ships for a country only if its address was proved', () => {
  it('the file reads, and the table is not empty', () => {
    // Anti-inert: an unreadable file would make both lists empty and equal.
    expect(SHIPPED_BOARDS_PROBLEM).toBeNull();
    expect(PROVED).toHaveLength(18 + 11 + 11);
    expect(OTHER_COUNTRIES).toHaveLength(18);
  });

  it('ships every proved board, and not one that was not proved', () => {
    expect([...SHIPPED].sort()).toEqual([...PROVED].sort());
  });

  it('offers exactly one board everywhere, and it is LinkedIn', () => {
    // A board that loses its `countries` is offered to all nineteen, unproved.
    const everywhere = SHIPPED_BOARDS.filter((shipped) => shipped.countries === undefined);
    expect(everywhere.map((shipped) => shipped.id)).toEqual(['linkedin']);
  });

  it('names only the nineteen countries a search can be for', () => {
    for (const shipped of SHIPPED_BOARDS) {
      for (const country of shipped.countries ?? []) {
        expect(ADZUNA_COUNTRIES as readonly string[], shipped.id).toContain(country);
      }
    }
  });

  it('ships forty-nine boards in all: the UK nine and the forty proved', () => {
    expect(SHIPPED_BOARDS).toHaveLength(9 + PROVED.length);
    expect(new Set(SHIPPED_BOARDS.map((shipped) => shipped.id)).size).toBe(SHIPPED_BOARDS.length);
  });

  it('negative: an unproved pair is absent — Adzuna for Canada, Google Jobs for France', () => {
    const ids = (country: string) => shippedBoardsFor(country).map((shipped) => shipped.id);

    expect(ids('ca')).not.toContain('adzuna-ca');
    expect(ids('fr')).not.toContain('google-jobs-fr');
    expect(SHIPPED_BOARDS.map((shipped) => shipped.id)).not.toContain('adzuna-us');
    expect(SHIPPED_BOARDS.map((shipped) => shipped.id)).not.toContain('google-jobs-au');
  });
});

describe('the distance each country’s Indeed takes', () => {
  it('is kilometres everywhere but the United States, with the UK’s own steps', () => {
    const steps = board('indeed').filters?.radius?.steps;
    expect(steps).toEqual([5, 10, 15, 25, 35, 50, 100]);

    for (const country of OTHER_COUNTRIES) {
      const radius = board(`indeed-${country}`).filters?.radius;
      expect(radius?.unit, country).toBe(country === 'us' ? 'miles' : 'km');
      expect(radius?.steps, country).toEqual(steps);
    }
  });

  it('a 20 km search opens Indeed Germany at 25 km, and LinkedIn at 25 miles', () => {
    const search = { ...EXAMPLE, distanceUnit: 'km' } as const;

    expect(buildBoardUrl(board('indeed-de'), search)).toBe(
      'https://de.indeed.com/jobs?q=data+analyst&l=Berlin&radius=25',
    );
    // 20 km is 12 miles; LinkedIn's next step up is 25.
    expect(buildBoardUrl(board('linkedin'), search)).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=data+analyst&location=Berlin&distance=25',
    );
  });

  it('a 20 mile search opens Indeed United States at 25 miles', () => {
    expect(buildBoardUrl(board('indeed-us'), { ...EXAMPLE, location: 'Boston' })).toBe(
      'https://www.indeed.com/jobs?q=data+analyst&l=Boston&radius=25',
    );
  });

  it('boundary: with no location and no distance, every proved link is still whole', () => {
    for (const shipped of SHIPPED_BOARDS) {
      const url = buildBoardUrl(shipped, { keywords: 'data analyst', location: '' });
      expect(() => new URL(url), shipped.id).not.toThrow();
      expect(url, shipped.id).not.toMatch(/[{}]|=($|&)/);
    }
    expect(buildBoardUrl(board('adzuna-de'), { keywords: 'data analyst', location: '' })).toBe(
      'https://www.adzuna.de/search?q=data+analyst',
    );
    expect(
      buildBoardUrl(board('google-jobs-ca'), { keywords: 'data analyst', location: 'Toronto' }),
    ).toBe('https://www.google.com/search?q=data+analyst+jobs+Toronto&udm=8&hl=en&gl=ca');
  });
});

describe('every built-in address is on the allowed-sites list, with the sentence it already had', () => {
  const why = (host: string) => OUTBOUND_HOSTS.find((entry) => entry.host === host)?.why;

  it('lists the site of every shipped board', () => {
    for (const shipped of SHIPPED_BOARDS) {
      const host = new URL(shipped.urlTemplate).hostname;
      expect(OUTBOUND_HOST_NAMES.has(host), `${shipped.id}: ${host}`).toBe(true);
    }
  });

  it('gives each country’s Indeed the United Kingdom’s sentence, word for word', () => {
    const uk = why('uk.indeed.com');
    expect(uk).toBe(
      'A keyless search link for Indeed, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
    );
    for (const host of Object.values(INDEED_SITES)) expect(why(host), host).toBe(uk);
  });

  it('says of each country’s Adzuna site only what is true of it: a search link', () => {
    for (const host of Object.values(ADZUNA_SITES)) {
      expect(why(host), host).toBe(
        'A keyless search link for Adzuna’s public search, from job-boards.json. Pressing it hands the address to your own browser; the app never loads the page.',
      );
    }
    // The word “Adzuna” on an advert still links to the United Kingdom's site only.
    expect(why('www.adzuna.co.uk')).toContain('the word “Adzuna” on each Adzuna advert');
  });

  it('opens every one of them in the browser, and fetches none', () => {
    for (const host of [...Object.values(INDEED_SITES), ...Object.values(ADZUNA_SITES)]) {
      expect(OUTBOUND_HOSTS.find((entry) => entry.host === host)?.purpose, host).toBe(
        'opened-in-your-browser',
      );
    }
  });

  it('negative: a site that was not proved is not on the list', () => {
    for (const host of ['www.adzuna.com', 'www.adzuna.ca', 'www.adzuna.sg', 'www.adzuna.co.za']) {
      expect(OUTBOUND_HOST_NAMES.has(host), host).toBe(false);
    }
  });
});
