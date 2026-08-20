// @vitest-environment jsdom
/**
 * Paste an advert, let a model read it, CHECK IT, then save.
 *
 * ============================================================================
 * THE ONE PROMISE THIS FILE EXISTS FOR
 * ============================================================================
 * NOTHING IS EVER SAVED WITHOUT THE USER CONFIRMING IT. Not on a good
 * extraction, not on a bad one, not when the model is confident, not when every
 * field came back filled in. The board writes a row only when somebody presses
 * "Save application", and the tests below prove it by counting writes at the
 * port after every step that could plausibly have snuck one in.
 *
 * That promise decays the way every promise like it decays: somebody adds a
 * "looks good, save it for me" shortcut, or an autosave, or a write in the
 * success branch to avoid losing work — each defensible, each the end of the
 * review step. This is what turns it from a thing people remember into a thing
 * the build refuses.
 *
 * Everything here goes through the real components with a real click, real
 * typing and a side effect asserted afterwards. The only fakes are the storage
 * port, the credential probe and the HTTP transport, none of which exist in a
 * Vitest process.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { Tracker } from './Tracker';
import { createFakeTrackerPort, type FakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const ADVERT = [
  'Credit Risk Analyst',
  'Lloyds Banking Group',
  'City of London (hybrid, 3 days on site)',
  'Salary £45k-£55k plus bonus.',
].join('\n');

const PRO_RATA_ADVERT = [
  'Part-time Financial Controller',
  'Three days a week, City of London.',
  'Salary £45,000 pro rata.',
].join('\n');

/** What a good model returns for `ADVERT`. */
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

const NOTHING_CONFIGURED: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

/** An Ollama chat envelope carrying whatever the model "said". */
function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/**
 * A transport that answers with a queue of replies and counts the calls.
 *
 * Past the end of the queue the last reply repeats, so a test that cares about
 * one call does not have to pad the array.
 */
function transportFor(replies: readonly string[]): ChatTransport & { calls: number } {
  const queue = [...replies];
  const state = { calls: 0 };

  return {
    get calls() {
      return state.calls;
    },
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      state.calls += 1;
      const body = queue.length > 1 ? (queue.shift() ?? '') : (queue[0] ?? '');
      return Promise.resolve(ok({ status: 200, body }));
    },
    listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      throw new Error('the paste flow must never list models');
    },
  };
}

function renderBoard(options: {
  availability?: Availability;
  transport?: ChatTransport;
  onOpenSettings?: () => void;
}): FakeTrackerPort {
  const port = createFakeTrackerPort();
  render(
    <Tracker
      port={port}
      now={NOW}
      readAvailability={() => Promise.resolve(options.availability ?? WITH_OLLAMA)}
      createTransport={options.transport === undefined ? undefined : () => options.transport!}
      onOpenSettings={options.onOpenSettings}
    />,
  );
  return port;
}

