// @vitest-environment jsdom
/**
 * L-417 end to end in the shell: who is asked which country to search, and
 * what then crosses to the job boards.
 *
 * The keyed half goes through the REAL `searchJobs` with a transport that
 * records what would have crossed to Rust. Storage is real `localStorage`, and
 * the welcome is dismissed the way a person dismisses it: nothing here writes
 * the country by hand except the one test that is about a stored choice.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId, type JobSearchParams } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { ok } = await import('@cviper/core-types');
const { searchJobs } = await import('@cviper/job-apis');
const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { COUNTRY_STORAGE_KEY } = await import('../features/search/country');
const { SEARCH_STORAGE_KEY } = await import('../features/search/memory');
const { forgetLocalStorage } = await import('../features/settings/erase/port');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

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

/** Everything that reached the transport, across every render in a test. */
let sent: { provider: JobProviderId; params: JobSearchParams }[] = [];
let browses = 0;

beforeEach(() => {
  localStorage.clear();
  sent = [];
  browses = 0;
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo'];
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(cleanup);

/** Start the app. Called again in a test, it is the app being closed and reopened. */
async function startApp() {
  const user = userEvent.setup();
  const fake = createFakeSearchPort();
  const erase = createFakeErasePort();

  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      searchPort={{
        ...fake,
        search: (request) =>
          searchJobs(
            {
              async search(provider, params) {
                sent.push({ provider, params });
                return ok({
                  status: 200,
                  body: provider === 'adzuna' ? ADZUNA_ONE : '{"results":[]}',
                });
              },
            },
            request,
          ),
        browseKeyless: (request) => {
          browses += 1;
          return fake.browseKeyless(request);
        },
      }}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => ({ adzuna: 'configured', reed: 'configured' })}
      backupPort={createFakeBackupPort()}
      erasePort={{
        ...erase,
        // As the real port does: every preference in browser storage goes.
        forgetPreferences: async () => {
          forgetLocalStorage(localStorage);
          return ok(undefined);
        },
      }}
      filePort={createFakeFilePort()}
      now={NOW}
    />,
  );

  return { user };
}

const picker = () => screen.getByTestId('search-country') as HTMLSelectElement;
const submit = () => screen.getByTestId('search-submit') as HTMLButtonElement;

async function openSearch(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByTestId('nav-search'));
  await screen.findByTestId('search-empty');
}

describe('a new install', () => {
  it('is asked on Search, picks Germany, and the search goes to de in euros', async () => {
    const { user } = await startApp();

    // The welcome's own "Find jobs" route, as a first-time user takes it.
    await user.click(await screen.findByTestId('welcome-action-search'));
    await screen.findByTestId('search-empty');

    expect(picker().selectedOptions[0]?.textContent).toBe('Choose a country');
    expect(screen.getByTestId('search-country-reason').textContent).toBe(
      'Choose a country to search.',
    );
    expect(submit().disabled).toBe(true);
    await user.click(submit());
    expect(sent).toEqual([]);
    expect(browses).toBe(0);

    await user.selectOptions(picker(), 'de');
    await user.type(screen.getByTestId('search-keywords'), 'data analyst');
    await user.click(submit());
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider)).toEqual(['adzuna']);
    expect(sent[0]?.params.country).toBe('de');
    expect(screen.getByTestId('search-results').textContent).toContain('€');
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('de');
  });

  it('regression: is STILL asked after leaving the welcome and reopening the app', async () => {
    const first = await startApp();
    await first.user.click(await screen.findByTestId('welcome-skip'));
    await screen.findByTestId('shell');
    cleanup();

    // The welcome flag is now set: without the marker this would look like a
    // returning user and quietly become the United Kingdom.
    const { user } = await startApp();
    await openSearch(user);

    expect(picker().value).toBe('');
    expect(submit().disabled).toBe(true);
  });

  it('the choice survives the app being closed and reopened', async () => {
    const first = await startApp();
    await first.user.click(await screen.findByTestId('welcome-action-search'));
    await screen.findByTestId('search-empty');
    await first.user.selectOptions(picker(), 'ca');
    cleanup();

    const { user } = await startApp();
    await openSearch(user);

    expect(picker().selectedOptions[0]?.textContent).toBe('Canada');
    expect(submit().disabled).toBe(false);
  });
});

describe('someone who used the app before this build', () => {
  it('is never asked: the picker reads United Kingdom, and the request is the one it always was', async () => {
    markWelcomeSeen();
    const { user } = await startApp();
    await openSearch(user);

    expect(picker().selectedOptions[0]?.textContent).toBe('United Kingdom');
    expect(screen.queryByTestId('search-country-reason')).toBeNull();
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('gb');

    await user.type(screen.getByTestId('search-keywords'), 'credit risk analyst');
    await user.type(screen.getByTestId('search-location'), 'London');
    await user.click(submit());
    await screen.findByTestId('search-results');

    expect(sent.map((call) => call.provider).sort()).toEqual(['adzuna', 'reed']);
    for (const call of sent) {
      // Byte for byte what crossed to Rust before a search could carry a country.
      expect(JSON.stringify(call.params)).toBe(
        '{"keywords":"credit risk analyst","location":"London","limit":20,' +
          '"distanceMiles":null,"salaryMin":null,"employmentType":null}',
      );
    }
  });

  it('boundary: a remembered search alone, with no welcome flag, is also someone who used it', async () => {
    localStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({ draft: {}, recent: [] }));
    const { user } = await startApp();
    await user.click(await screen.findByTestId('welcome-action-search'));
    await screen.findByTestId('search-empty');

    expect(picker().value).toBe('gb');
  });
});

describe('"Delete everything"', () => {
  it('clears the country, and the person is asked again, then and after reopening', async () => {
    markWelcomeSeen();
    const first = await startApp();
    await openSearch(first.user);
    expect(picker().value).toBe('gb');

    await first.user.click(screen.getByTestId('nav-settings'));
    await first.user.click(await screen.findByTestId('settings-erase'));
    await first.user.click(await screen.findByTestId('settings-erase-confirm'));
    // Back to the first run: the introduction, which the person skips.
    await first.user.click(await screen.findByTestId('welcome-skip'));
    await openSearch(first.user);

    expect(picker().value).toBe('');
    expect(submit().disabled).toBe(true);
    cleanup();

    const { user } = await startApp();
    await openSearch(user);
    expect(picker().value).toBe('');
    expect(submit().disabled).toBe(true);
  });
});
