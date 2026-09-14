// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE: RESULTS ARE RANKED AGAINST THE CV WITH NO KEY, NO MODEL, NO NETWORK
 * ============================================================================
 * The screen reads the CV on file and the profile's deal-breakers ONCE, when it
 * opens, and after a search every advert carries a band from the same keyword
 * scorer the Analysis screen uses, best first. Nothing about that reaches a
 * job board or a model provider — so the two transport factories are mocked to
 * THROW, and every test asserts they were never built. A fake port on its own
 * would make that assertion vacuous; the throwing factories make it real.
 *
 * The other promise is quieter: when there is no CV, the screen says so in one
 * line and shows no pill, no toggle and no "unranked" — because a search
 * screen that looks broken until a CV is uploaded is a search screen people
 * conclude is broken.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  emptyQuota,
  type JobApiHttpResponse,
  type JobProviderId,
  type KeylessError,
  type KeylessFetchTransport,
} from '@cviper/job-apis';

import ARBEITNOW_PAGE from '../../../../../packages/job-apis/src/fixtures/arbeitnow-page1.json';
import GUARDIAN_FEED from '../../../../../packages/job-apis/src/fixtures/guardian-jobsrss.xml?raw';

const factories = vi.hoisted(() => ({
  job: vi.fn(() => {
    throw new Error('a job-board transport was built on the ranking path');
  }),
  keyless: vi.fn(() => {
    throw new Error('a keyless transport was built on the ranking path');
  }),
}));

vi.mock('../../jobs/transport', () => ({ createTauriJobTransport: factories.job }));
vi.mock('../../jobs/keylessTransport', () => ({
  createTauriKeylessTransport: factories.keyless,
}));

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { Search } from './Search';
import { createFakeSearchPort, outcomeOf, type FakeSearchPort } from './test/fakeSearchPort';
import { entry } from './test/fixtures';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';

const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };
const NO_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'missing', reed: 'missing' };

/** A CV that plainly matches the fixture advert. */
const CV_TEXT =
  'Credit Risk Analyst at a London bank. Built IFRS 9 impairment models in Python and SQL, ' +
  'ran stress tests against regulatory scenarios, delivered Basel III capital reporting and ' +
  'presented results to the chief risk officer each quarter. Strong stakeholder communication.';

/** Three adverts that land in three different bands for `CV_TEXT`. */
const WEAK = entry({
  id: 'job-pastry',
  external_id: 'pastry-1',
  title: 'Pastry Chef',
  company: 'The Ivy',
  location: 'Bath',
  description:
    'Pastry chef wanted for a Michelin-starred kitchen in Bath. Laminated doughs, sugar work, ' +
    'menu development, supplier negotiation and training a brigade of eight. Food hygiene ' +
    'level 3 essential, weekend work required.',
});
const POSSIBLE = entry({
  id: 'job-data',
  external_id: 'data-1',
  title: 'Data Analyst',
  company: 'First Direct',
  location: 'Leeds',
  description:
    'Data analyst for a retail bank in Leeds. SQL and Python daily, some reporting to senior ' +
    'stakeholders, occasional credit risk work with the finance team, dashboards in Power BI ' +
    'and a lot of stakeholder communication.',
});
const STRONG = entry({ id: 'job-credit', external_id: 'credit-1' });

/** An advert a keyless feed handed over with a title and nothing else. */
const TITLE_ONLY = entry({
  id: 'job-bare',
  external_id: 'bare-1',
  title: 'Credit Risk Analyst',
  description: null,
});

function renderSearch(
  port: FakeSearchPort,
  keys: Record<JobProviderId, KeyState> = BOTH_KEYS,
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  let counter = 0;

  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => keys}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
    />,
  );

  return user;
}

async function search(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByTestId('search-keywords'), 'credit risk analyst');
  await user.click(screen.getByTestId('search-submit'));
}

/** The ids of the result cards, top to bottom. */
function cardOrder(): string[] {
  return screen
    .getAllByTestId(/^result-job-/)
    .filter((element) => element.tagName === 'ARTICLE')
    .map((element) => element.getAttribute('data-testid')?.replace(/^result-/, '') ?? '');
}

function portWithCv(dealBreakers: readonly string[] = []): FakeSearchPort {
  const port = createFakeSearchPort();
  port.nextCvText(CV_TEXT);
  port.nextDealBreakers(dealBreakers);
  port.nextOutcome(outcomeOf([WEAK, POSSIBLE, STRONG], emptyQuota(TODAY)));
  return port;
}

beforeEach(() => {
  localStorage.clear();
  factories.job.mockClear();
  factories.keyless.mockClear();
});

