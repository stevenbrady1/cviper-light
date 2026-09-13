// @vitest-environment jsdom
/**
 * A tracked application gets the user back to the advert (L-109).
 *
 * ============================================================================
 * THE DEAD END THIS CLOSES
 * ============================================================================
 * `NewApplicationForm` has captured a "Link" since the board shipped, and
 * `createEntry` stores it on `jobs.url`. Nothing ever rendered it. Grepping
 * `job.url` under `features/tracker/` returned the form field that writes it
 * and the paste guard that inspects it, and no reader at all — so the moment an
 * advert went on the board, the way back to it was gone. The user had to find
 * the posting again by hand, which is the one thing a tracker is supposed to
 * save them.
 *
 * The product decision this implements is the narrow one: CViper Light does not
 * apply for jobs. It tracks them and hands the advert back to the browser the
 * user already has, where they are already signed in. So the control opens the
 * advert; it does not claim to do anything else, and `no promise to apply for
 * anybody` below holds it to that.
 *
 * ============================================================================
 * THE PANE, NOT THE CARD
 * ============================================================================
 * The detail pane is where every per-record action in this app already lives —
 * status, next action, notes, delete. A link on the card would put a second
 * click target inside a control that is itself a click target (select the card)
 * and a drag handle.
 *
 * ============================================================================
 * NOTHING IS APPENDED TO THE LINK, AND THAT IS ASSERTED, NOT ASSUMED
 * ============================================================================
 * `platform/browser.ts` exists partly to keep one promise: the CViper web
 * application tags every outbound advert URL with `utm_source` and friends, and
 * this app does not. A new caller is exactly how that promise gets broken —
 * "just add a source parameter so we can see which links get used" is one line
 * — so the interaction test below compares the opened URL to the STORED one
 * byte for byte, on a URL that already carries a query string of its own.
 *
 * ============================================================================
 * NO CONTROL AT ALL WHEN THERE IS NOWHERE TO GO
 * ============================================================================
 * Not a disabled one. A disabled "Open the advert" on a hand-typed application
 * is a permanent reminder of a field the user chose not to fill in, on a
 * screen they will open every time they update the record. That is different
 * from the search results card, where the button is disabled rather than hidden
 * because every OTHER card in the same list has one and a control that comes
 * and goes down a list is a control you cannot learn. One record on its own has
 * no such row to keep faith with.
 *
 * "Nowhere to go" is `isOpenableUrl` — the app's own predicate, the same one
 * `platform/browser.ts` refuses on and the same one the fake port applies. So
 * `null`, `''`, whitespace and a link with no scheme are one rule rather than
 * four, and every control that renders is a control that works. A button that
 * renders and then silently does nothing is the dead end again, wearing a
 * different coat.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeBrowserPort, type FakeBrowserPort } from '../../platform/test/fakeBrowserPort';

import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

/** A fixed clock, so nothing on the board depends on the day it is run. */
const NOW = new Date(2026, 7, 19, 9, 0, 0);

/**
 * A real advert address, with a query string already on it.
 *
 * The query string is the point: a URL with no `?` cannot tell the difference
 * between "handed over untouched" and "handed over with a parameter appended
 * that happened to be empty".
 */
const ADVERT_URL = 'https://www.reed.co.uk/jobs/senior-engineer/12345678?source=searchresults';

function entry(id: string, job: Partial<Job> = {}): TrackerEntry {
  return {
    job: {
      id: `job-${id}`,
      source: 'manual',
      external_id: null,
      title: `Role ${id}`,
      company: 'Acme',
      location: 'London',
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: null,
      url: null,
      posted_date: null,
      created_at: NOW.toISOString(),
      ...job,
    },
    application: {
      id,
      job_id: `job-${id}`,
      status: 'saved',
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW.toISOString(),
    } satisfies Application,
  };
}

