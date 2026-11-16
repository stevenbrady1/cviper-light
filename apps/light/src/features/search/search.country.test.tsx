// @vitest-environment jsdom
/**
 * Search asks which country to search, once, before anything is sent (L-417).
 *
 * The keyed half goes through the REAL `searchJobs` with a transport that
 * records what would have crossed to Rust, so "nothing was sent" and "it went
 * to Germany" are facts about the boundary, not about the screen.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

import { COUNTRY_NOT_CHOSEN, COUNTRY_STORAGE_KEY } from './country';
import { Search } from './Search';
import { SAVED_SEARCHES_STORAGE_KEY } from './savedSearches';
import { createFakeSearchPort, type FakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

/** One advert, as Adzuna answers, with a salary and nothing that names a currency. */
const ADZUNA_ONE = JSON.stringify({
  results: [
    {
      id: '1000000001',
      created: '2026-08-14T09:12:33Z',
      title: 'Data Analyst',
      description: 'Reporting for a housing team.',
      redirect_url: 'https://www.adzuna.de/land/ad/1000000001',
      salary_min: 52000,
      salary_max: 60000,
      company: { display_name: 'Beispiel GmbH' },
      location: { display_name: 'Berlin' },
      contract_type: 'permanent',
    },
  ],
});

interface Sent {
  readonly provider: JobProviderId;
  readonly params: JobSearchParams;
}

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  /** Every search that reached the transport: what would have crossed to Rust. */
  readonly sent: Sent[];
  readonly port: FakeSearchPort;
  readonly browser: FakeBrowserPort;
}

function renderSearch(keys: Record<JobProviderId, KeyState> = BOTH_KEYS): Harness {
  const user = userEvent.setup();
  const sent: Sent[] = [];
  const transport: JobSearchTransport = {
    async search(provider, params) {
      sent.push({ provider, params });
      return ok({ status: 200, body: provider === 'adzuna' ? ADZUNA_ONE : '{"results":[]}' });
    },
  };
  const fake = createFakeSearchPort();
  const port: FakeSearchPort = { ...fake, search: (request) => searchJobs(transport, request) };
  const browser = createFakeBrowserPort();

  let counter = 0;
  render(
    <Search
      port={port}
      browser={browser}
      boardsPort={createFakeBoardPort(NO_PREFERENCES)}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
      onOpenSettings={vi.fn()}
    />,
  );

  return { user, sent, port, browser };
}

const picker = () => screen.getByTestId('search-country') as HTMLSelectElement;
const submit = () => screen.getByTestId('search-submit') as HTMLButtonElement;
const box = (id: string) => screen.getByTestId(id) as HTMLInputElement;

/** Open the "Where to look" fold, so its ticks can be read and pressed. */
function openWhere(): void {
  (screen.getByTestId('search-where-fold') as HTMLDetailsElement).open = true;
}