afterEach(() => {
  cleanup();
  expect(factories.job).not.toHaveBeenCalled();
  expect(factories.keyless).not.toHaveBeenCalled();
});

describe('with a CV on file', () => {
  it('reads the CV and the deal-breakers once, on mount, and nothing else', async () => {
    const port = portWithCv();
    renderSearch(port);

    await screen.findByTestId('search-sort-best');

    expect(port.calls.latestCvText).toBe(1);
    expect(port.calls.dealBreakers).toBe(1);
    // Reading a CV is not a reason to search. Nothing went out.
    expect(port.calls.search).toBe(0);
  });

  it('puts a band on every advert that can be scored', async () => {
    const user = renderSearch(portWithCv());
    await screen.findByTestId('search-sort-best');

    await search(user);

    const strong = await screen.findByTestId('result-rank-job-credit');
    expect(strong.getAttribute('data-verdict')).toBe('strong');
    expect(strong.textContent).toMatch(/^Strong match · \d+$/);

    expect(screen.getByTestId('result-rank-job-data').getAttribute('data-verdict')).toBe(
      'possible',
    );
    expect(screen.getByTestId('result-rank-job-data').textContent).toMatch(
      /^Possible match · \d+$/,
    );
    expect(screen.getByTestId('result-rank-job-pastry').getAttribute('data-verdict')).toBe('weak');
    expect(screen.getByTestId('result-rank-job-pastry').textContent).toMatch(/^Weak match · \d+$/);
  });

  it('shows the best match first by default, and the toggle is ticked', async () => {
    const user = renderSearch(portWithCv());
    const toggle = (await screen.findByTestId('search-sort-best')) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    await search(user);
    await screen.findByTestId('result-rank-job-credit');

    // The boards answered weak, possible, strong. The screen shows the reverse.
    expect(cardOrder()).toEqual(['job-credit', 'job-data', 'job-pastry']);
  });

  it('unticking the toggle puts the results back in the order the boards gave', async () => {
    const user = renderSearch(portWithCv());
    const toggle = await screen.findByTestId('search-sort-best');

    await search(user);
    await screen.findByTestId('result-rank-job-credit');

    await user.click(toggle);
    expect(cardOrder()).toEqual(['job-pastry', 'job-data', 'job-credit']);

    // And back again. The bands are still on the cards either way.
    await user.click(toggle);
    expect(cardOrder()).toEqual(['job-credit', 'job-data', 'job-pastry']);
    expect(screen.getByTestId('result-rank-job-pastry')).toBeDefined();
  });

  it('boundary: an advert with no description gets no pill and sorts last', async () => {
    // A title is not enough to score against, and a "Weak match" on it would
    // tell the user their CV is wrong for a job the app knows nothing about.
    const port = portWithCv();
    port.nextOutcome(outcomeOf([TITLE_ONLY, STRONG], emptyQuota(TODAY)));
    const user = renderSearch(port);
    await screen.findByTestId('search-sort-best');

    await search(user);
    await screen.findByTestId('result-rank-job-credit');

    expect(screen.queryByTestId('result-rank-job-bare')).toBeNull();
    expect(within(screen.getByTestId('result-job-bare')).queryByText(/unranked/i)).toBeNull();
    expect(cardOrder()).toEqual(['job-credit', 'job-bare']);
  });

  it('does not show the "upload a CV" hint', async () => {
    renderSearch(portWithCv());
    await screen.findByTestId('search-sort-best');

    expect(screen.queryByTestId('search-rank-hint')).toBeNull();
  });
});

describe('with no CV on file', () => {
  it('says so in one quiet line, and shows no toggle', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([STRONG], emptyQuota(TODAY)));
    renderSearch(port);

    const hint = await screen.findByTestId('search-rank-hint');
    expect(hint.textContent).toBe(
      'Upload a CV on the Analysis screen and results will be ranked against it.',
    );
    expect(screen.queryByTestId('search-sort-best')).toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('puts no pill on any advert after a search — not even "unranked"', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([STRONG, WEAK], emptyQuota(TODAY)));
    const user = renderSearch(port);
    await screen.findByTestId('search-rank-hint');

    await search(user);
    await screen.findByTestId('result-job-credit');

    expect(screen.queryAllByTestId(/^result-rank-/)).toEqual([]);
    expect(screen.queryByText(/unranked/i)).toBeNull();
    // Incoming order, untouched.
    expect(cardOrder()).toEqual(['job-credit', 'job-pastry']);
  });

  it('boundary: a CV too short to score counts as no CV', async () => {
    const port = createFakeSearchPort();
    port.nextCvText('Analyst.');
    renderSearch(port);

    await screen.findByTestId('search-rank-hint');
    expect(screen.queryByTestId('search-sort-best')).toBeNull();
  });

  it('negative: a database that cannot be read is silent — the search still works', async () => {
    // Ranking is a convenience. A red banner over a screen that otherwise works
    // perfectly would be the larger error.
    const port = createFakeSearchPort();
    port.failNext('latestCvText');
    port.failNext('dealBreakers');
    port.nextOutcome(outcomeOf([STRONG], emptyQuota(TODAY)));
    const user = renderSearch(port);
    await screen.findByTestId('search-empty');

    await search(user);
    await screen.findByTestId('result-job-credit');

    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryAllByTestId(/^result-rank-/)).toEqual([]);
    expect(screen.queryByTestId('search-sort-best')).toBeNull();
  });
});

