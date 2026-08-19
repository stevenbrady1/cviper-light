// @vitest-environment jsdom
/**
 * The search screen, driven the way a user drives it.
 *
 * Every test here presses something and then asserts a SIDE EFFECT — a request
 * that went out, a row in the fake tracker, a URL handed to the browser port.
 * A render-only test on this screen would pass with every button unwired.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  QUOTA_BLOCK_AT,
  QUOTA_WARN_AT,
  emptyQuota,
  jobApiError,
  type JobProviderId,
  type QuotaState,
} from '@cviper/job-apis';

import { createFakeBrowserPort, type FakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { QUOTA_STORAGE_KEY } from '../../jobs/quotaStore';

import { Search } from './Search';
import { SEARCH_STORAGE_KEY } from './memory';
import { createFakeSearchPort, outcomeOf, type FakeSearchPort } from './test/fakeSearchPort';
import { ADZUNA_PERMANENT, REED_DAY_RATE, entry } from './test/fixtures';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';

const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly port: FakeSearchPort;
  readonly browser: FakeBrowserPort;
  readonly openSettings: ReturnType<typeof vi.fn>;
}

function renderSearch(
  options: {
    port?: FakeSearchPort;
    keys?: Record<JobProviderId, KeyState>;
  } = {},
): Harness {
  const user = userEvent.setup();
  const port = options.port ?? createFakeSearchPort();
  const browser = createFakeBrowserPort();
  const openSettings = vi.fn();

  let counter = 0;

  render(
    <Search
      port={port}
      browser={browser}
      readKeyStates={async () => options.keys ?? BOTH_KEYS}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
      onOpenSettings={openSettings}
    />,
  );

  return { user, port, browser, openSettings };
}

/** Fill in the search box and press the button. */
async function search(user: Harness['user'], keywords = 'credit risk analyst'): Promise<void> {
  await user.type(screen.getByTestId('search-keywords'), keywords);
  await user.click(screen.getByTestId('search-submit'));
}

function quotaWith(counts: Partial<QuotaState['counts']>): QuotaState {
  return { date: TODAY, counts: { reed: 0, adzuna: 0, ...counts } };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('nothing happens until the button is pressed', () => {
  it('sends no request on mount, and none while typing', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(screen.getByTestId('search-keywords'), 'credit risk analyst');
    await user.type(screen.getByTestId('search-location'), 'London');

    // Reed's free tier is 100 a day. A search-as-you-type box would spend a
    // third of it typing this sentence.
    expect(port.calls.search).toBe(0);
  });

  it('sends exactly one request when the button is pressed', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await search(user);

    expect(port.calls.search).toBe(1);
    expect(port.requests()[0]?.input).toMatchObject({
      keywords: 'credit risk analyst',
      employmentType: null,
    });
  });

  it('carries every filter the user set into the request', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(screen.getByTestId('search-keywords'), 'quant developer');
    await user.type(screen.getByTestId('search-location'), 'London');
    await user.type(screen.getByTestId('search-distance'), '15');
    await user.type(screen.getByTestId('search-salary'), '90000');
    await user.selectOptions(screen.getByTestId('search-contract'), 'Contract');
    await user.click(screen.getByTestId('search-submit'));

    expect(port.requests()[0]?.input).toEqual({
      keywords: 'quant developer',
      location: 'London',
      distanceMiles: 15,
      salaryMin: 90000,
      employmentType: 'Contract',
    });
  });

  it('negative: an empty search is refused here, without spending a request', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.click(screen.getByTestId('search-submit'));

    expect((await screen.findByTestId('search-keywords-error')).textContent ?? '').toContain(
      'job title',
    );
    expect(port.calls.search).toBe(0);
  });

  it('negative: a distance that will not read is refused rather than silently dropped', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.type(screen.getByTestId('search-distance'), 'near-ish');
    await user.click(screen.getByTestId('search-submit'));

    // The "valid but inert" failure: results from three hundred miles away and
    // no way to tell that the box was ignored.
    expect(screen.getByTestId('search-distance-error')).toBeDefined();
    expect(port.calls.search).toBe(0);
  });

  it('boundary: a salary floor of zero is refused and one pound is accepted', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(screen.getByTestId('search-keywords'), 'analyst');
    await user.type(screen.getByTestId('search-salary'), '0');
    await user.click(screen.getByTestId('search-submit'));
    expect(port.calls.search).toBe(0);

    await user.clear(screen.getByTestId('search-salary'));
    await user.type(screen.getByTestId('search-salary'), '1');
    await user.click(screen.getByTestId('search-submit'));
    expect(port.calls.search).toBe(1);
  });
});