/** Every control a search is set up with, other than the picker. */
function otherControls(): (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] {
  return [
    box('search-keywords'),
    box('search-location'),
    box('search-distance'),
    box('search-salary'),
    screen.getByTestId('search-contract') as HTMLSelectElement,
    submit(),
    screen.getByTestId('search-open-boards') as HTMLButtonElement,
    ...within(screen.getByTestId('search-where')).getAllByRole<HTMLInputElement>('checkbox', {
      hidden: true,
    }),
  ];
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('a new install is asked first (the raw first visit: nothing is seeded)', () => {
  it('the picker reads "Choose a country", is labelled, required, and explains itself', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');

    expect(picker().value).toBe('');
    expect(picker().selectedOptions[0]?.textContent).toBe('Choose a country');
    expect(screen.getByLabelText('Country')).toBe(picker());
    expect(picker().required).toBe(true);
    expect(picker().disabled).toBe(false);

    const reason = screen.getByTestId('search-country-reason');
    expect(reason.textContent).toBe('Choose a country to search.');
    expect(picker().getAttribute('aria-describedby')).toBe(reason.id);
  });

  it('the Search button is on screen, disabled, and carries the same reason', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');

    expect(submit().disabled).toBe(true);
    expect(submit().textContent).toBe('Search');
    const described = document.getElementById(submit().getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Choose a country to search.');
    // No "tick the free feed" or "get a Reed key" beside it: neither is the fix.
    expect(screen.queryByTestId('search-tick-feeds')).toBeNull();
    expect(screen.queryByTestId('search-get-reed-key')).toBeNull();
    // And the empty page says the same thing, not "tick a free feed".
    expect(screen.getByTestId('search-empty').textContent).toBe(
      'Nothing looked at yet.Choose a country to search.',
    );
  });

  it('negative: every other Search control is in the page and disabled; none is removed', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');
    openWhere();

    const controls = otherControls();
    // Five boxes, two buttons, the two keyed boards, the free feed and the job boards.
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      expect(control.disabled, control.dataset['testid']).toBe(true);
    }
    // The boxes point at the reason, so a screen reader hears why.
    expect(box('search-keywords').getAttribute('aria-describedby')).toBe('search-country-reason');
    expect((screen.getByTestId('saved-search-open') as HTMLButtonElement).disabled).toBe(true);
  });

  it('negative: with no country chosen nothing is sent, whatever is pressed', async () => {
    const { user, sent, port, browser } = renderSearch();
    await screen.findByTestId('search-empty');
    openWhere();

    await user.click(submit());
    await user.type(box('search-keywords'), 'analyst{Enter}');
    await user.click(screen.getByTestId('search-open-boards'));
    // A submit that came from no control, past the browser's own "required"
    // check on the picker: the handler itself is what refuses.
    fireEvent.submit(screen.getByTestId('search-form'));
    await Promise.resolve();

    expect(sent).toEqual([]);
    expect(port.calls.browseKeyless).toBe(0);
    expect(browser.opened()).toEqual([]);
    expect(box('search-keywords').value).toBe('');
  });

  it('the first thing Tab reaches in the form is the picker', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.tab();

    expect(document.activeElement).toBe(picker());
  });

  it('the marker a new install holds is not a country', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, COUNTRY_NOT_CHOSEN);
    renderSearch();
    await screen.findByTestId('search-empty');

    expect(picker().value).toBe('');
    expect(submit().disabled).toBe(true);
  });

  it.each(['xx', 'GB', '../', '{"country":"gb"}'])(
    'negative: a stored %j is not on the list, so the person is asked',
    async (stored) => {
      localStorage.setItem(COUNTRY_STORAGE_KEY, stored);
      renderSearch();
      await screen.findByTestId('search-empty');

      expect(picker().value).toBe('');
      expect(submit().disabled).toBe(true);
    },
  );
});

describe('choosing a country', () => {
  it('happy: Canada enables every control, is saved, and travels with the next search', async () => {
    const { user, sent } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.selectOptions(picker(), 'ca');

    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('ca');
    expect(screen.queryByTestId('search-country-reason')).toBeNull();
    for (const id of ['search-keywords', 'search-location', 'search-distance', 'search-salary']) {
      expect(box(id).disabled, id).toBe(false);
    }
    expect(screen.getByLabelText('Minimum salary (CAD)')).toBe(box('search-salary'));

    await user.type(box('search-keywords'), 'data analyst');
    await user.click(submit());
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider)).toEqual(['adzuna']);
    expect(sent[0]?.params.country).toBe('ca');
    // What Adzuna sent has no currency in it: the stamp is the country's.
    expect(screen.getByTestId('search-results').textContent).toContain('CAD');
    expect(screen.getByTestId('search-results').textContent).not.toContain('£');
  });

  it('negative: choosing never starts a search by itself, and focus stays on the picker', async () => {
    const { user, sent, port } = renderSearch();
    await screen.findByTestId('search-empty');
    picker().focus();

    await user.selectOptions(picker(), 'de');

    expect(sent).toEqual([]);
    expect(port.calls.browseKeyless).toBe(0);
    expect(document.activeElement).toBe(picker());
  });

  it('negative: once a country is chosen, "Choose a country" cannot be picked', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.selectOptions(picker(), 'fr');

    expect([...picker().options].map((option) => option.textContent)).not.toContain(
      'Choose a country',
    );
    expect(picker().options).toHaveLength(20);
  });

  it('boundary: the first and the last entries both work', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.selectOptions(picker(), 'au');
    expect(picker().selectedOptions[0]?.textContent).toBe('Australia');
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('au');

    await user.selectOptions(picker(), 'other');
    expect(picker().selectedOptions[0]?.textContent).toBe('Another country');
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('other');
  });

  it('the choice is still there when Search is opened again', async () => {
    const first = renderSearch();
    await screen.findByTestId('search-empty');
    await first.user.selectOptions(picker(), 'nl');
    cleanup();

    renderSearch();
    await screen.findByTestId('search-empty');

    expect(picker().value).toBe('nl');
    expect(submit().disabled).toBe(false);
  });
});