describe('deal-breakers from the profile', () => {
  it('flags each one the advert mentions, in profile order', async () => {
    const port = portWithCv(['weekend work', 'Bath', 'on-site']);
    const user = renderSearch(port);
    await screen.findByTestId('search-sort-best');

    await search(user);
    await screen.findByTestId('result-job-pastry');

    expect(screen.getByTestId('result-dealbreaker-job-pastry-0').textContent).toBe(
      'Deal-breaker: weekend work',
    );
    expect(screen.getByTestId('result-dealbreaker-job-pastry-1').textContent).toBe(
      'Deal-breaker: Bath',
    );
    // "on-site" is nowhere in that advert.
    expect(screen.queryByTestId('result-dealbreaker-job-pastry-2')).toBeNull();
  });

  it('negative: an advert that mentions none of them gets no chip', async () => {
    const port = portWithCv(['weekend work']);
    const user = renderSearch(port);
    await screen.findByTestId('search-sort-best');

    await search(user);
    await screen.findByTestId('result-job-credit');

    expect(screen.queryByTestId('result-dealbreaker-job-credit-0')).toBeNull();
  });

  it('boundary: a deal-breaker with regex characters is matched as text', async () => {
    const port = createFakeSearchPort();
    port.nextDealBreakers(['C++']);
    port.nextOutcome(
      outcomeOf(
        [
          entry({
            id: 'job-cpp',
            external_id: 'cpp-1',
            title: 'C++ Developer',
            description: 'Low-latency C++ on a trading desk. Modern C++17, Linux, and some Python.',
          }),
          STRONG,
        ],
        emptyQuota(TODAY),
      ),
    );
    const user = renderSearch(port);
    await screen.findByTestId('search-rank-hint');

    await search(user);
    await screen.findByTestId('result-job-cpp');

    expect(screen.getByTestId('result-dealbreaker-job-cpp-0').textContent).toBe(
      'Deal-breaker: C++',
    );
    // Not read as "C, one or more times": the credit-risk advert has no C++.
    expect(screen.queryByTestId('result-dealbreaker-job-credit-0')).toBeNull();
  });

  it('shows deal-breakers with no CV at all — they come from the profile, not the CV', async () => {
    const port = createFakeSearchPort();
    port.nextDealBreakers(['Bath']);
    port.nextOutcome(outcomeOf([WEAK], emptyQuota(TODAY)));
    const user = renderSearch(port);
    await screen.findByTestId('search-rank-hint');

    await search(user);

    expect((await screen.findByTestId('result-dealbreaker-job-pastry-0')).textContent).toBe(
      'Deal-breaker: Bath',
    );
  });
});

describe('with every credential absent', () => {
  type Reply = Result<JobApiHttpResponse, KeylessError>;

  /** Both free feeds answering with their recorded bodies. */
  const feeds: KeylessFetchTransport = {
    fetch: async (source): Promise<Reply> =>
      ok({
        status: 200,
        body: source === 'arbeitnow' ? JSON.stringify(ARBEITNOW_PAGE) : GUARDIAN_FEED,
      }),
  };

  it('ranks a keyless browse against the CV, having built no transport at all', async () => {
    const port = createFakeSearchPort([], feeds);
    port.nextCvText(CV_TEXT);
    const user = renderSearch(port, NO_KEYS);

    const submit = (await screen.findByTestId('search-submit')) as HTMLButtonElement;
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    await screen.findByTestId('search-sort-best');

    await user.click(submit);

    // Real adverts from the shipped readers, and a band on the ones with a
    // description — with no key, no search request, and no transport built.
    const bands = await screen.findAllByTestId(/^result-rank-/);
    expect(bands.length).toBeGreaterThan(0);
    expect(port.calls.search).toBe(0);
    expect(port.calls.browseKeyless).toBe(1);
  });
});
