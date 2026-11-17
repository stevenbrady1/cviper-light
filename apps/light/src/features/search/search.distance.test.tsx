// @vitest-environment jsdom
/**
 * Kilometres as well as miles (L-421).
 *
 * The distance box is miles for the United Kingdom and the United States and
 * kilometres for every other country. What crosses to Rust is the number AND
 * its unit, so neither job site can be handed the other one's unit again
 * (L-394). The keyed half goes through the REAL `searchJobs` with a transport
 * that records what would have crossed, so these are facts about the boundary.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok } from '@cviper/core-types';
import {
  searchJobs,
  type JobProviderId,
  type JobSearchParams,
  type JobSearchTransport,
} from '@cviper/job-apis';

import { NO_PREFERENCES } from '../boards/model';
import { createFakeBoardPort } from '../boards/test/fakeBoardPort';
import { createFakeBrowserPort, type FakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { COUNTRY_STORAGE_KEY } from './country';
import {
  EMPTY_FORM,
  boardSearchInput,
  toSearchInput,
  validateForm,
  type SearchForm,
} from './model';
import { Search } from './Search';
import { SAVED_SEARCHES_STORAGE_KEY } from './savedSearches';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

const MILES_SENTENCE = 'Enter a distance in whole miles, or leave it empty for no limit.';
const KM_SENTENCE = 'Enter a distance in whole kilometres, or leave it empty for no limit.';

const form = (overrides: Partial<SearchForm> = {}): SearchForm => ({
  ...EMPTY_FORM,
  keywords: 'data analyst',
  ...overrides,
});

interface Sent {
  readonly provider: JobProviderId;
  readonly params: JobSearchParams;
}

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  /** Every search that reached the transport: what would have crossed to Rust. */
  readonly sent: Sent[];
  readonly browser: FakeBrowserPort;
}

function renderSearch(): Harness {
  const user = userEvent.setup();
  const sent: Sent[] = [];
  const transport: JobSearchTransport = {
    async search(provider, params) {
      sent.push({ provider, params });
      return ok({ status: 200, body: '{"results":[]}' });
    },
  };
  const fake = createFakeSearchPort();
  const browser = createFakeBrowserPort();

  let counter = 0;
  render(
    <Search
      port={{ ...fake, search: (request) => searchJobs(transport, request) }}
      browser={browser}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => BOTH_KEYS}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
      onOpenSettings={vi.fn()}
    />,
  );

  return { user, sent, browser };
}

const picker = () => screen.getByTestId('search-country') as HTMLSelectElement;
const submit = () => screen.getByTestId('search-submit') as HTMLButtonElement;
const box = (id: string) => screen.getByTestId(id) as HTMLInputElement;
const distanceLabel = () =>
  document.querySelector('label[for="search-distance"]')?.textContent ?? null;

async function ready(country: string | null): Promise<Harness> {
  if (country !== null) localStorage.setItem(COUNTRY_STORAGE_KEY, country);
  const harness = renderSearch();
  await screen.findByTestId('search-empty');
  return harness;
}