describe('someone who used the app before', () => {
  beforeEach(() => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
  });

  it('boundary: never sees "Choose a country": the picker reads United Kingdom and nothing waits', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');
    openWhere();

    expect(picker().selectedOptions[0]?.textContent).toBe('United Kingdom');
    expect(screen.queryByTestId('search-country-reason')).toBeNull();
    for (const control of otherControls()) {
      if (control.dataset['testid'] === 'search-open-boards') continue; // nothing ticked to open
      expect(control.disabled, control.dataset['testid']).toBe(false);
    }
    expect(screen.getByLabelText('Minimum salary (£)')).toBe(box('search-salary'));
  });

  it('a UK search crosses exactly as it always did: no country is named, on either board', async () => {
    const { user, sent } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(box('search-keywords'), 'credit risk analyst');
    await user.type(box('search-location'), 'London');
    await user.click(submit());
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider).sort()).toEqual(['adzuna', 'reed']);
    for (const call of sent) {
      expect(JSON.stringify(call.params)).toBe(
        '{"keywords":"credit risk analyst","location":"London","limit":20,' +
          '"distance":null,"salaryMin":null,"employmentType":null}',
      );
    }
    expect(screen.getByTestId('search-results').textContent).toContain('£');
  });

  it('the salary message still names pounds', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(box('search-keywords'), 'analyst');
    await user.type(box('search-salary'), '45k');
    await user.click(submit());

    expect(screen.getByTestId('search-salary-error').textContent).toBe(
      'Enter a salary as whole pounds — 45000, not £45k. Leave it empty for any.',
    );
  });
});

describe('a country other than the United Kingdom', () => {
  it('Germany: Adzuna goes to de in euros; Reed is disabled with its reason and is never asked', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    const { user, sent } = renderSearch();
    await screen.findByTestId('search-empty');
    openWhere();

    const reed = screen.getByTestId('provider-reed') as HTMLInputElement;
    expect(reed.disabled).toBe(true);
    expect(reed.checked).toBe(false);
    expect(screen.getByTestId('provider-blocked-reed').textContent).toBe(
      'Reed lists UK jobs only.',
    );
    expect(reed.getAttribute('aria-describedby')).toBe('provider-blocked-reed');
    // Setting up a key would not change it, so there is no link to Settings.
    expect(screen.queryByTestId('provider-settings-reed')).toBeNull();
    expect((screen.getByTestId('provider-adzuna') as HTMLInputElement).disabled).toBe(false);

    await user.type(box('search-keywords'), 'data analyst');
    await user.click(submit());
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider)).toEqual(['adzuna']);
    expect(sent[0]?.params.country).toBe('de');
    expect(screen.getByTestId('search-results').textContent).toContain('€');
    expect(screen.getByTestId('search-results').textContent).not.toContain('£');
  });

  it('the salary message does not name pounds', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    expect(screen.getByLabelText('Minimum salary (EUR)')).toBe(box('search-salary'));
    await user.type(box('search-keywords'), 'analyst');
    await user.type(box('search-salary'), '45k');
    await user.click(submit());

    expect(screen.getByTestId('search-salary-error').textContent).toBe(
      'Enter a salary as a whole number — 45000, not 45k. Leave it empty for any.',
    );
  });

  it('with no key, a place that looks British does not send a German user for a Reed key', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    const { user } = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');

    await user.type(box('search-location'), 'York');
    openWhere();

    expect(screen.queryByTestId('search-get-reed-key')).toBeNull();
    expect(screen.queryByText(/free Reed key/)).toBeNull();
    // Nor is York called a UK place: the free feed stays on, and Search can run.
    expect(screen.queryByText(/Off for a UK location/)).toBeNull();
    expect((screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement).checked).toBe(true);
    expect(submit().disabled).toBe(false);
  });

  it('the same place in a UK search still follows the UK rules', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
    const { user } = renderSearch(NO_KEYS);
    await screen.findByTestId('search-empty');

    await user.type(box('search-location'), 'York');
    openWhere();

    expect(screen.getByText(/Off for a UK location/)).toBeTruthy();
    expect((screen.getByTestId('keyless-source-arbeitnow') as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.getByTestId('search-reason').textContent).toContain('A free Reed key');
  });

  it('boundary: "Another country": Adzuna is disabled with its reason, and Search still runs for the free feed', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'other');
    const { user, sent, port } = renderSearch();
    await screen.findByTestId('search-empty');
    openWhere();

    const adzuna = screen.getByTestId('provider-adzuna') as HTMLInputElement;
    expect(adzuna.disabled).toBe(true);
    expect(screen.getByTestId('provider-blocked-adzuna').textContent).toBe(
      'Adzuna has no job list for this country.',
    );
    expect((screen.getByTestId('provider-reed') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText('Minimum salary')).toBe(box('search-salary'));

    expect(submit().disabled).toBe(false);
    await user.click(submit());
    await vi.waitFor(() => expect(port.calls.browseKeyless).toBe(1));

    // Neither keyed board was asked anything, under any country's name.
    expect(sent).toEqual([]);
  });
});