describe('which boards get contacted', () => {
  it('unticking a board really skips its call', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');
    await vi.waitFor(() =>
      expect((screen.getByTestId('provider-adzuna') as HTMLInputElement).disabled).toBe(false),
    );

    await user.click(screen.getByTestId('provider-adzuna'));
    await search(user);

    // Not filtered out of the results afterwards — never contacted. A checkbox
    // that filtered would still spend one of Reed's hundred.
    expect(port.requests()[0]?.providers).toEqual(['reed']);
  });

  it('negative: a board with no key is disabled and says why, with somewhere to go', async () => {
    const { user, openSettings } = renderSearch({
      keys: { adzuna: 'missing', reed: 'configured' },
    });

    const toggle = (await screen.findByTestId('provider-adzuna')) as HTMLInputElement;
    await vi.waitFor(() => expect(toggle.disabled).toBe(true));

    expect(screen.getByTestId('provider-reason-adzuna').textContent ?? '').toContain('Settings');

    await user.click(screen.getByTestId('provider-settings-adzuna'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('negative: half an Adzuna credential says so, rather than "no key"', async () => {
    renderSearch({ keys: { adzuna: 'incomplete', reed: 'configured' } });

    const reason = await screen.findByTestId('provider-reason-adzuna');
    expect(reason.textContent ?? '').toContain('one of its two');
  });

  it('negative: a board with no key is never contacted even if it was ticked', async () => {
    const { user, port } = renderSearch({ keys: { adzuna: 'missing', reed: 'configured' } });
    await screen.findByTestId('search-empty');
    await vi.waitFor(() =>
      expect((screen.getByTestId('provider-adzuna') as HTMLInputElement).disabled).toBe(true),
    );

    await search(user);

    expect(port.requests()[0]?.providers).toEqual(['reed']);
  });
});

describe('the results', () => {
  it('shows title, company, location, salary, date, contract type and the source', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([ADZUNA_PERMANENT], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    const card = await screen.findByTestId('result-job-adzuna');
    const text = card.textContent ?? '';
    expect(text).toContain('Credit Risk Analyst');
    expect(text).toContain('HSBC');
    expect(text).toContain('London');
    expect(text).toContain('£65,000–£80,000 per year');
    expect(text).toContain('Permanent');
    expect(screen.getByTestId('result-source-job-adzuna').textContent).toBe('Adzuna');
    expect(screen.getByTestId('result-posted-job-adzuna').textContent).toBe('Posted 5 days ago');
  });

  it('shows the Adzuna attribution wherever Adzuna data appears', async () => {
    // A condition of Adzuna's API terms, and it belongs on screen rather than
    // in a licence file nobody opens.
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([ADZUNA_PERMANENT], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    expect((await screen.findByTestId('adzuna-attribution')).textContent).toContain(
      'Jobs from Adzuna',
    );
  });

  it('does not claim Adzuna data when none is on screen', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);
    await screen.findByTestId('result-job-day-rate');

    expect(screen.queryByTestId('adzuna-attribution')).toBeNull();
  });

  it('opens the original advert in the real browser', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user, browser } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);
    await user.click(await screen.findByTestId('result-open-job-day-rate'));

    // Byte for byte. No utm_source, no affiliate tag, nothing added.
    expect(browser.opened()).toEqual(['https://www.reed.co.uk/jobs/99900001']);
  });

  it('boundary: a search that matched nothing says so, and is not an error', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    expect(await screen.findByTestId('search-no-results')).toBeDefined();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });
});

