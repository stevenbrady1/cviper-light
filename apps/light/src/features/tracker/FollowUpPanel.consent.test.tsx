// @vitest-environment jsdom
/**
 * The follow-up panel asks for consent ITSELF (L-171, issue 120).
 *
 * The same detour L-141 closed for paste-a-job: `runFollowUp` was gated
 * (L-115-shaped), but the only place consent could be GIVEN was the Analysis
 * screen. Somebody drafting their first follow-up with a cloud key was
 * refused and pointed at another screen. Now the panel raises the same
 * `ConsentGate`, records the answer in the same store, and drafts the note
 * that was pending the moment the user says yes.
 *
 * Every test counts transports BUILT — zero until yes, one after — because
 * "a dialog appeared" proves little on its own (see
 * `runFollowUp.consent.test.ts`).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Application, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';
import { createFakeConsentPort } from '../analysis/test/fakeConsentPort';

import { FollowUpPanel } from './FollowUpPanel';
import { createEntry, EMPTY_DRAFT, type TrackerEntry } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = '2026-09-01T09:00:00.000Z';
/** Twelve quiet days: the follow-up is due, so the button is live. */
const TODAY_DUE = '2026-09-13';

const DRAFT = {
  subject: 'Following up on my Credit Risk Analyst application',
  body: 'Hello Dana,\n\nI wanted to check in on my application.\n\nKind regards,\nJane Doe',
};

const OPENAI_ONLY: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: true,
};

const OLLAMA_ONLY: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
  anthropicKey: false,
  openaiKey: false,
};

function entry(overrides: Partial<Application> = {}): TrackerEntry {
  const base = createEntry(
    {
      ...EMPTY_DRAFT,
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      status: 'applied',
      description: 'Second-line credit risk for the wholesale book.',
    },
    { jobId: 'job-1', applicationId: 'app-1' },
    NOW,
  );
  return {
    ...base,
    application: { ...base.application, applied_date: '2026-09-01', ...overrides },
  };
}

function openaiBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] });
}

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

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
          throw new Error('the follow-up panel must never list models');
        },
      };
    },
  };
}

async function renderPanel(options: {
  availability: Availability;
  body: string;
  consentPort: ConsentPort;
}): Promise<{
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly built: () => number;
}> {
  const user = userEvent.setup();
  const current = entry();
  const port = createFakeTrackerPort([current], {});
  const transport = countingFactory(options.body);

  render(
    <FollowUpPanel
      entry={current}
      today={TODAY_DUE}
      port={port}
      readAvailability={() => Promise.resolve(options.availability)}
      createTransport={transport.factory}
      consentPort={options.consentPort}
      onEdit={() => {}}
    />,
  );

  // The probe has answered once the button is enabled.
  await waitFor(() =>
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(false),
  );

  return { user, built: transport.built };
}

afterEach(() => {
  cleanup();
});

describe('the follow-up panel asks for consent itself (L-171)', () => {
  it('a first cloud draft opens the consent dialog, and no transport is built', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));

    const gate = await screen.findByTestId('analysis-consent-gate');
    expect(gate.textContent).toContain('OpenAI');
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
    expect(consentPort.state().openai).toBe(false);
  });

  it('agreeing records the choice and drafts the note that was pending', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    await screen.findByTestId('detail-followup-editor');
    expect((screen.getByTestId('detail-followup-subject') as HTMLInputElement).value).toBe(
      DRAFT.subject,
    );
    expect(rig.built()).toBe(1);
    expect(consentPort.state().openai).toBe(true);
    expect(consentPort.state().anthropic).toBe(false);
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
  });

  it('declining drafts nothing, records nothing, and leaves the button live', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-decline'));

    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
    expect(consentPort.state().openai).toBe(false);
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(false);
  });

  it('consent already recorded: the press drafts straight away, no dialog', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));

    await screen.findByTestId('detail-followup-editor');
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(1);
  });

  it('the Ollama exemption: a local draft never asks, and never touches the store', async () => {
    const consentPort = createFakeConsentPort();
    const grant = vi.spyOn(consentPort, 'grant');
    const rig = await renderPanel({
      availability: OLLAMA_ONLY,
      body: ollamaBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));

    await screen.findByTestId('detail-followup-editor');
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(grant).not.toHaveBeenCalled();
    expect(rig.built()).toBe(1);
  });

  it('boundary: consent withdrawn elsewhere after the card opened is honoured at press time', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort,
    });

    await consentPort.revoke('openai');
    await rig.user.click(screen.getByTestId('detail-followup-draft'));

    await screen.findByTestId('analysis-consent-gate');
    expect(rig.built()).toBe(0);
  });

  it('negative: a choice that cannot be saved is said on screen, and nothing is drafted', async () => {
    const consentPort = createFakeConsentPort();
    const failing: ConsentPort = {
      read: () => consentPort.read(),
      revoke: (kind) => consentPort.revoke(kind),
      grant: () =>
        Promise.resolve(
          err({ message: 'That choice could not be saved, so it will be asked again. Disk full.' }),
        ),
    };
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(DRAFT)),
      consentPort: failing,
    });

    await rig.user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    const alert = await screen.findByTestId('detail-followup-error');
    expect(alert.textContent).toContain('could not be saved');
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
  });
});
