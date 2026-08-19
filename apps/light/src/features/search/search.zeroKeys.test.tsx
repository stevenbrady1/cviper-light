// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE: JOB SEARCH WORKS ON A MACHINE WITH NO KEYS AT ALL.
 * ============================================================================
 * No Adzuna credentials, no Reed key, nothing in the credential store. That is
 * not an edge case — it is EVERY user's first launch, and for a good many of
 * them it is every launch after that. "Works with no account and no API key" is
 * the claim on the box, and the search screen is where it is either kept or
 * broken.
 *
 * A claim like that decays quietly. Nobody sets out to make search need a key:
 * somebody adds a "load suggestions when the screen opens" call, or a warm-up
 * request, or a background refresh — and it works perfectly on their machine,
 * because their machine has keys.
 *
 * So this file does two things, and the second is the load-bearing one:
 *
 *   1. Drives the keyless path end to end — open the screen, type a search,
 *      press "Search LinkedIn", get a real URL handed to the browser.
 *   2. Asserts NO PROVIDER TRANSPORT WAS INVOKED. Not `job_search`, not
 *      `job_test_credentials`, not `provider_chat`. If a future change makes
 *      this screen reach for a job board, this fails, and it names the command
 *      it saw.
 *
 * The REAL search port is used on purpose. Injecting a fake one would route
 * around the transport entirely and make assertion 2 vacuously true — which is
 * exactly the shape of guard this repo keeps finding it has.
 *
 * The whole APP is rendered rather than the view alone: the rail is part of
 * what a user sees, and an error banner up there would break the same promise
 * just as thoroughly.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('../../app/App');
const { createFakeTrackerPort } = await import('../tracker/test/fakePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');

/**
 * Commands that mean a job board or a model provider was contacted.
 *
 * `job_test_credentials` is in the list for the same reason `job_search` is: it
 * is a real request to a real board, and nothing on the search screen has any
 * business making one.
 */
const PROVIDER_COMMANDS = [
  'job_search',
  'job_test_credentials',
  'provider_chat',
  'provider_list_models',
];

const NOW = new Date('2026-08-19T09:00:00.000Z');

function invokedProviderCommands(): string[] {
  return tauri.invoke.mock.calls
    .map(([command]) => command)
    .filter((command) => PROVIDER_COMMANDS.includes(command));
}

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // A machine with nothing set up: no daemon, and not one saved credential.
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;

    // An empty but working local database, so the screen's "which of these are
    // already in my tracker" read succeeds and this test stays about keys.
    if (command === 'plugin:sql|load') return 'sqlite:cviper.db';
    if (command === 'plugin:sql|execute') return [0, 0];
    if (command === 'plugin:sql|select') return [];

    // Anything else reaching Rust is a failure of the promise, and it fails
    // loudly rather than resolving to something the UI can paper over.
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('the search view on a machine with no keys', () => {
  it('hands a real LinkedIn search to the browser, having contacted nobody', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();

    render(<App trackerPort={createFakeTrackerPort()} browser={browser} now={NOW} />);

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');

    // The bar is here BEFORE anything is typed, and it is not an error state.
    expect(screen.getByTestId('keyless-bar')).toBeDefined();

    await user.type(screen.getByTestId('search-keywords'), 'credit risk analyst');
    await user.type(screen.getByTestId('search-location'), 'London');
    await user.click(screen.getByTestId('keyless-linkedin'));

    expect(browser.opened()).toEqual([
      'https://www.linkedin.com/jobs/search/?keywords=credit+risk+analyst&location=London',
    ]);

    // The two things this file exists to prove.
    expect(invokedProviderCommands()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('hands a real Indeed search to the browser too', async () => {
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();

    render(<App trackerPort={createFakeTrackerPort()} browser={browser} now={NOW} />);

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');

    await user.type(screen.getByTestId('search-keywords'), 'quant developer');
    await user.click(screen.getByTestId('keyless-indeed'));

    expect(browser.opened()).toEqual(['https://uk.indeed.com/jobs?q=quant+developer&l=']);
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('boundary: the browser buttons work before a single character is typed', async () => {
    // The very first second of the app's life. An empty search is a valid
    // search on both sites, and a disabled button here would be the app
    // refusing to do the one thing it can definitely do.
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();

    render(<App trackerPort={createFakeTrackerPort()} browser={browser} now={NOW} />);

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');

    await user.click(screen.getByTestId('keyless-linkedin'));

    expect(browser.opened()).toHaveLength(1);
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('disables Search, says why, and points at the buttons that do work', async () => {
    const user = userEvent.setup();

    render(
      <App trackerPort={createFakeTrackerPort()} browser={createFakeBrowserPort()} now={NOW} />,
    );

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));

    const submit = (await screen.findByTestId('search-submit')) as HTMLButtonElement;
    await vi.waitFor(() => expect(submit.disabled).toBe(true));

    // Disabled, never hidden, and the reason is beside it — pointing at the
    // browser buttons before it points at Settings.
    const reason = screen.getByTestId('search-reason').textContent ?? '';
    expect(reason).toContain('below');
    expect(reason).toContain('no key');

    // Pressing it anyway changes nothing and contacts nobody.
    await user.click(submit);
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('leaves the request counter at zero, because nothing was requested', async () => {
    const user = userEvent.setup();

    render(
      <App trackerPort={createFakeTrackerPort()} browser={createFakeBrowserPort()} now={NOW} />,
    );

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('keyless-linkedin'));

    expect(screen.getByTestId('search-quota').textContent ?? '').toContain('0');
    expect(localStorage.getItem('cviper.light.requests')).toBeNull();
    expect(localStorage.getItem('cviper.light.jobQuota')).toBeNull();
    expect(invokedProviderCommands()).toEqual([]);
  });

  it('never adds tracking to a link it opens', async () => {
    // The product promise: nothing about the user reaches a third party. The
    // web application tags every outbound link with `utm_source`.
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();

    render(<App trackerPort={createFakeTrackerPort()} browser={browser} now={NOW} />);

    await screen.findByTestId('status-strip');
    await user.click(screen.getByTestId('nav-search'));
    await screen.findByTestId('view-search');
    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.click(screen.getByTestId('keyless-indeed'));

    expect(browser.opened()[0]).not.toMatch(/utm_|cviper|affiliate/i);
  });
});

describe('the guard itself', () => {
  it('would notice a job-board call — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. This calls the real
    // transport directly, exactly as a future "refresh results on open" would,
    // and shows that `invokedProviderCommands` sees it.
    const { createTauriJobTransport } = await import('../../jobs/transport');
    tauri.invoke.mockResolvedValue(JSON.stringify({ status: 200, body: '{"results":[]}' }));

    await createTauriJobTransport().search('reed', {
      keywords: 'analyst',
      location: 'London',
      limit: 1,
      distanceMiles: null,
      salaryMin: null,
      employmentType: null,
    });

    expect(invokedProviderCommands()).toEqual(['job_search']);
  });

  it('would notice a key test too', async () => {
    const { createTauriKeyPort } = await import('../settings/keys/port');
    tauri.invoke.mockResolvedValue(JSON.stringify({ status: 200, body: '{"results":[]}' }));

    await createTauriKeyPort(NOW).test('reed', { reed_api_key: 'k' });

    expect(invokedProviderCommands()).toEqual(['job_test_credentials']);
  });
});
