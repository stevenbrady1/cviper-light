// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE: REAL JOBS WITH NO KEY, AND A DEAD FEED THAT SAYS SO OUT LOUD
 * ============================================================================
 * Two things are proved here, and the second is the one that will still matter
 * in a year.
 *
 * 1. A machine with no credential at all presses one button and gets real
 *    adverts on screen, from two feeds that take no key.
 *
 * 2. WHEN A FEED BREAKS, THE SCREEN SAYS SO. Free feeds move, change shape and
 *    get switched off, and every one of those failures reaches this screen as
 *    an empty list unless something stops it — an empty list the user reads as
 *    "there are no jobs like that", and cannot question. So each test in the
 *    second block breaks a feed ON PURPOSE, at the HTTP layer, and asserts a
 *    visible message naming that feed.
 *
 * The third block is the mirror image, and matters just as much: a feed that
 * worked and a filter that matched nothing must NOT produce an error, because
 * that one IS the user's to act on and telling them the app is broken sends
 * them somewhere useless.
 *
 * ============================================================================
 * THE REAL CODE RUNS. ONLY THE BYTES ARE SCRIPTED.
 * ============================================================================
 * The fake port is given a `KeylessFetchTransport`, so `browseKeylessJobs`, the
 * Arbeitnow reader, the RSS reader, the local filter and the decision about
 * whether a feed FAILED are all the shipped ones. A fake that returned a
 * ready-made outcome would let every assertion below pass while the code that
 * decides there is an error went untested.
 *
 * The bodies are the recorded live responses: Guardian's complete feed, and a
 * 19-advert slice of an Arbeitnow page.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type JobApiHttpResponse,
  type KeylessError,
  type KeylessFetchTransport,
  type KeylessSourceId,
} from '@cviper/job-apis';

import ARBEITNOW_PAGE from '../../../../../packages/job-apis/src/fixtures/arbeitnow-page1.json';
import GUARDIAN_FEED from '../../../../../packages/job-apis/src/fixtures/guardian-jobsrss.xml?raw';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-09-13T09:00:00.000Z');

/** Nothing in the credential store. Every user's first launch. */
const NO_KEYS: Record<'adzuna' | 'reed', KeyState> = { adzuna: 'missing', reed: 'missing' };

const ARBEITNOW_BODY = JSON.stringify(ARBEITNOW_PAGE);

type Reply = Result<JobApiHttpResponse, KeylessError>;

/** Both feeds answering with what they really sent on 2026-09-13. */
function working(source: KeylessSourceId): Reply {
  return ok({ status: 200, body: source === 'arbeitnow' ? ARBEITNOW_BODY : GUARDIAN_FEED });
}

function transportOf(reply: (source: KeylessSourceId, page: number) => Reply): {
  transport: KeylessFetchTransport;
  asked: () => string[];
  argumentsSeen: () => unknown[];
} {
  const asked: string[] = [];
  const args: unknown[] = [];
  return {
    transport: {
      fetch: async (source, page) => {
        asked.push(`${source}:${page}`);
        args.push({ source, page });
        return await Promise.resolve(reply(source, page));
      },
    },
    asked: () => asked,
    argumentsSeen: () => args,
  };
}

function renderSearch(reply: (source: KeylessSourceId, page: number) => Reply = working) {
  const user = userEvent.setup();
  const { transport, asked, argumentsSeen } = transportOf(reply);
  const port = createFakeSearchPort([], transport);
  let counter = 0;

  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => NO_KEYS}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
    />,
  );

  return { user, port, asked, argumentsSeen };
}