/** Type a search and press the blue button; resolves once the keyed boards were asked. */
async function search(harness: Harness, distance: string, boards: number): Promise<void> {
  await harness.user.type(box('search-keywords'), 'data analyst');
  if (distance !== '') await harness.user.type(box('search-distance'), distance);
  await harness.user.click(submit());
  await vi.waitFor(() => expect(harness.sent).toHaveLength(boards));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('the form’s rules (no screen)', () => {
  it('regression: with no unit named the distance message is the miles one, word for word', () => {
    expect(validateForm(form({ distanceMiles: 'near-ish' })).distanceMiles).toBe(MILES_SENTENCE);
    expect(
      validateForm(form({ distanceMiles: 'near-ish' }), { distanceUnit: 'miles' }).distanceMiles,
    ).toBe(MILES_SENTENCE);
  });

  it.each(['x', '0', '-5', '2.5', '20km'])(
    'negative: %j is refused in a kilometre search, and the message names kilometres',
    (typed) => {
      const errors = validateForm(form({ distanceMiles: typed }), { distanceUnit: 'km' });

      expect(errors.distanceMiles).toBe(KM_SENTENCE);
      expect(errors.distanceMiles).not.toContain('miles');
    },
  );

  it.each(['x', '0', '-5', '2.5', '20 miles'])(
    'negative: %j is refused in a miles search, and the message names miles',
    (typed) => {
      const errors = validateForm(form({ distanceMiles: typed }), { distanceUnit: 'miles' });

      expect(errors.distanceMiles).toBe(MILES_SENTENCE);
    },
  );

  it('boundary: 1 and the largest whole number pass, in either unit; empty means no limit', () => {
    for (const distanceUnit of ['miles', 'km'] as const) {
      for (const typed of ['1', String(Number.MAX_SAFE_INTEGER), '', '   ']) {
        expect(validateForm(form({ distanceMiles: typed }), { distanceUnit }), typed).toEqual({});
      }
    }
  });

  it('happy: 20 in Germany goes out as 20 km', () => {
    expect(toSearchInput(form({ distanceMiles: '20' }), 'de').distance).toEqual({
      value: 20,
      unit: 'km',
    });
  });

  it('20 in the United States, and in the United Kingdom, goes out as 20 miles', () => {
    expect(toSearchInput(form({ distanceMiles: '20' }), 'us').distance).toEqual({
      value: 20,
      unit: 'miles',
    });
    for (const input of [
      toSearchInput(form({ distanceMiles: '20' })),
      toSearchInput(form({ distanceMiles: '20' }), 'gb'),
    ]) {
      expect(input.distance).toEqual({ value: 20, unit: 'miles' });
      expect('country' in input).toBe(false);
    }
  });

  it('an empty box sends no distance at all, in any country', () => {
    for (const country of ['gb', 'us', 'de'] as const) {
      expect(toSearchInput(form(), country).distance).toBeNull();
    }
  });

  it('a board link is told the unit; told nothing, it is miles as before', () => {
    expect(boardSearchInput(form({ distanceMiles: '20' }), 'km')).toMatchObject({
      distanceMiles: '20',
      distanceUnit: 'km',
    });
    expect('distanceUnit' in boardSearchInput(form({ distanceMiles: '20' }))).toBe(false);
    expect('distanceUnit' in boardSearchInput(form({ distanceMiles: '20' }), 'miles')).toBe(false);
  });
});

describe('the distance box follows the country', () => {
  it.each([
    ['gb', 'Within (miles)'],
    ['us', 'Within (miles)'],
    ['de', 'Within (km)'],
    ['au', 'Within (km)'],
    ['ca', 'Within (km)'],
    ['other', 'Within (km)'],
  ])('%s reads "%s"', async (country, label) => {
    await ready(country);

    expect(distanceLabel()).toBe(label);
    expect(screen.getByLabelText(label)).toBe(box('search-distance'));
  });

  it('boundary: before a country is chosen the box reads as it always did', async () => {
    await ready(null);

    expect(distanceLabel()).toBe('Within (miles)');
    expect(box('search-distance').disabled).toBe(true);
  });

  it('changing the country changes the unit and keeps the number that was typed', async () => {
    const { user } = await ready('gb');
    await user.type(box('search-distance'), '25');

    await user.selectOptions(picker(), 'de');

    expect(distanceLabel()).toBe('Within (km)');
    expect(box('search-distance').value).toBe('25');
  });
});

describe('what crosses to Rust', () => {
  it('happy: in Germany 20 goes out as 20 km, to Adzuna only', async () => {
    const harness = await ready('de');
    await search(harness, '20', 1);

    expect(harness.sent[0]?.provider).toBe('adzuna');
    expect(harness.sent[0]?.params.distance).toEqual({ value: 20, unit: 'km' });
    expect(harness.sent[0]?.params.country).toBe('de');
  });

  it('in the United States 25 goes out as 25 miles', async () => {
    const harness = await ready('us');
    await search(harness, '25', 1);

    expect(harness.sent[0]?.params.distance).toEqual({ value: 25, unit: 'miles' });
  });

  it('regression: a United Kingdom search sends both boards the same 25 miles, and names no country', async () => {
    const harness = await ready('gb');
    await search(harness, '25', 2);

    expect(harness.sent.map((call) => call.provider).sort()).toEqual(['adzuna', 'reed']);
    for (const call of harness.sent) {
      expect(JSON.stringify(call.params)).toBe(
        '{"keywords":"data analyst","location":"","limit":20,' +
          '"distance":{"value":25,"unit":"miles"},"salaryMin":null,"employmentType":null}',
      );
    }
  });

  it('regression: a United Kingdom search with no distance sends none', async () => {
    const harness = await ready('gb');
    await search(harness, '', 2);

    for (const call of harness.sent) {
      expect(call.params.distance).toBeNull();
      expect('distanceMiles' in call.params).toBe(false);
    }
  });

  it.each(['x', '0', '-5', '2.5'])(
    'negative: in Germany %j is refused beside the box, with kilometres named, and nothing is sent',
    async (typed) => {
      const harness = await ready('de');
      await harness.user.type(box('search-keywords'), 'data analyst');
      await harness.user.type(box('search-distance'), typed);
      await harness.user.click(submit());

      expect((await screen.findByTestId('search-distance-error')).textContent).toBe(KM_SENTENCE);
      expect(harness.sent).toEqual([]);
    },
  );

  it('negative: in the United Kingdom the refusal still names miles', async () => {
    const harness = await ready('gb');
    await harness.user.type(box('search-keywords'), 'data analyst');
    await harness.user.type(box('search-distance'), 'far');
    await harness.user.click(submit());

    expect((await screen.findByTestId('search-distance-error')).textContent).toBe(MILES_SENTENCE);
    expect(harness.sent).toEqual([]);
  });
});

describe('"Also open" job boards get the distance in their own unit', () => {
  async function openIndeed(harness: Harness, distance: string, board = 'indeed'): Promise<string> {
    (screen.getByTestId('search-where-fold') as HTMLDetailsElement).open = true;
    await harness.user.type(box('search-keywords'), 'analyst');
    await harness.user.type(box('search-distance'), distance);
    await harness.user.click(screen.getByTestId(`keyless-${board}`));
    await harness.user.click(screen.getByTestId('search-open-boards'));
    await vi.waitFor(() => expect(harness.browser.opened()).toHaveLength(1));
    return harness.browser.opened()[0] ?? '';
  }

  // Germany's own Indeed takes kilometres (L-422), so the miles board here is LinkedIn.
  it('a 20 km search opens LinkedIn, a miles board, at 25 miles: the nearest step that covers it', async () => {
    const harness = await ready('de');

    expect(await openIndeed(harness, '20', 'linkedin')).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=analyst&distance=25',
    );
  });

  it('a 20 km search opens Germany’s Indeed, a kilometre board, at 25 km', async () => {
    const harness = await ready('de');

    expect(await openIndeed(harness, '20', 'indeed-de')).toBe(
      'https://de.indeed.com/jobs?q=analyst&radius=25',
    );
  });

  it('regression: a 20 mile search opens Indeed at 25 miles, as it did', async () => {
    const harness = await ready('gb');

    expect(await openIndeed(harness, '20')).toBe('https://uk.indeed.com/jobs?q=analyst&radius=25');
  });

  it('the board buttons beside few results convert the same way', async () => {
    const harness = await ready('de');
    await search(harness, '20', 1);

    await harness.user.click(await screen.findByTestId('few-linkedin'));

    await vi.waitFor(() => expect(harness.browser.opened()).toHaveLength(1));
    expect(harness.browser.opened()[0]).toBe(
      'https://www.linkedin.com/jobs/search/?keywords=data+analyst&distance=25',
    );
  });

  it('regression: beside few results, a 20 mile search still opens Indeed at 25 miles', async () => {
    const harness = await ready('gb');
    await search(harness, '20', 2);

    await harness.user.click(await screen.findByTestId('few-indeed'));

    await vi.waitFor(() => expect(harness.browser.opened()).toHaveLength(1));
    expect(harness.browser.opened()[0]).toBe('https://uk.indeed.com/jobs?q=data+analyst&radius=25');
  });

  it('negative: a distance that is not a whole number opens nothing and says so in kilometres', async () => {
    const harness = await ready('de');
    (screen.getByTestId('search-where-fold') as HTMLDetailsElement).open = true;
    await harness.user.type(box('search-distance'), 'near');
    await harness.user.click(screen.getByTestId('keyless-indeed-de'));
    await harness.user.click(screen.getByTestId('search-open-boards'));

    expect((await screen.findByTestId('search-distance-error')).textContent).toBe(KM_SENTENCE);
    expect(harness.browser.opened()).toEqual([]);
  });
});

