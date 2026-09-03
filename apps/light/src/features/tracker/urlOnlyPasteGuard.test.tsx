// @vitest-environment jsdom
/**
 * A link in the advert box never reaches a model.
 *
 * ============================================================================
 * THE ASSERTION THAT MATTERS IS THE ONE ABOUT THE TRANSPORT COUNT
 * ============================================================================
 * "A friendly message appeared" is easy to satisfy and proves almost nothing —
 * a build that showed the message AND still called the model would pass it. So
 * every test here counts how many times a chat transport was BUILT, and the
 * guard's whole claim is that the count stays at zero.
 *
 * A count rather than a factory that throws, deliberately, and for the reason
 * `fetchJob.test.tsx` already writes down: a throw out of a React click handler
 * becomes an unhandled rejection rather than a failed assertion, which reports
 * as a run-level error and can report as a PASS.
 *
 * ============================================================================
 * AND A COUNTER THAT CANNOT REACH ONE PROVES NOTHING EITHER
 * ============================================================================
 * `the counter would notice a call` drives a real advert through the same rig
 * and asserts the count reaches one. Without it, every zero above could be a
 * broken counter rather than a working guard — which is the failure this repo
 * has shipped more than any other.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { Tracker } from './Tracker';
import { URL_ONLY_BLOCKED_NOTE, URL_ONLY_NOTE } from './pastedUrl';
import { createFakeTrackerPort, type FakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const OPEN_URL = 'https://jobs.example.com/advert/credit-risk-analyst';
const BLOCKED_URL = 'https://uk.indeed.com/viewjob?jk=abc123';

/** A real advert — the thing that must still go all the way through. */
const ADVERT_TEXT = `Credit Risk Analyst
Lloyds Banking Group - City of London (hybrid, 3 days on site)
£45,000 - £55,000 per annum plus bonus.

You will sit in second-line credit risk for the wholesale book, reviewing limit
applications from the corporate coverage teams and challenging the assumptions
behind them.`;

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

/**
 * A chat transport factory that counts how many times it was asked to exist.
 *
 * Built at the FACTORY, not at `chat()`: the guard's promise is that the model
 * is never even prepared for, and a transport that got built and then went
 * unused would still mean the guard ran too late.
 */
function countingChatTransport(reply: string): {
  readonly built: () => number;
  readonly factory: () => ChatTransport;
} {
  const state = { built: 0 };
  return {
    built: () => state.built,
    factory: () => {
      state.built += 1;
      return {
        chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
          return Promise.resolve(ok({ status: 200, body: reply }));
        },
        listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
          throw new Error('the paste flow must never list models');
        },
      };
    },
  };
}

/**
 * A page transport factory that fails the test if a fetch is prepared for.
 *
 * Nothing in this file presses Fetch. The guard runs on the extract button, and
 * it must not quietly start a fetch of its own on the user's behalf — going and
 * getting a page is a decision the user makes by pressing the button that says
 * so, which is the whole disclosure argument in `runFetch.ts`.
 */
function forbiddenPageTransport(): never {
  throw new Error('the network was reached on a path that must never reach it');
}

function renderBoard(chat: { factory: () => ChatTransport }): FakeTrackerPort {
  const port = createFakeTrackerPort();
  render(
    <Tracker
      port={port}
      now={NOW}
      readAvailability={() => Promise.resolve(WITH_OLLAMA)}
      createTransport={chat.factory}
      createPageTransport={forbiddenPageTransport}
    />,
  );
  return port;
}

async function openPaste(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByTestId('tracker-empty');
  await user.click(screen.getByTestId('tracker-empty-paste'));
  await screen.findByTestId('paste-job-form');
}

/** Put text in the advert box and press the blue button. */
async function pasteAndExtract(
  user: ReturnType<typeof userEvent.setup>,
  text: string,
): Promise<void> {
  await user.click(screen.getByTestId('paste-job-text'));
  await user.paste(text);
  await user.click(screen.getByTestId('paste-job-extract'));
}

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('a link pasted into the advert box', () => {
  it('never reaches the model, and says so in a sentence', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    const port = renderBoard(chat);

    await openPaste(user);
    await pasteAndExtract(user, OPEN_URL);

    const note = await screen.findByTestId('paste-job-url-only-note');
    expect(note.textContent).toBe(URL_ONLY_NOTE);

    // THE assertion. No provider was so much as prepared for.
    expect(chat.built()).toBe(0);

    // No review form, so no invented fields to check, and nothing saved.
    expect(screen.queryByTestId('new-application-form')).toBeNull();
    expect(port.calls.create).toBe(0);
    expect(port.entries()).toEqual([]);
  });

  it('puts the address in the link box, so Fetch is one press away', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    renderBoard(chat);

    await openPaste(user);
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).value).toBe('');

    await pasteAndExtract(user, `  ${OPEN_URL}  `);

    await screen.findByTestId('paste-job-url-only-note');
    // Trimmed, and ready to press.
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).value).toBe(OPEN_URL);
    expect((screen.getByTestId('paste-job-fetch') as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves the paste alone — nothing the user typed is taken away', async () => {
    const user = userEvent.setup();
    renderBoard(countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))));

    await openPaste(user);
    await pasteAndExtract(user, OPEN_URL);

    await screen.findByTestId('paste-job-url-only-note');
    expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).value).toBe(OPEN_URL);
  });

  it('does not overwrite a link the user had already typed', async () => {
    const user = userEvent.setup();
    const already = 'https://careers.example.org/roles/88213';
    renderBoard(countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))));

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-url'));
    await user.paste(already);
    await pasteAndExtract(user, OPEN_URL);

    await screen.findByTestId('paste-job-url-only-note');
    // Their address, not the one we noticed. Pre-filling an empty box is a
    // convenience; replacing a full one is taking something away.
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).value).toBe(already);
  });

  it('is a status, not an alert — nothing is broken and nobody did anything wrong', async () => {
    const user = userEvent.setup();
    renderBoard(countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))));

    await openPaste(user);
    await pasteAndExtract(user, OPEN_URL);

    const note = await screen.findByTestId('paste-job-url-only-note');
    expect(note.getAttribute('role')).toBe('status');
    expect(screen.queryAllByRole('alert')).toEqual([]);
    // No raw address, no status code, no jargon on screen.
    expect(note.textContent).not.toMatch(/error|invalid|failed|400|404/i);
  });
});