describe('saved searches keep the country they were saved for', () => {
  const FORM = {
    keywords: 'data analyst',
    location: 'Berlin',
    distanceMiles: '',
    salaryMin: '',
    contractType: 'any',
  };

  async function save(user: Harness['user'], name: string): Promise<void> {
    await user.click(screen.getByTestId('saved-search-open'));
    await user.clear(screen.getByTestId('saved-search-name'));
    await user.type(screen.getByTestId('saved-search-name'), name);
    await user.click(screen.getByTestId('saved-search-confirm'));
  }

  function storedSearches(): { name: string; country?: string }[] {
    return JSON.parse(localStorage.getItem(SAVED_SEARCHES_STORAGE_KEY) ?? '[]');
  }

  it('a search saved in Germany runs in Germany after the picker has moved on, and the picker says so', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'de');
    const { user, sent } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(box('search-keywords'), 'data analyst');
    await save(user, 'Berlin analysts');
    expect(storedSearches()[0]?.country).toBe('de');

    await user.selectOptions(picker(), 'us');
    // Changing the picker does not rewrite what was saved.
    expect(storedSearches()[0]?.country).toBe('de');

    await user.click(screen.getByText('Berlin analysts'));
    await screen.findByTestId('search-results');

    expect(sent.at(-1)?.params.country).toBe('de');
    expect(picker().value).toBe('de');
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('de');
  });

  it('one saved before countries existed is a UK search, wherever the picker is now', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'us');
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([{ id: 'old', name: 'London risk', form: FORM, boards: [] }]),
    );
    const { user, sent } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.click(screen.getByText('London risk'));
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider).sort()).toEqual(['adzuna', 'reed']);
    for (const call of sent) expect('country' in call.params).toBe(false);
    expect(picker().value).toBe('gb');
  });

  it('a UK search is stored as it always was: with no country in it', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');
    await user.type(box('search-keywords'), 'data analyst');

    await save(user, 'Analysts');

    expect(Object.keys(storedSearches()[0] ?? {}).sort()).toEqual(['boards', 'form', 'id', 'name']);
  });

  it('negative: a saved search for a country this build does not know is not offered', async () => {
    localStorage.setItem(COUNTRY_STORAGE_KEY, 'gb');
    localStorage.setItem(
      SAVED_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        { id: 'a', name: 'Tokyo', form: FORM, boards: [], country: 'jp' },
        { id: 'b', name: 'Kept', form: FORM, boards: [] },
      ]),
    );
    renderSearch();
    await screen.findByTestId('search-empty');

    expect(screen.queryByText('Tokyo')).toBeNull();
    expect(screen.getByText('Kept')).toBeTruthy();
  });
});