describe('cross-posted adverts are flagged, never merged', () => {
  it('keeps both adverts and both apply links, and says how many there are', async () => {
    // The same role posted to both boards: identical description, so the real
    // fingerprint groups them.
    const reedCopy = entry({ id: 'job-a', source: 'reed', external_id: 'r-1' });
    const adzunaCopy = entry({
      id: 'job-b',
      source: 'adzuna',
      external_id: 'a-1',
      url: 'https://www.adzuna.co.uk/jobs/details/a-1',
    });

    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([reedCopy, adzunaCopy], emptyQuota(TODAY)));
    const { user, browser } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    // BOTH cards are on screen, and both say what they are.
    expect(await screen.findByTestId('result-job-a')).toBeDefined();
    expect(screen.getByTestId('result-job-b')).toBeDefined();
    expect(screen.getByTestId('result-cluster-job-a').textContent ?? '').toContain(
      '2 similar postings',
    );

    // And both apply links still work. A wrong merge would have destroyed one
    // of these with no error, and a local app has no undo.
    await user.click(screen.getByTestId('result-open-job-a'));
    await user.click(screen.getByTestId('result-open-job-b'));

    expect(browser.opened()).toEqual([
      'https://www.reed.co.uk/jobs/55512345',
      'https://www.adzuna.co.uk/jobs/details/a-1',
    ]);
  });

  it('says nothing about an advert that is on its own', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);
    await screen.findByTestId('result-job-day-rate');

    expect(screen.queryByTestId('result-cluster-job-day-rate')).toBeNull();
  });
});

describe('saving to the tracker', () => {
  it('creates the advert and confirms it', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);
    await user.click(await screen.findByTestId('result-save-job-day-rate'));

    expect((await screen.findByTestId('result-note-job-day-rate')).textContent ?? '').toContain(
      'Saved to your tracker',
    );
    expect(port.savedJobs().map((saved) => saved.external_id)).toEqual(['99900001']);
  });

  it('does not create a second row when the same advert is saved twice', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);
    await user.click(await screen.findByTestId('result-save-job-day-rate'));
    await screen.findByTestId('result-note-job-day-rate');

    // The card now says it is already there, and the button is disabled — so
    // the second save is driven straight through the port, exactly as a second
    // window would do it.
    const again = await port.saveToTracker(
      REED_DAY_RATE.job,
      { applicationId: 'second-attempt' },
      NOW.toISOString(),
    );

    expect(again).toEqual({ ok: true, value: 'already-saved' });
    expect(port.savedJobs()).toHaveLength(1);
  });

  it('shows no raw database error when an advert was already saved', async () => {
    // Already on the board before this search ever ran — yesterday's search,
    // or the other window.
    const port = createFakeSearchPort([REED_DAY_RATE.job]);
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    const save = (await screen.findByTestId('result-save-job-day-rate')) as HTMLButtonElement;
    // Disabled, never hidden, and the label says which state it is in.
    await vi.waitFor(() => expect(save.disabled).toBe(true));
    expect(save.textContent).toContain('In your tracker');

    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.getByTestId('view-search').textContent ?? '').not.toContain('UNIQUE constraint');
  });

  it('reports "already in your tracker" as a note, not as a failure', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');
    await search(user);

    // Save it once through the port, so the screen still thinks it is new.
    await port.saveToTracker(REED_DAY_RATE.job, { applicationId: 'x' }, NOW.toISOString());
    await user.click(await screen.findByTestId('result-save-job-day-rate'));

    const note = await screen.findByTestId('result-note-job-day-rate');
    expect(note.textContent ?? '').toContain('already in your tracker');
    expect(note.textContent ?? '').not.toContain('constraint');
    expect(screen.queryByTestId('result-problem-job-day-rate')).toBeNull();
    expect(port.savedJobs()).toHaveLength(1);
  });

  it('negative: a real database failure IS reported', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');
    await search(user);

    port.failNext('saveToTracker');
    await user.click(await screen.findByTestId('result-save-job-day-rate'));

    // The over-correction to avoid: treating every write failure as "already
    // saved" would tell the user their advert is on the board when the database
    // would not open at all.
    expect((await screen.findByTestId('result-problem-job-day-rate')).textContent ?? '').toContain(
      'could not be saved',
    );
  });
});

