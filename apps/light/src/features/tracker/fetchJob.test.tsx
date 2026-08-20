// @vitest-environment jsdom
/**
 * Fetch from a link, review every field, then save.
 *
 * ============================================================================
 * THE SAME PROMISE AS THE PASTE PATH, AND IT HAS TO SURVIVE A SECOND DOOR
 * ============================================================================
 * A fetched advert is one the user never read before the model did, which makes
 * the review step MORE important here, not less. So these tests count writes at
 * the port after every step, exactly as `pasteJob.test.tsx` does, and the
 * component still has no port and no write path at all.
 *
 * ============================================================================
 * AND THE PASTE PATH IS UNTOUCHED
 * ============================================================================
 * `pasteJob.test.tsx` is unchanged and still passes — that is the strongest
 * form of "untouched" there is. The block at the bottom of this file drives the
 * plain paste flow again with the new link box on screen and empty, so a
 * regression that only shows up once the box exists cannot hide.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { Tracker } from './Tracker';
import { FETCH_FALLBACK_NOTE } from './runFetch';
import type { FetchedPage, PageFetchError, PageFetchTransport } from './pageFetch';
import { createFakeTrackerPort, type FakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const ADVERT_URL = 'https://jobs.example.com/advert/credit-risk-analyst';

/** A job advert page as a real site serves it. */
const ADVERT_PAGE = `<!DOCTYPE html><html><head>
  <title>Credit Risk Analyst</title>
  <script>window.dataLayer=[{jobId:88213}];</script></head>
<body>
  <nav>Home Jobs Risk</nav>
  <header>Careers at Lloyds</header>
  <main>
    <h1>Credit Risk Analyst</h1>
    <p>Lloyds Banking Group &middot; City of London (hybrid, 3 days on site)</p>
    <p>&pound;45,000 &ndash; &pound;55,000 per annum plus bonus.</p>
    <p>You will sit in second-line credit risk for the wholesale book, reviewing
    limit applications from the corporate and institutional coverage teams and
    challenging the assumptions behind them. Experience of corporate credit
    analysis in a bank or a rating agency is essential, along with the
    confidence to say no to a relationship manager who does not want to hear it.
    Study support for ACCA or CFA is available, and the team sits three days a
    week in the City office with the rest of the week worked from home.</p>
  </main>
  <footer>&copy; 2026 Lloyds. Cookies. Privacy. Modern Slavery Statement.</footer>
</body></html>`;

/** What a good model returns for that page. */
const GOOD_REPLY = {
  title: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  location: 'City of London (hybrid, 3 days on site)',
  url: null,
  description: 'Second-line credit risk for the wholesale book.',
  posted_date: null,
  salary_currency: 'GBP',
  salary_min: 45000,
  salary_max: 55000,
};

const WITH_OLLAMA: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
  anthropicKey: false,
  openaiKey: false,
};

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

function chatTransport(reply: string): ChatTransport {
  return {
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      return Promise.resolve(ok({ status: 200, body: reply }));
    },
    listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      throw new Error('the paste flow must never list models');
    },
  };
}

/** A page transport that answers with one reply and records what it was asked. */
function pageTransport(
  reply: Result<FetchedPage, PageFetchError>,
): PageFetchTransport & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetchPage(url: string): Promise<Result<FetchedPage, PageFetchError>> {
      asked.push(url);
      return Promise.resolve(reply);
    },
  };
}

/**
 * A factory that fails the test if the network is so much as prepared for.
 *
 * Thrown from the FACTORY, not from `fetchPage`: a blocked address must not get
 * as far as having a transport built for it.
 */
function forbiddenPageTransport(): PageFetchTransport {
  throw new Error('the network was reached on a path that must never reach it');
}

/**
 * A factory that counts how many times it was asked for a transport.
 *
 * Used by the non-vacuity test below. Counting rather than throwing, because a
 * throw out of a React click handler becomes an unhandled rejection rather than
 * a failed assertion — which reports as a run-level error and, worse, could
 * report as a PASS.
 */
function countingPageTransport(reply: Result<FetchedPage, PageFetchError>): {
  readonly built: () => number;
  readonly factory: () => PageFetchTransport;
} {
  const state = { built: 0 };
  return {
    built: () => state.built,
    factory: () => {
      state.built += 1;
      return pageTransport(reply);
    },
  };
}

function renderBoard(options: {
  transport?: ChatTransport;
  createPageTransport?: () => PageFetchTransport;
}): FakeTrackerPort {
  const port = createFakeTrackerPort();
  render(
    <Tracker
      port={port}
      now={NOW}
      readAvailability={() => Promise.resolve(WITH_OLLAMA)}
      createTransport={options.transport === undefined ? undefined : () => options.transport!}
      createPageTransport={options.createPageTransport}
    />,
  );
  return port;
}