/** Open the paste pane from the empty board. */
async function openPaste(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByTestId('tracker-empty');
  await user.click(screen.getByTestId('tracker-empty-paste'));
  await screen.findByTestId('paste-job-form');
}

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the whole paste → review → save loop', () => {
  it('fills the review form in and saves only what the user confirms', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    // --- The review form, pre-filled ---------------------------------------
    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe(
      'Credit Risk Analyst',
    );
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe(
      'Lloyds Banking Group',
    );
    expect((screen.getByLabelText(/^Salary from/) as HTMLInputElement).value).toBe('45000');
    expect((screen.getByLabelText(/^Salary to/) as HTMLInputElement).value).toBe('55000');

    // --- NOTHING HAS BEEN SAVED --------------------------------------------
    expect(port.calls.create).toBe(0);
    expect(port.entries()).toEqual([]);

    // --- Now the user confirms ---------------------------------------------
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job).toMatchObject({
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      salary_min: 45000,
      salary_max: 55000,
      salary_currency: 'GBP',
      salary_period: 'year',
    });
  });

  it('saves the user’s CORRECTION, not the model’s answer', async () => {
    // The review step is only real if editing changes what is stored. An agency
    // posting is the everyday case: the model records the recruiter as the
    // company because our schema has no `agency` field, and the user fixes it.
    const user = userEvent.setup();
    const transport = transportFor([
      ollamaBody(JSON.stringify({ ...GOOD_REPLY, company: 'Harrington Search' })),
    ]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    const company = await screen.findByLabelText('Company');
    await user.clear(company);
    await user.type(company, 'Lloyds Banking Group');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job.company).toBe('Lloyds Banking Group');
  });

  it('GAP: hybrid wording reaches the saved row word for word', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText(/^Location/) as HTMLInputElement).value).toBe(
      'City of London (hybrid, 3 days on site)',
    );

    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await waitFor(() => expect(port.entries()).toHaveLength(1));
    // The source app would have stored "City of London".
    expect(port.entries()[0]?.job.location).toBe('City of London (hybrid, 3 days on site)');
  });

  it('GAP: pro-rata pay reaches the form as EMPTY salary boxes, wording kept', async () => {
    const user = userEvent.setup();
    // The model does what the source's parser does: reads 45000 as a salary.
    const transport = transportFor([
      ollamaBody(
        JSON.stringify({
          ...GOOD_REPLY,
          title: 'Part-time Financial Controller',
          description: 'Part-time control function.',
          salary_min: 45000,
          salary_max: 45000,
        }),
      ),
    ]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(PRO_RATA_ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByLabelText(/^Salary from/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Salary to/) as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('new-description') as HTMLTextAreaElement).value).toContain(
      '£45,000 pro rata',
    );

    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job.salary_min).toBeNull();
    expect(port.entries()[0]?.job.salary_period).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('confirm before save — the promise, proved from several angles', () => {
  it('a successful extraction writes NOTHING until the button is pressed', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));
    await screen.findByTestId('new-application-form');

    // Every write the port knows how to do. Not one of them has happened.
    expect(port.calls.create).toBe(0);
    expect(port.calls.saveApplication).toBe(0);
    expect(port.calls.remove).toBe(0);
    expect(port.entries()).toEqual([]);
  });

  it('closing the review form throws the extraction away rather than saving it', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));
    await screen.findByTestId('new-application-form');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('new-application-form')).toBeNull());
    expect(port.calls.create).toBe(0);
    expect(port.entries()).toEqual([]);
  });

  it('an extraction missing a required field cannot be saved by pressing Save', async () => {
    // The review form's own validation still applies to an extracted draft: a
    // model that could not find a company does not get to write a nameless card.
    const user = userEvent.setup();
    const transport = transportFor([
      ollamaBody(JSON.stringify({ ...GOOD_REPLY, title: null, company: null })),
    ]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    expect(port.calls.create).toBe(0);
    expect(screen.getByText(/Add a job title/)).toBeTruthy();
  });

  it('the guard would notice a save — proved, not assumed', async () => {
    // A guard that cannot fail is worse than no guard. The same port, the same
    // counter, driven through the ordinary manual path: it counts.
    const user = userEvent.setup();
    const port = renderBoard({});

    await screen.findByTestId('tracker-empty');
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await waitFor(() => expect(port.calls.create).toBe(1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('when the model cannot do it — the fall-through', () => {
  it('opens the blank manual form WITH the pasted text in the description', async () => {
    const user = userEvent.setup();
    // Prose twice: the first answer fails, the repair turn fails too.
    const transport = transportFor([
      ollamaBody('I am not sure what you want me to do with this.'),
      ollamaBody('Still not sure, sorry.'),
    ]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');

    // Blank where the model would have guessed…
    expect((screen.getByLabelText('Job title') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Salary from/) as HTMLInputElement).value).toBe('');
    // …and NOTHING the user pasted is lost.
    expect((screen.getByTestId('new-description') as HTMLTextAreaElement).value).toBe(ADVERT);
    expect(port.calls.create).toBe(0);
  });

  it('says what happened, without treating it as a crash', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody('nope'), ollamaBody('nope')]);
    renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    const notice = await screen.findByTestId('tracker-extract-notice');
    expect(notice.textContent).toMatch(/by hand/i);
    expect(notice.textContent).toMatch(/paste is in the description/i);
    // A status, not an alert. Nothing is broken; the form works.
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('the user can still save the card by typing the rest themselves', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody('nope'), ollamaBody('nope')]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    await user.type(screen.getByLabelText('Job title'), 'Credit Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Lloyds');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await waitFor(() => expect(port.entries()).toHaveLength(1));
    expect(port.entries()[0]?.job.description).toBe(ADVERT);
  });

  it('a daemon that is not running falls through the same way', async () => {
    const user = userEvent.setup();
    const dead: ChatTransport = {
      chat: () =>
        Promise.resolve({
          ok: false,
          error: {
            provider: 'ollama',
            kind: 'not-running',
            message: 'Ollama is not running on this machine.',
          },
        }),
      listModels: () => {
        throw new Error('unused');
      },
    };
    const port = renderBoard({ transport: dead });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-extract'));

    const notice = await screen.findByTestId('tracker-extract-notice');
    expect(notice.textContent).toContain('Ollama is not running on this machine.');
    expect((screen.getByTestId('new-description') as HTMLTextAreaElement).value).toBe(ADVERT);
    expect(port.calls.create).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('with no AI provider configured', () => {
  it('says so kindly, offers Settings, and never guesses', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    renderBoard({ availability: NOTHING_CONFIGURED, onOpenSettings: openSettings });

    await openPaste(user);

    const reason = await screen.findByTestId('paste-job-reason');
    expect(reason.textContent).toContain('Ollama');
    expect(reason.textContent).toMatch(/your own key/);
    expect(reason.textContent).toMatch(/add the job manually/i);

    await user.click(screen.getByTestId('paste-job-settings'));
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('leaves the Extract button on screen but disabled — never hidden', async () => {
    // A control that comes and goes is a control the user cannot learn.
    const user = userEvent.setup();
    renderBoard({ availability: NOTHING_CONFIGURED });

    await openPaste(user);
    await screen.findByTestId('paste-job-reason');

    const extract = screen.getByTestId('paste-job-extract') as HTMLButtonElement;
    expect(extract).toBeTruthy();
    expect(extract.disabled).toBe(true);
  });

  it('still rescues the paste through "Fill it in myself"', async () => {
    const user = userEvent.setup();
    const port = renderBoard({ availability: NOTHING_CONFIGURED });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);
    await user.click(screen.getByTestId('paste-job-manual'));

    await screen.findByTestId('new-application-form');
    expect((screen.getByTestId('new-description') as HTMLTextAreaElement).value).toBe(ADVERT);
    expect(port.calls.create).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the paste box itself', () => {
  it('negative: Extract will not go on an empty paste, and says why', async () => {
    const user = userEvent.setup();
    renderBoard({ transport: transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]) });

    await openPaste(user);

    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('paste-job-reason').textContent).toMatch(/paste the advert/i);
  });

  it('negative: whitespace is not a paste', async () => {
    const user = userEvent.setup();
    renderBoard({ transport: transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]) });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('   \n\t  ');

    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(true);
  });

  it('boundary: a one-character paste is allowed through — refusing it would be a guess', async () => {
    const user = userEvent.setup();
    renderBoard({ transport: transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]) });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste('x');

    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(false);
  });

  it('boundary: a paste far past the model’s budget is read, not rejected', async () => {
    // Oversized pastes are TRUNCATED, never refused — the source app's rule at
    // `EMAIL_PASTE_MAX_CHARS`, and the right one: the useful part of an advert
    // is at the top, and a wall of quoted thread underneath is not the user's
    // fault.
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    const port = renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(`${ADVERT}\n${'quoted thread. '.repeat(2000)}`);
    await user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('new-application-form');
    expect(transport.calls).toBe(1);
    expect(port.calls.create).toBe(0);
  });

  it('does not consult a provider until Extract is pressed', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(GOOD_REPLY))]);
    renderBoard({ transport });

    await openPaste(user);
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);

    // Typing an advert costs nothing. Opening the pane costs nothing.
    expect(transport.calls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('one blue button, still', () => {
  it('the paste entry point is NOT primary', async () => {
    const user = userEvent.setup();
    renderBoard({});

    await screen.findByTestId('tracker-empty');
    expect(screen.getByTestId('tracker-empty-paste').getAttribute('data-primary')).toBeNull();

    await user.click(screen.getByTestId('tracker-empty-paste'));
    await screen.findByTestId('paste-job-form');

    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(0); // the paste box is empty, so Extract is off
  });

  it('exactly one blue button is live once there is something to extract', async () => {
    const user = userEvent.setup();
    renderBoard({});

    await screen.findByTestId('tracker-empty');
    await user.click(screen.getByTestId('tracker-empty-paste'));
    await screen.findByTestId('paste-job-form');
    await user.click(screen.getByTestId('paste-job-text'));
    await user.paste(ADVERT);

    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(1);
    expect((enabled[0] as HTMLElement).dataset['testid']).toBe('paste-job-extract');
  });
});