/** Type something and press the one primary button. */
async function browse(
  user: ReturnType<typeof userEvent.setup>,
  keywords = '',
  location = '',
): Promise<void> {
  if (keywords !== '') await user.type(screen.getByTestId('search-keywords'), keywords);
  if (location !== '') await user.type(screen.getByTestId('search-location'), location);
  await user.click(screen.getByTestId('search-submit'));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('a machine with no keys at all', () => {
  it('can press the button — it is not disabled for want of a key', async () => {
    renderSearch();

    const submit = (await screen.findByTestId('search-submit')) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    // And it says what it will do. It is not a search: the feeds ignore every
    // query, and calling it one would be a claim the user cannot check.
    expect(submit.textContent).toBe('Browse recent jobs');
    expect(screen.queryByTestId('search-reason')).toBeNull();
  });

  it('returns real adverts from both feeds', async () => {
    const { user } = renderSearch();
    await screen.findByTestId('search-empty');

    await browse(user, 'engineer');

    // Arbeitnow's own naming, on a card, from the recorded live page.
    const cards = await screen.findAllByTestId(/^result-/);
    expect(cards.length).toBeGreaterThan(0);
    expect(screen.getByText('Pre-Sales Senior Engineer')).toBeDefined();
  });

  it('names each feed on the card it came from', async () => {
    // The chip used to be `source === 'adzuna' ? 'Adzuna' : 'Reed'`, which
    // would label every advert here "Reed" — a wrong attribution on the one
    // line whose job is to say where the advert came from.
    const { user } = renderSearch();
    await browse(user, 'social worker');

    const chips = await screen.findAllByTestId(/^result-source-/);
    const labels = chips.map((chip) => chip.textContent);
    expect(labels).toContain('Guardian Jobs');
    expect(labels).not.toContain('Reed');
  });

  it('credits Arbeitnow, whose terms ask for a link back', async () => {
    const { user } = renderSearch();
    await browse(user, 'engineer');

    expect((await screen.findByTestId('arbeitnow-attribution')).textContent).toContain('Arbeitnow');
  });

  it('asks for three pages and sends nothing the user typed', async () => {
    // The feeds cannot filter — that is the whole reason the filter is local —
    // so a keyword travelling to them would be both useless and a lie about
    // what this feature does.
    const { user, asked, argumentsSeen } = renderSearch();
    await browse(user, 'credit risk analyst', 'London');

    expect([...asked()].sort()).toEqual(['arbeitnow:1', 'arbeitnow:2', 'guardian:1']);
    expect(JSON.stringify(argumentsSeen())).not.toContain('credit');
    expect(JSON.stringify(argumentsSeen())).not.toContain('London');
  });

  it('spends none of the daily job-board allowance', async () => {
    // These feeds have no account and no allowance. Counting a browse against
    // Reed's hundred would take real searches away from the user for nothing.
    const { user } = renderSearch();
    await browse(user, 'engineer');

    expect(screen.getByTestId('search-quota').textContent ?? '').toContain('0');
  });

  it('filters on this machine — a London browse drops the Berlin adverts', async () => {
    const { user } = renderSearch();
    await browse(user, '', 'London');

    const cards = await screen.findAllByTestId(/^result-/);
    expect(cards.length).toBeGreaterThan(0);
    // Nothing from Munich, Paris or Berlin survived, and the recorded page is
    // mostly those.
    expect(screen.queryByText('Principal Corporate Law & Corporate Financing (m/f/d)')).toBeNull();
  });
});

describe('a feed that has rotted says so, out loud', () => {
  it('a 404 is a visible message naming the feed, not an empty list', async () => {
    const { user } = renderSearch((source) =>
      source === 'arbeitnow' ? ok({ status: 404, body: 'Not Found' }) : working(source),
    );

    await browse(user, '');

    const alert = await screen.findByTestId('keyless-error-arbeitnow');
    expect(alert.textContent).toContain('Arbeitnow');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.getAttribute('data-kind')).toBe('server');

    // The other feed's adverts are still on the page. One dead source must
    // never cost the user the results of the one that worked.
    expect((await screen.findAllByTestId(/^result-/)).length).toBeGreaterThan(0);
    // And the "nothing matched" line is NOT shown for the dead feed: its words
    // were never the problem.
    expect(screen.queryByTestId('keyless-nothing-matched-arbeitnow')).toBeNull();
    expect(screen.queryByTestId('search-no-results')).toBeNull();
  });

  it('a feed that changed shape is a visible message too', async () => {
    // The commonest way a free feed dies: still 200, with something else
    // entirely — a maintenance page, a redirect notice, a new envelope.
    const { user } = renderSearch((source) =>
      source === 'guardian'
        ? ok({ status: 200, body: '<html><body>We have moved</body></html>' })
        : working(source),
    );

    await browse(user, '');

    const alert = await screen.findByTestId('keyless-error-guardian');
    expect(alert.textContent).toContain('Guardian Jobs');
    expect(alert.getAttribute('data-kind')).toBe('bad-response');
  });

  it('a feed that answers with NO jobs is a failure, not a quiet day', async () => {
    // THE SILENT ONE. 200, valid JSON, the right shape, zero adverts. Every
    // layer is happy and the user sees an empty list.
    const { user } = renderSearch((source) =>
      source === 'arbeitnow' ? ok({ status: 200, body: '{"data":[]}' }) : working(source),
    );

    await browse(user, '');

    const alert = await screen.findByTestId('keyless-error-arbeitnow');
    expect(alert.getAttribute('data-kind')).toBe('empty-feed');
    expect(alert.textContent).toContain('Arbeitnow');
  });

  it('BOTH feeds dead is two messages and no empty-looking list', async () => {
    const { user } = renderSearch(() => ok({ status: 503, body: '' }));

    await browse(user, 'engineer');

    expect((await screen.findByTestId('keyless-error-arbeitnow')).textContent).toContain(
      'Arbeitnow',
    );
    expect(screen.getByTestId('keyless-error-guardian').textContent).toContain('Guardian Jobs');
    // The one thing that must never happen: a screen that looks like "we
    // looked, and there is nothing out there".
    expect(screen.queryByTestId('search-no-results')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
  });

  it('a half-read feed keeps what it did read AND reports the rest', async () => {
    const { user } = renderSearch((source, page) =>
      source === 'arbeitnow' && page === 2 ? ok({ status: 500, body: '' }) : working(source),
    );

    await browse(user, '');

    expect((await screen.findAllByTestId(/^result-/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('keyless-error-arbeitnow').textContent).toContain('Arbeitnow');
  });
});

describe('nothing matched is a DIFFERENT sentence from nothing worked', () => {
  it('says how many were read and does not raise an alert', async () => {
    const { user } = renderSearch();

    await browse(user, 'lighthouse keeper');

    const note = await screen.findByTestId('keyless-nothing-matched-arbeitnow');
    expect(note.textContent).toContain('Arbeitnow');
    // The count is in the sentence on purpose: "nothing matched" on its own is
    // indistinguishable from a dead feed.
    expect(note.textContent).toMatch(/\d+/);
    expect(note.getAttribute('role')).not.toBe('alert');

    expect(screen.queryByTestId('keyless-error-arbeitnow')).toBeNull();
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('says it for each feed that answered, by name', async () => {
    const { user } = renderSearch();

    await browse(user, 'lighthouse keeper');

    expect((await screen.findByTestId('keyless-nothing-matched-guardian')).textContent).toContain(
      'Guardian Jobs',
    );
  });

  it('unticking a feed really does skip it', async () => {
    const { user, asked } = renderSearch();

    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    await browse(user, '');

    expect(asked()).toEqual(['guardian:1']);
    expect(screen.queryByTestId('keyless-nothing-matched-arbeitnow')).toBeNull();
  });

  it('boundary: unticking both feeds with no keys disables the button and says why', async () => {
    const { user } = renderSearch();

    await user.click(screen.getByTestId('keyless-source-arbeitnow'));
    await user.click(screen.getByTestId('keyless-source-guardian'));

    const submit = screen.getByTestId('search-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // Disabled, never hidden, and the reason is beside it.
    expect(screen.getByTestId('search-reason').textContent ?? '').toContain('no key');
  });
});

describe('the screen never calls a keyless browse a search', () => {
  it('says nothing of the kind in the feed section', async () => {
    renderSearch();

    const section = await screen.findByTestId('keyless-feeds');
    expect(section.textContent?.toLowerCase()).not.toMatch(/\bsearch\b/);
  });

  it('says plainly what the two feeds are before anything is pressed', async () => {
    // A reader told "browse jobs, no key needed" who then sees four adverts has
    // been misled by the copy, not by the feeds.
    renderSearch();

    const intro = (await screen.findByTestId('keyless-intro')).textContent ?? '';
    expect(intro).toContain('Arbeitnow');
    expect(intro).toContain('Guardian');
    expect(intro.toLowerCase()).toContain('europe');
  });
});