async function openPaste(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByTestId('tracker-empty');
  await user.click(screen.getByTestId('tracker-empty-paste'));
  await screen.findByTestId('paste-job-form');
}

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the whole link → fetch → review → save loop', () => {
  it('fetches the page, fills the advert box, and the review form follows', async () => {
    const user = userEvent.setup();
    const page = pageTransport(ok({ status: 200, body: ADVERT_PAGE }));
    const port = renderBoard({
      transport: chatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))),
      createPageTransport: () => page,
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));

    // --- The advert text is in the box the user can see and edit -----------
    const box = (await screen.findByTestId('paste-job-text')) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain('Credit Risk Analyst'));
    expect(page.asked).toEqual([ADVERT_URL]);
    expect(box.value).toContain('£45,000 – £55,000');
    // The chrome never reaches it.
    expect(box.value).not.toContain('Modern Slavery Statement');
    expect(box.value).not.toContain('dataLayer');
    expect(box.value).not.toContain('<');

    // --- Nothing has been saved, and nothing has been extracted yet --------
    expect(port.calls.create).toBe(0);
    expect(screen.queryByTestId('new-application-form')).toBeNull();

    // --- Now the existing extraction runs, unchanged -----------------------
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe(
      'Credit Risk Analyst',
    );
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe(
      'Lloyds Banking Group',
    );
    expect((screen.getByLabelText(/^Salary from/) as HTMLInputElement).value).toBe('45000');
    // The address is a fact the user supplied, so it is carried through.
    expect((screen.getByLabelText(/^Link/) as HTMLInputElement).value).toBe(ADVERT_URL);

    // --- STILL nothing saved until the user says so ------------------------
    expect(port.calls.create).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job).toMatchObject({
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      url: ADVERT_URL,
    });
  });

  it('a fetch on its own saves nothing and opens no form', async () => {
    const user = userEvent.setup();
    const port = renderBoard({
      createPageTransport: () => pageTransport(ok({ status: 200, body: ADVERT_PAGE })),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));

    await waitFor(() =>
      expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).value).not.toBe(''),
    );

    expect(port.calls.create).toBe(0);
    expect(port.calls.saveApplication).toBe(0);
    expect(port.entries()).toEqual([]);
    expect(screen.queryByTestId('new-application-form')).toBeNull();
  });

  it('says what it fetched, so the user knows to check the box before extracting', async () => {
    const user = userEvent.setup();
    renderBoard({
      createPageTransport: () => pageTransport(ok({ status: 200, body: ADVERT_PAGE })),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));

    const note = await screen.findByTestId('paste-job-fetch-note');
    expect(note.textContent).toMatch(/below/i);
    // A status, not an alert. Nothing is broken.
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('a domain on the blocklist', () => {
  it('makes NO request — the transport is never even built', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('https://uk.indeed.com/viewjob?jk=abc123');
    await user.click(screen.getByTestId('paste-job-fetch'));

    const note = await screen.findByTestId('paste-job-fetch-note');
    expect(note.textContent).toBe(FETCH_FALLBACK_NOTE);
  });

  it('leaves the address exactly where the user typed it', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('https://www.linkedin.com/jobs/view/4012345678/');
    await user.click(screen.getByTestId('paste-job-fetch'));

    await screen.findByTestId('paste-job-fetch-note');
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).value).toBe(
      'https://www.linkedin.com/jobs/view/4012345678/',
    );
  });

  it('the paste box is still there and still works', async () => {
    const user = userEvent.setup();
    const port = renderBoard({
      transport: chatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))),
      createPageTransport: forbiddenPageTransport,
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('https://uk.indeed.com/viewjob?jk=abc123');
    await user.click(screen.getByTestId('paste-job-fetch'));
    await screen.findByTestId('paste-job-fetch-note');

    // The user does what the message told them to do.
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('Credit Risk Analyst at Lloyds Banking Group, City of London.');
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe(
      'Credit Risk Analyst',
    );
    // …and the address they pasted is still carried into the saved job.
    expect((screen.getByLabelText(/^Link/) as HTMLInputElement).value).toBe(
      'https://uk.indeed.com/viewjob?jk=abc123',
    );
    expect(port.calls.create).toBe(0);
  });

  it('the guard would notice a request — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. The same button, the
    // same click, the same counter — and an address that is NOT on the list.
    // It builds a transport, which is how we know the blocked cases above were
    // silent because nothing asked rather than because nothing counts.
    const user = userEvent.setup();
    const counting = countingPageTransport(ok({ status: 200, body: ADVERT_PAGE }));
    renderBoard({ createPageTransport: counting.factory });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    expect(counting.built()).toBe(0);

    await user.click(screen.getByTestId('paste-job-fetch'));
    await screen.findByTestId('paste-job-fetch-note');

    expect(counting.built()).toBe(1);
  });

  it('and the counter stays at zero for a blocklisted address', async () => {
    // The same counter, the other way round: this is the assertion the throwing
    // factory makes loudly, restated in a form that cannot pass by accident.
    const user = userEvent.setup();
    const counting = countingPageTransport(ok({ status: 200, body: ADVERT_PAGE }));
    renderBoard({ createPageTransport: counting.factory });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('https://uk.indeed.com/viewjob?jk=abc123');
    await user.click(screen.getByTestId('paste-job-fetch'));
    await screen.findByTestId('paste-job-fetch-note');

    expect(counting.built()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('when the fetch does not work', () => {
  const failures: ReadonlyArray<readonly [string, Result<FetchedPage, PageFetchError>]> = [
    ['a timeout', err({ kind: 'network', message: 'That page took too long to answer.' })],
    ['an unreachable host', err({ kind: 'network', message: 'That page could not be reached.' })],
    [
      'a redirect that left the site',
      err({ kind: 'blocked', message: 'That address is not one this app will open.' }),
    ],
    [
      'a PDF',
      err({ kind: 'unsupported', message: 'That link is not a web page the app can read.' }),
    ],
    [
      'a page too big to read',
      err({ kind: 'too-large', message: 'That page is too big to read.' }),
    ],
    ['a 404', ok({ status: 404, body: '<html><body><h1>Not found</h1></body></html>' })],
    [
      'a login wall',
      ok({
        status: 200,
        body: '<html><body><main><h1>Sign in to see this job</h1></main></body></html>',
      }),
    ],
  ];

  for (const [label, reply] of failures) {
    it(`${label} gets the same guided message`, async () => {
      const user = userEvent.setup();
      renderBoard({ createPageTransport: () => pageTransport(reply) });

      await openPaste(user);
      await user.click(screen.getByTestId('paste-job-url'));
      await user.paste(ADVERT_URL);
      await user.click(screen.getByTestId('paste-job-fetch'));

      const note = await screen.findByTestId('paste-job-fetch-note');
      expect(note.textContent).toBe(FETCH_FALLBACK_NOTE);
      expect(note.textContent).toMatch(/open it in your browser/i);
    });
  }

  it('no raw error, status code or jargon reaches the screen', async () => {
    const user = userEvent.setup();
    renderBoard({
      createPageTransport: () =>
        pageTransport(
          err({ kind: 'blocked', message: 'That address is not one this app will open.' }),
        ),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));
    await screen.findByTestId('paste-job-fetch-note');

    const onScreen = document.body.textContent ?? '';
    for (const leak of [
      'blocked',
      'unsupported',
      'too-large',
      'bad-url',
      'bad-response',
      'That address is not one',
      '404',
      '500',
      'Error',
      'undefined',
      'NaN',
    ]) {
      expect(onScreen).not.toContain(leak);
    }
  });

  it('the advert box is left alone so a half-fetch cannot eat a paste', async () => {
    // Somebody pastes the advert, then tries the link as well and it fails.
    // Losing the paste at that point would be the worst moment to lose it.
    const user = userEvent.setup();
    renderBoard({
      createPageTransport: () =>
        pageTransport(err({ kind: 'network', message: 'That page could not be reached.' })),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('The advert the user already had.');
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));
    await screen.findByTestId('paste-job-fetch-note');

    expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).value).toBe(
      'The advert the user already had.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the wait', () => {
  /**
   * ==========================================================================
   * FIFTEEN SECONDS OF A STILL SCREEN IS INDISTINGUISHABLE FROM A CRASH
   * ==========================================================================
   * The same rule the extraction wait already follows. A fetch on a slow
   * connection has a fifteen-second budget, and the user has no way to tell a
   * working fetch from a hung one unless the screen says so.
   */
  it('says what is happening while it happens, and every control is held', async () => {
    const user = userEvent.setup();
    // A transport that does not answer until this test lets it.
    let release: (value: Result<FetchedPage, PageFetchError>) => void = () => {};
    const pending = new Promise<Result<FetchedPage, PageFetchError>>((resolve) => {
      release = resolve;
    });
    renderBoard({
      createPageTransport: () => ({
        fetchPage: () => pending,
      }),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));

    const progress = await screen.findByTestId('paste-job-fetch-progress');
    expect(progress.textContent).toMatch(/opening that page/i);
    expect(progress.getAttribute('role')).toBe('status');
    // A counter, so a long wait visibly IS a wait rather than a freeze.
    expect(progress.textContent).toMatch(/[0-9]+s/);

    // Nothing else can be touched mid-fetch, so a second press cannot race the
    // first and the advert box cannot change under the reply.
    expect((screen.getByTestId('paste-job-fetch') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('paste-job-manual') as HTMLButtonElement).disabled).toBe(true);

    release(ok({ status: 200, body: ADVERT_PAGE }));

    // …and it all comes back afterwards.
    await waitFor(() =>
      expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).value).toContain(
        'Credit Risk Analyst',
      ),
    );
    expect(screen.queryByTestId('paste-job-fetch-progress')).toBeNull();
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(false);
  });

  it('the progress note is gone once a fetch has failed, replaced by the message', async () => {
    const user = userEvent.setup();
    renderBoard({
      createPageTransport: () =>
        pageTransport(err({ kind: 'network', message: 'That page could not be reached.' })),
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);
    await user.click(screen.getByTestId('paste-job-fetch'));

    await screen.findByTestId('paste-job-fetch-note');
    expect(screen.queryByTestId('paste-job-fetch-progress')).toBeNull();
    expect((screen.getByTestId('paste-job-fetch') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the link box itself', () => {
  it('says what fetching does BEFORE the button can be pressed', async () => {
    const user = userEvent.setup();
    renderBoard({});

    await openPaste(user);

    const disclosure = screen.getByTestId('paste-job-fetch-disclosure');
    expect(disclosure.textContent).toMatch(/the site sees your IP address/i);
    expect(disclosure.textContent).toMatch(/same as visiting it in your browser/i);
    expect(disclosure.textContent).toMatch(/nothing is sent to us/i);
    expect(disclosure.textContent).toMatch(/no other page is loaded/i);

    // It is on screen with the control, not hidden behind a hover.
    expect(disclosure.getAttribute('title')).toBeNull();
    expect(disclosure.textContent).not.toBe('');
  });

  it('negative: Fetch will not go on an empty box', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);

    expect((screen.getByTestId('paste-job-fetch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('negative: whitespace is not an address', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('    ');

    expect((screen.getByTestId('paste-job-fetch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('boundary: something that is not a URL is refused without a request', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('jobs.example.com/advert/1');
    await user.click(screen.getByTestId('paste-job-fetch'));

    const note = await screen.findByTestId('paste-job-fetch-note');
    expect(note.textContent).toBe(FETCH_FALLBACK_NOTE);
  });

  it('boundary: a file: address never reaches the transport', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste('file:///C:/Windows/win.ini');
    await user.click(screen.getByTestId('paste-job-fetch'));

    const note = await screen.findByTestId('paste-job-fetch-note');
    expect(note.textContent).toBe(FETCH_FALLBACK_NOTE);
  });

  it('Fetch is NOT the blue button — the screen is still about reading the advert', async () => {
    const user = userEvent.setup();
    renderBoard({
      createPageTransport: () => pageTransport(ok({ status: 200, body: ADVERT_PAGE })),
    });

    await openPaste(user);
    expect(screen.getByTestId('paste-job-fetch').getAttribute('data-primary')).toBeNull();

    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);

    // A typed address does not light a blue button: nothing is extractable yet.
    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the paste path, with the link box on screen and empty', () => {
  /**
   * ==========================================================================
   * THE EXISTING FLOW, BEHAVING EXACTLY AS IT DID
   * ==========================================================================
   * `pasteJob.test.tsx` is untouched and still passes, which is the real proof.
   * This block re-drives the same flow with the new control present, so a
   * regression that only appears once the link box exists cannot slip between
   * the two files.
   */
  it('paste → extract → review → save, with no fetch transport in sight', async () => {
    const user = userEvent.setup();
    const port = renderBoard({
      transport: chatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))),
      createPageTransport: forbiddenPageTransport,
    });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('Credit Risk Analyst\nLloyds Banking Group\nCity of London');
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe(
      'Credit Risk Analyst',
    );
    // Empty link box, empty link field. No invented address.
    expect((screen.getByLabelText(/^Link/) as HTMLInputElement).value).toBe('');
    expect(port.calls.create).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job.url).toBeNull();
  });

  it('"Fill it in myself" still rescues the paste', async () => {
    const user = userEvent.setup();
    const port = renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('The whole advert, pasted.');
    await user.click(screen.getByTestId('paste-job-manual'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByTestId('new-description') as HTMLTextAreaElement).value).toBe(
      'The whole advert, pasted.',
    );
    expect(port.calls.create).toBe(0);
  });

  it('the extract button still refuses an empty paste and says why', async () => {
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);

    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('paste-job-reason').textContent).toMatch(/paste the advert/i);
  });

  it('a typed address alone does not make the advert extractable', async () => {
    // The link box is not a second way to fill the advert box. Only a
    // successful fetch, or the user, puts text in there.
    const user = userEvent.setup();
    renderBoard({ createPageTransport: forbiddenPageTransport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(ADVERT_URL);

    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(true);
  });
});
