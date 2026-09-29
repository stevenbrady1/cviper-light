// @vitest-environment jsdom
/**
 * "Analyse this job" on a search result (L-190).
 *
 * One press does three things, and every test here asserts the side effect of
 * one of them rather than the button's existence:
 *
 *   1. the advert is SAVED to the tracker — once, however many times it is
 *      pressed — so the analysis, the tailored CV and the letter attach to one
 *      record;
 *   2. a PREVIEW (Adzuna, Reed, the Guardian, or anything short) has its full
 *      advert read from its own page, and the better text is written onto the
 *      stored job;
 *   3. the stored job, its application and any note are handed to the shell,
 *      which moves the user to Analysis.
 *
 * The page transport is injected into the fake port, and the fake runs the
 * SHIPPED `fetchFullAdvert` over it — so the decision about when to read a
 * page, and what to say when it cannot, is the real one.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';
import { ANALYSE_DISCLOSURE, PREVIEW_SITE_BLOCKS_NOTE } from '../flow/advert';
import { type AnalyseHandoff } from '../flow/handoff';
import type { FetchedPage, PageFetchError, PageFetchTransport } from '../tracker/pageFetch';

import { ResultCard } from './ResultCard';
import { Search } from './Search';
import { createFakeSearchPort, outcomeOf, type FakeSearchPort } from './test/fakeSearchPort';
import { REED_DAY_RATE, SHARED_DESCRIPTION, entry } from './test/fixtures';

const NOW = new Date('2026-09-29T09:00:00.000Z');
const TODAY = '2026-09-29';
const BOTH_KEYS: Record<JobProviderId, KeyState> = { adzuna: 'configured', reed: 'configured' };

const FULL_TEXT =
  'You will sit in second-line credit risk for the wholesale book, reviewing limit ' +
  'applications from the corporate and institutional coverage teams and challenging the ' +
  'assumptions behind them. Experience of corporate credit analysis in a bank or a rating ' +
  'agency is essential, along with the confidence to say no to a relationship manager. ' +
  'Study support for ACCA or CFA is available, and the team sits three days a week in the ' +
  'City office with the rest of the week worked from home. '.repeat(2);
const FULL_PAGE = `<html><body><main><h1>Credit Risk Contractor</h1><p>${FULL_TEXT}</p></main></body></html>`;

function serving(reply: Result<FetchedPage, PageFetchError>) {
  const asked: string[] = [];
  const factory = (): PageFetchTransport => ({
    fetchPage(url) {
      asked.push(url);
      return Promise.resolve(reply);
    },
  });
  return Object.assign(factory, { asked });
}

function forbidden(): PageFetchTransport {
  throw new Error('the network was reached on a path that must never reach it');
}

/** A page transport that answers only when the test says so. */
function heldPage() {
  let release: (reply: Result<FetchedPage, PageFetchError>) => void = () => undefined;
  const pending = new Promise<Result<FetchedPage, PageFetchError>>((resolve) => {
    release = resolve;
  });
  const factory = (): PageFetchTransport => ({ fetchPage: () => pending });
  return { factory, release: (reply = ok({ status: 200, body: FULL_PAGE })) => release(reply) };
}

function renderSearch(port: FakeSearchPort, onAnalyse?: (handoff: AnalyseHandoff) => void) {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <Search
      port={port}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      now={NOW}
      newId={() => `generated-${(counter += 1)}`}
      {...(onAnalyse === undefined ? {} : { onAnalyse })}
    />,
  );
  return { user };
}