describe('a link to a site that would not answer a fetch', () => {
  it('gets the guided paste instead, and is never sent to press Fetch', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    renderBoard(chat);

    await openPaste(user);
    await pasteAndExtract(user, BLOCKED_URL);

    const note = await screen.findByTestId('paste-job-url-only-note');
    expect(note.textContent).toBe(URL_ONLY_BLOCKED_NOTE);
    expect(note.textContent).toMatch(/browser/i);
    expect(note.textContent).not.toMatch(/press Fetch/);

    expect(chat.built()).toBe(0);
  });

  it('still pre-fills the link, because it is saved with the job either way', async () => {
    const user = userEvent.setup();
    renderBoard(countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))));

    await openPaste(user);
    await pasteAndExtract(user, BLOCKED_URL);

    await screen.findByTestId('paste-job-url-only-note');
    expect((screen.getByTestId('paste-job-url') as HTMLInputElement).value).toBe(BLOCKED_URL);
  });

  it('covers subdomains and LinkedIn too, not just the one address', async () => {
    for (const address of [
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://gb.linkedin.com/jobs/view/1/',
      'https://www.indeed.com/viewjob?jk=abc',
    ]) {
      const user = userEvent.setup();
      const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
      renderBoard(chat);

      await openPaste(user);
      await pasteAndExtract(user, address);

      const note = await screen.findByTestId('paste-job-url-only-note');
      expect(note.textContent, address).toBe(URL_ONLY_BLOCKED_NOTE);
      expect(chat.built(), address).toBe(0);

      cleanup();
    }
  });
});

describe('the guard gets out of the way again', () => {
  it('the note goes as soon as the box holds something else', async () => {
    const user = userEvent.setup();
    renderBoard(countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY))));

    await openPaste(user);
    await pasteAndExtract(user, OPEN_URL);
    await screen.findByTestId('paste-job-url-only-note');

    // The user does what the message asked and pastes the advert in.
    await user.clear(screen.getByTestId('paste-job-text'));
    await waitFor(() => expect(screen.queryByTestId('paste-job-url-only-note')).toBeNull());
  });

  it('and the advert then extracts normally, on the very next press', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    const port = renderBoard(chat);

    await openPaste(user);
    await pasteAndExtract(user, OPEN_URL);
    await screen.findByTestId('paste-job-url-only-note');
    expect(chat.built()).toBe(0);

    await user.clear(screen.getByTestId('paste-job-text'));
    await pasteAndExtract(user, ADVERT_TEXT);

    await screen.findByTestId('new-application-form');
    expect(chat.built()).toBe(1);
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe(
      'Credit Risk Analyst',
    );
    // The address the guard rescued is still in the link box, and rides along.
    expect((screen.getByLabelText(/^Link/) as HTMLInputElement).value).toBe(OPEN_URL);

    expect(port.calls.create).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job).toMatchObject({
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      url: OPEN_URL,
    });
  });
});

describe('the ordinary paste path, unchanged', () => {
  it('the counter would notice a call — proved, not assumed', async () => {
    // Non-vacuity. Every `built()` of zero above is only worth something if
    // this rig can reach one, and this is the test that shows it does.
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    renderBoard(chat);

    await openPaste(user);
    await pasteAndExtract(user, ADVERT_TEXT);

    await screen.findByTestId('new-application-form');
    expect(chat.built()).toBe(1);
  });

  it('an advert that quotes its own link is an advert, and is read as one', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    renderBoard(chat);

    await openPaste(user);
    await pasteAndExtract(user, `${ADVERT_TEXT}\n\nApply here: ${OPEN_URL}`);

    await screen.findByTestId('new-application-form');
    expect(chat.built()).toBe(1);
    expect(screen.queryByTestId('paste-job-url-only-note')).toBeNull();
  });

  it('"Fill it in myself" is untouched — no guard, no model, straight to the form', async () => {
    const user = userEvent.setup();
    const chat = countingChatTransport(ollamaBody(JSON.stringify(GOOD_REPLY)));
    renderBoard(chat);

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(OPEN_URL);
    await user.click(screen.getByTestId('paste-job-manual'));

    // The manual route never asked a model anything and never did before.
    await screen.findByTestId('new-application-form');
    expect(chat.built()).toBe(0);
  });
});