describe('a saved search keeps the unit of the country it was saved for', () => {
  const SAVED = { keywords: 'data analyst', location: 'Leeds', salaryMin: '', contractType: 'any' };

  it('regression: one saved before countries existed is still 25 miles, wherever the picker is now', async () => {
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        { id: 'old', name: 'Leeds analysts', form: { ...SAVED, distanceMiles: '25' }, boards: [] },
      ]),
    );
    const harness = await ready('de');

    await harness.user.click(screen.getByText('Leeds analysts'));
    await vi.waitFor(() => expect(harness.sent).toHaveLength(2));

    expect(harness.sent.map((call) => call.provider).sort()).toEqual(['adzuna', 'reed']);
    for (const call of harness.sent) {
      expect(call.params.distance).toEqual({ value: 25, unit: 'miles' });
      expect('country' in call.params).toBe(false);
    }
    expect(distanceLabel()).toBe('Within (miles)');
  });

  it('one saved for Germany is still 20 km when run from a United Kingdom picker', async () => {
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'berlin',
          name: 'Berlin analysts',
          form: { ...SAVED, location: 'Berlin', distanceMiles: '20' },
          boards: [],
          country: 'de',
        },
      ]),
    );
    const harness = await ready('gb');

    await harness.user.click(screen.getByText('Berlin analysts'));
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1));

    expect(harness.sent[0]?.params.distance).toEqual({ value: 20, unit: 'km' });
    expect(harness.sent[0]?.params.country).toBe('de');
    expect(distanceLabel()).toBe('Within (km)');
  });

  it('the number is stored exactly as it was typed, with no unit beside it', async () => {
    const harness = await ready('de');
    await harness.user.type(box('search-keywords'), 'data analyst');
    await harness.user.type(box('search-distance'), '20');
    await harness.user.click(screen.getByTestId('saved-search-open'));
    await harness.user.click(screen.getByTestId('saved-search-confirm'));

    const stored = JSON.parse(localStorage.getItem(SAVED_SEARCHES_STORAGE_KEY) ?? '[]') as {
      form: Record<string, unknown>;
      country?: string;
    }[];
    expect(stored[0]?.form['distanceMiles']).toBe('20');
    expect(Object.keys(stored[0]?.form ?? {}).sort()).toEqual([
      'contractType',
      'distanceMiles',
      'keywords',
      'location',
      'salaryMin',
    ]);
    expect(stored[0]?.country).toBe('de');
  });
});