async function searchFor(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByTestId('search-empty');
  await user.type(screen.getByTestId('search-keywords'), 'credit risk');
  await user.click(screen.getByTestId('search-submit'));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('analysing a preview from a search', () => {
  it('saves it, reads the full advert, stores it, and hands the stored job on', async () => {
    const page = serving(ok({ status: 200, body: FULL_PAGE }));
    const port = createFakeSearchPort([], undefined, page);
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const onAnalyse = vi.fn<(handoff: AnalyseHandoff) => void>();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    await user.click(await screen.findByTestId('result-analyse-job-day-rate'));

    await vi.waitFor(() => expect(onAnalyse).toHaveBeenCalledTimes(1));
    const handoff = onAnalyse.mock.calls[0]?.[0];
    expect(handoff?.job.id).toBe('job-day-rate');
    expect(handoff?.job.description).toContain('second-line credit risk');
    expect(handoff?.applicationId).toBe('generated-1');
    expect(handoff?.note).toBeNull();
    // One page, the advert's own.
    expect(page.asked).toEqual(['https://www.reed.co.uk/jobs/99900001']);
    // On the board, once, with the whole advert.
    expect(port.savedJobs()).toHaveLength(1);
    expect(port.savedJobs()[0]?.description).toContain('second-line credit risk');
    // And the card now says so.
    const save = screen.getByTestId<HTMLButtonElement>('result-save-job-day-rate');
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain('In your tracker');
  });

  it('says what it is doing while the page is read, and holds the card still', async () => {
    const page = heldPage();
    const port = createFakeSearchPort([], undefined, page.factory);
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const onAnalyse = vi.fn();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    await user.click(await screen.findByTestId('result-analyse-job-day-rate'));

    expect((await screen.findByTestId('result-note-job-day-rate')).textContent).toContain(
      'Reading the full advert',
    );
    expect(screen.getByTestId<HTMLButtonElement>('result-analyse-job-day-rate').disabled).toBe(
      true,
    );
    expect(screen.getByTestId<HTMLButtonElement>('result-save-job-day-rate').disabled).toBe(true);
    expect(onAnalyse).not.toHaveBeenCalled();

    page.release();
    await vi.waitFor(() => expect(onAnalyse).toHaveBeenCalledTimes(1));
  });

  it('a site that blocks apps hands on the preview with the note that says so', async () => {
    const port = createFakeSearchPort([], undefined, serving(ok({ status: 403, body: '' })));
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const onAnalyse = vi.fn<(handoff: AnalyseHandoff) => void>();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    await user.click(await screen.findByTestId('result-analyse-job-day-rate'));

    await vi.waitFor(() => expect(onAnalyse).toHaveBeenCalledTimes(1));
    expect(onAnalyse.mock.calls[0]?.[0].note).toBe(PREVIEW_SITE_BLOCKS_NOTE);
    expect(onAnalyse.mock.calls[0]?.[0].job.description).toBe(SHARED_DESCRIPTION);
    // Still saved: the user can paste the advert in and the record is there.
    expect(port.savedJobs()).toHaveLength(1);
  });

  it('an advert already on the board is reused — its stored id, its application, no second row', async () => {
    const stored = { ...REED_DAY_RATE.job, id: 'stored-on-monday' };
    const port = createFakeSearchPort([stored], undefined, serving(ok({ status: 404, body: '' })));
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const onAnalyse = vi.fn<(handoff: AnalyseHandoff) => void>();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    // Already tracked: Save is disabled, and Analyse is still offered.
    const analyse = await screen.findByTestId<HTMLButtonElement>('result-analyse-job-day-rate');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLButtonElement>('result-save-job-day-rate').disabled).toBe(true),
    );
    expect(analyse.disabled).toBe(false);
    await user.click(analyse);

    await vi.waitFor(() => expect(onAnalyse).toHaveBeenCalledTimes(1));
    expect(onAnalyse.mock.calls[0]?.[0].job.id).toBe('stored-on-monday');
    expect(port.savedJobs()).toHaveLength(1);
  });

  it('a full advert from a board that sends one is handed on without reading any page', async () => {
    const full = entry({
      id: 'job-arbeitnow',
      source: 'arbeitnow',
      external_id: 'arb-1',
      description: FULL_TEXT.repeat(3),
      url: 'https://www.arbeitnow.com/jobs/arb-1',
    });
    const port = createFakeSearchPort([], undefined, forbidden);
    port.nextOutcome(outcomeOf([full], emptyQuota(TODAY)));
    const onAnalyse = vi.fn<(handoff: AnalyseHandoff) => void>();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    await user.click(await screen.findByTestId('result-analyse-job-arbeitnow'));

    await vi.waitFor(() => expect(onAnalyse).toHaveBeenCalledTimes(1));
    expect(onAnalyse.mock.calls[0]?.[0].note).toBeNull();
    expect(screen.queryByText(/Reading the full advert/)).toBeNull();
  });

  it('negative: a save that fails hands nothing on, and says why on the card', async () => {
    const port = createFakeSearchPort([], undefined, forbidden);
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const onAnalyse = vi.fn();
    const { user } = renderSearch(port, onAnalyse);
    await searchFor(user);

    port.failNext('saveToTracker');
    await user.click(await screen.findByTestId('result-analyse-job-day-rate'));

    expect((await screen.findByTestId('result-problem-job-day-rate')).textContent).toContain(
      'could not be saved',
    );
    expect(onAnalyse).not.toHaveBeenCalled();
    expect(port.calls.readFullAdvert).toBe(0);
    expect(screen.getByTestId<HTMLButtonElement>('result-analyse-job-day-rate').disabled).toBe(
      false,
    );
  });

  it('negative: with nowhere to hand a job, no Analyse button is drawn', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch(port);
    await searchFor(user);

    await screen.findByTestId('result-save-job-day-rate');
    expect(screen.queryByTestId('result-analyse-job-day-rate')).toBeNull();
  });

  it('says, beside the results, that analysing a preview opens its page', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch(port, vi.fn());
    await searchFor(user);

    const disclosure = await screen.findByTestId('search-analyse-disclosure');
    expect(disclosure.textContent).toBe(ANALYSE_DISCLOSURE);
    expect(ANALYSE_DISCLOSURE).toMatch(/IP address/);
    expect(ANALYSE_DISCLOSURE).toMatch(/one page/);
  });

  it('adds no second primary button to the screen', async () => {
    const port = createFakeSearchPort();
    port.nextOutcome(outcomeOf([REED_DAY_RATE], emptyQuota(TODAY)));
    const { user } = renderSearch(port, vi.fn());
    await searchFor(user);
    await screen.findByTestId('result-analyse-job-day-rate');

    expect(document.querySelectorAll('[data-primary="true"]').length).toBeLessThanOrEqual(1);
  });
});

describe('the card on its own', () => {
  function card(overrides: { busy?: boolean; onAnalyse?: () => void } = {}) {
    render(
      <ResultCard
        entry={REED_DAY_RATE}
        today={TODAY}
        clusterSize={null}
        tracked={false}
        busy={overrides.busy ?? false}
        note={null}
        problem={null}
        rank={null}
        dealBreakers={[]}
        onSave={vi.fn()}
        onOpen={vi.fn()}
        {...(overrides.onAnalyse === undefined ? {} : { onAnalyse: overrides.onAnalyse })}
      />,
    );
    return screen.getByTestId<HTMLButtonElement>('result-analyse-job-day-rate');
  }

  it('calls through when pressed', () => {
    const onAnalyse = vi.fn();
    fireEvent.click(card({ onAnalyse }));

    expect(onAnalyse).toHaveBeenCalledTimes(1);
  });

  it('negative: is disabled, never hidden, while the card is busy', () => {
    const onAnalyse = vi.fn();
    const button = card({ busy: true, onAnalyse });

    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(onAnalyse).not.toHaveBeenCalled();
  });
});