describe('the daily request budget', () => {
  it('shows the count for both boards', async () => {
    localStorage.setItem(
      QUOTA_STORAGE_KEY,
      JSON.stringify({ date: TODAY, counts: { reed: 12, adzuna: 3 } }),
    );

    renderSearch();

    const quota = await screen.findByTestId('search-quota');
    expect(quota.textContent ?? '').toContain('12');
    expect(quota.textContent ?? '').toContain('3');
    expect(quota.textContent ?? '').toContain('100');
  });

  it('boundary: warns at 75 without blocking', async () => {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quotaWith({ reed: QUOTA_WARN_AT })));

    const { user, port } = renderSearch();
    const notice = await screen.findByTestId('search-quota-notice');
    expect(notice.getAttribute('data-status')).toBe('warn');

    await search(user);
    // A warning is a warning. The search still goes out.
    expect(port.calls.search).toBe(1);
  });

  it('boundary: blocks Reed at 90 and says when it comes back', async () => {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quotaWith({ reed: QUOTA_BLOCK_AT })));

    renderSearch();

    const notice = await screen.findByTestId('search-quota-notice');
    expect(notice.getAttribute('data-status')).toBe('blocked');
    expect(notice.textContent ?? '').toContain('midnight UTC');
  });

  it('does NOT block Adzuna, whatever its count is', async () => {
    // Adzuna's allowance depends on the plan the user bought and cannot be
    // queried, so any threshold would be invented — and invented in the
    // direction that stops a paying user searching.
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quotaWith({ adzuna: 500 })));

    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await search(user);

    expect(port.requests()[0]?.providers).toContain('adzuna');
    expect(screen.queryByTestId('search-quota-notice')).toBeNull();
  });
});

describe('one board failing never costs the other its results', () => {
  it('renders a per-board error beside results that are still there', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(
      outcomeOf([ADZUNA_PERMANENT], emptyQuota(TODAY), [
        {
          provider: 'reed',
          jobs: [],
          error: jobApiError('reed', 'server', 'Reed is having trouble at their end.', 503),
        },
      ]),
    );
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    expect((await screen.findByTestId('search-error-reed')).textContent ?? '').toContain(
      'trouble at their end',
    );
    // And Adzuna's page of adverts is still on screen.
    expect(screen.getByTestId('result-job-adzuna')).toBeDefined();
    expect(screen.queryByTestId('search-error-adzuna')).toBeNull();
  });

  it('names the kind of failure, so a wrong key and a dead network read differently', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(
      outcomeOf([], emptyQuota(TODAY), [
        {
          provider: 'reed',
          jobs: [],
          error: jobApiError('reed', 'auth', 'Reed rejected the saved key.', 401),
        },
      ]),
    );
    const { user } = renderSearch({ port });
    await screen.findByTestId('search-empty');

    await search(user);

    expect((await screen.findByTestId('search-error-reed')).getAttribute('data-kind')).toBe('auth');
  });
});

describe('remembering what was typed', () => {
  it('offers a search that was actually run, and fills the boxes WITHOUT searching', async () => {
    const { user, port } = renderSearch();
    await screen.findByTestId('search-empty');

    await search(user, 'quant developer');
    await user.clear(screen.getByTestId('search-keywords'));

    await user.click(await screen.findByTestId('search-recent-0'));

    expect((screen.getByTestId('search-keywords') as HTMLInputElement).value).toBe(
      'quant developer',
    );
    // One search — the one that was actually submitted. Refilling the boxes
    // must never spend a request.
    expect(port.calls.search).toBe(1);
  });

  it('writes the draft after typing stops, and nothing but the form', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await user.type(screen.getByTestId('search-keywords'), 'analyst');

    // Real timers on purpose. The debounce is 400ms of wall clock and this test
    // waits for it: faking the clock here would prove the effect fires when the
    // clock is pushed, which is not the same claim.
    await vi.waitFor(() => expect(localStorage.getItem(SEARCH_STORAGE_KEY)).not.toBeNull(), {
      timeout: 3000,
    });

    const stored: { draft: { keywords: string } } = JSON.parse(
      localStorage.getItem(SEARCH_STORAGE_KEY) ?? '{}',
    );
    expect(stored.draft.keywords).toBe('analyst');
    // The only thing on disk is a form. No results, no advert text, nothing
    // that identifies anybody.
    expect(Object.keys(stored).sort()).toEqual(['draft', 'recent']);
  });
});

describe('the view has exactly one primary button', () => {
  it('and it is Search', async () => {
    renderSearch();
    await screen.findByTestId('search-empty');

    const primaries = [...document.querySelectorAll('[data-primary="true"]')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.getAttribute('data-testid')).toBe('search-submit');
  });
});
