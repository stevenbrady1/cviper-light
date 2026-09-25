// @vitest-environment jsdom
/**
 * Paste-a-job asks for consent ITSELF (L-141, #81).
 *
 * ============================================================================
 * THE DETOUR THIS CLOSES
 * ============================================================================
 * L-115 gated `runExtraction`: a pasted advert never reaches a cloud provider
 * without the user's per-provider, revocable agreement. But the only place
 * that agreement could be GIVEN was the Analysis screen — so somebody whose
 * first AI action was pasting an advert with an OpenAI key was refused with a
 * sentence sending them to another screen, where the dialog only opens once a
 * CV is chosen and a check is run. Honest, and a dead end for a new user.
 *
 * Now the paste form raises the SAME `ConsentGate` the Analysis and Tailor
 * screens use, records the answer in the SAME store, and runs the extraction
 * the user was trying to run the moment they say yes.
 *
 * ============================================================================
 * THE LOAD-BEARING ASSERTION IS STILL THE TRANSPORT COUNT
 * ============================================================================
 * Same rule as `runExtraction.consent.test.ts`: "a dialog appeared" proves
 * little on its own. Every test here counts how many transports were BUILT,
 * and the claim is that the count is zero until the user has said yes — and
 * exactly one afterwards.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';
import { createFakeConsentPort } from '../analysis/test/fakeConsentPort';

import { PasteJobForm } from './PasteJobForm';
import { type ApplicationDraft } from './model';

const ADVERT = [
  'Credit Risk Analyst',
  'Lloyds Banking Group',
  'City of London (hybrid, 3 days on site)',
  'Salary £45k-£55k plus bonus. Apply to Dana Whitfield, dana.whitfield@example.com.',
].join('\n');

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

/** Only an OpenAI key on this machine: the one option is a cloud one. */
const OPENAI_ONLY: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: true,
};

/** Only Ollama: the one option is local, and consent is not a question. */
const OLLAMA_ONLY: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
  anthropicKey: false,
  openaiKey: false,
};

function openaiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
}

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/**
 * A transport factory that counts how many times it was asked to exist.
 *
 * Counted at the FACTORY, as in `runExtraction.consent.test.ts`: the promise
 * is that the model is never even prepared for until the user has agreed.
 */
function countingFactory(body: string): {
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
          return Promise.resolve(ok({ status: 200, body }));
        },
        listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
          throw new Error('the paste flow must never list models');
        },
      };
    },
  };
}

interface Rig {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly built: () => number;
  readonly onExtracted: ReturnType<
    typeof vi.fn<(draft: ApplicationDraft, notice: string | null) => void>
  >;
}

async function renderForm(options: {
  availability: Availability;
  body: string;
  consentPort: ConsentPort;
}): Promise<Rig> {
  const user = userEvent.setup();
  const transport = countingFactory(options.body);
  const onExtracted = vi.fn<(draft: ApplicationDraft, notice: string | null) => void>();

  render(
    <PasteJobForm
      onExtracted={onExtracted}
      onCancel={() => {}}
      createTransport={transport.factory}
      readAvailability={() => Promise.resolve(options.availability)}
      consentPort={options.consentPort}
    />,
  );

  // The probe has answered once the option note is on screen.
  await screen.findByTestId('paste-job-provider-note');
  await user.type(screen.getByTestId('paste-job-text'), ADVERT);

  return { user, built: transport.built, onExtracted };
}

afterEach(() => {
  cleanup();
});

describe('paste-a-job asks for consent itself (L-141)', () => {
  it('a first cloud extraction opens the consent dialog, and no transport is built', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));

    // The SAME dialog the Analysis screen uses — same testid, same wording.
    const gate = await screen.findByTestId('analysis-consent-gate');
    expect(gate.textContent).toContain('Send this CV to OpenAI?');
    expect(rig.built()).toBe(0);
    expect(rig.onExtracted).not.toHaveBeenCalled();
    // Nothing has been recorded by merely asking.
    expect(consentPort.state().openai).toBe(false);
  });

  it('agreeing in the dialog records the choice and runs the very extraction that was pending', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    await waitFor(() => expect(rig.onExtracted).toHaveBeenCalledTimes(1));
    const [draft, notice] = rig.onExtracted.mock.calls[0]!;
    expect(notice).toBeNull();
    expect(draft.title).toBe('Credit Risk Analyst');
    expect(draft.company).toBe('Lloyds Banking Group');
    expect(rig.built()).toBe(1);
    // Recorded in the shared store, so the Analysis screen sees it too.
    expect(consentPort.state().openai).toBe(true);
    expect(consentPort.state().anthropic).toBe(false);
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
  });

  it('declining sends nothing, records nothing, and keeps the paste', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-decline'));

    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(0);
    expect(rig.onExtracted).not.toHaveBeenCalled();
    expect(consentPort.state().openai).toBe(false);
    // The advert is still there: "Not now" is not "throw that away".
    expect((screen.getByTestId('paste-job-text') as HTMLTextAreaElement).value).toBe(ADVERT);
    // And the button is live again, so the user can change their mind.
    expect((screen.getByTestId('paste-job-extract') as HTMLButtonElement).disabled).toBe(false);
  });

  it('consent already recorded: the press extracts straight away, no dialog', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));

    await waitFor(() => expect(rig.onExtracted).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(1);
  });

  it('the Ollama exemption: a local extraction never asks, and never touches the store', async () => {
    const consentPort = createFakeConsentPort();
    const grant = vi.spyOn(consentPort, 'grant');
    const rig = await renderForm({
      availability: OLLAMA_ONLY,
      body: ollamaBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));

    await waitFor(() => expect(rig.onExtracted).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(grant).not.toHaveBeenCalled();
    expect(rig.built()).toBe(1);
  });

  it('boundary: consent withdrawn elsewhere after this form opened is honoured — the store is read at press time', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort,
    });

    // The Analysis screen's Withdraw button, pressed while this pane was open.
    await consentPort.revoke('openai');

    await rig.user.click(screen.getByTestId('paste-job-extract'));

    await screen.findByTestId('analysis-consent-gate');
    expect(rig.built()).toBe(0);
    expect(rig.onExtracted).not.toHaveBeenCalled();
  });

  it('negative: a choice that cannot be saved is said on screen, and nothing is sent', async () => {
    const consentPort = createFakeConsentPort();
    const failing: ConsentPort = {
      read: () => consentPort.read(),
      revoke: (kind) => consentPort.revoke(kind),
      grant: () =>
        Promise.resolve(
          err({ message: 'That choice could not be saved, so it will be asked again. Disk full.' }),
        ),
    };
    const rig = await renderForm({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(GOOD_REPLY)),
      consentPort: failing,
    });

    await rig.user.click(screen.getByTestId('paste-job-extract'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    const note = await screen.findByTestId('paste-job-consent-note');
    expect(note.textContent).toContain('could not be saved');
    expect(rig.built()).toBe(0);
    expect(rig.onExtracted).not.toHaveBeenCalled();
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
  });
});