/** Open the board, select the one card on it, and wait for the pane. */
async function openDetail(url: string | null): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly browser: FakeBrowserPort;
}> {
  const user = userEvent.setup();
  const browser = createFakeBrowserPort();
  const port = createFakeTrackerPort([entry('a', { url })]);

  render(<Tracker port={port} now={NOW} browser={browser} />);

  await screen.findByTestId('tracker-card-a');
  await user.click(screen.getByTestId('tracker-card-a'));
  await screen.findByTestId('detail-notes');

  return { user, browser };
}

afterEach(cleanup);

describe('the way back to the advert', () => {
  it('opens the stored address in the user’s own browser', async () => {
    const { user, browser } = await openDetail(ADVERT_URL);

    await user.click(screen.getByTestId('detail-open-advert'));

    // Byte for byte, and nothing else opened. `toEqual` on the whole list
    // rather than `toContain`, so a second, tagged request would fail too.
    expect(browser.opened()).toEqual([ADVERT_URL]);
  });

  it('hands the address over rather than navigating the app to it', async () => {
    // A bare `<a href>` inside a Tauri window navigates the APP: the user would
    // watch their tracker turn into reed.co.uk and lose the pane they were
    // editing. Same reason the welcome screen's key link is a button.
    await openDetail(ADVERT_URL);

    expect(screen.getByTestId('detail-open-advert').tagName).toBe('BUTTON');
    expect(document.querySelector(`a[href="${ADVERT_URL}"]`)).toBeNull();
  });

  it('does not take the view’s one blue button', async () => {
    // `app/buttons.ts`: blue means "the thing this screen is for", once per
    // view. Getting back to the advert is not what the board is for.
    await openDetail(ADVERT_URL);

    expect(screen.getByTestId('detail-open-advert').dataset['primary']).toBeUndefined();
  });

  it('no promise to apply for anybody', async () => {
    // The product decision, in the copy. This app tracks applications; it does
    // not submit them, and a control saying "Apply" would be the first place it
    // claimed otherwise.
    await openDetail(ADVERT_URL);

    const label = screen.getByTestId('detail-open-advert').textContent ?? '';
    expect(label).toMatch(/advert/i);
    expect(label).not.toMatch(/\bapply\b|\bapplication\b|\bsubmit\b/i);
  });
});

describe('an application with nowhere to go', () => {
  it('negative: no URL renders no control at all — not a disabled one', async () => {
    await openDetail(null);

    // `queryByTestId`, then the whole pane, because "disabled" is the failure
    // mode this is really about: a control that is there and does nothing.
    expect(screen.queryByTestId('detail-open-advert')).toBeNull();
    expect(screen.getByTestId('detail-notes')).toBeTruthy();
  });

  it('boundary: an empty string is no URL, not an address of length nought', async () => {
    // `createEntry` folds `''` to `null`, but an imported backup is only held
    // to `z.string().nullable()` — so a stored empty string is reachable and
    // must not produce a button that opens nothing.
    await openDetail('');

    expect(screen.queryByTestId('detail-open-advert')).toBeNull();
  });

  it('boundary: whitespace is no URL either', async () => {
    await openDetail('   ');

    expect(screen.queryByTestId('detail-open-advert')).toBeNull();
  });

  it('boundary: a link with no scheme renders nothing, because it could not be opened', async () => {
    // The form accepts any text under 2000 characters in the Link box, so
    // "www.reed.co.uk/jobs/1" is a real thing to have stored. `browser.ts`
    // would refuse it, so a control here would be dead on arrival.
    await openDetail('www.reed.co.uk/jobs/1');

    expect(screen.queryByTestId('detail-open-advert')).toBeNull();
  });

  it('negative: a javascript: URL is never offered', async () => {
    // Not a realistic paste, and exactly the reason the check is the app's own
    // predicate rather than "is this string non-empty".
    await openDetail('javascript:alert(1)');

    expect(screen.queryByTestId('detail-open-advert')).toBeNull();
  });
});
