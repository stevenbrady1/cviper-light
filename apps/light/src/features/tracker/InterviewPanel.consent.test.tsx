// @vitest-environment jsdom
/**
 * The interview panel asks for consent ITSELF (L-171, issue 120).
 *
 * The same detour L-141 closed for paste-a-job. `runInterview` was gated, but
 * the only place consent could be GIVEN was the Analysis screen — and this
 * path carries the CV and the profile's worked examples as well as the
 * advert, so a dead end here cost the user the most. Now the panel raises
 * the same `ConsentGate`, records the answer in the same store, and prepares
 * the pack that was pending the moment the user says yes.
 *
 * Every test counts transports BUILT — zero until yes, one after.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Profile, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type ConsentPort } from '../analysis/consent';
import { type Availability } from '../analysis/providers';
import { createFakeConsentPort } from '../analysis/test/fakeConsentPort';

import { InterviewPanel } from './InterviewPanel';
import { createEntry, EMPTY_DRAFT } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 8, 14, 9, 0, 0);

const ENTRY = createEntry(
  {
    ...EMPTY_DRAFT,
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    location: 'London',
    description: 'Second-line credit risk. SQL, Python, IFRS 9 models.',
  },
  { jobId: 'job-1', applicationId: 'app-1' },
  '2026-09-01T09:00:00.000Z',
);

const PROFILE: Profile = {
  id: 'me',
  headline: 'Credit risk analyst who ships models',
  languages: [],
  work_rights: null,
  deal_breakers: [],
  target_sectors: [],
  career_goals: ['Lead a model validation team'],
  energising: [],
  draining: [],
  writing_style: null,
  star_examples: [],
  updated_at: '2026-09-01T09:00:00.000Z',
};

const PACK = {
  likely_questions: [
    { question: 'Why credit risk?', suggested_answer: 'Six years of it at a challenger bank.' },
  ],
  talking_points: ['Zero-outage cutover at quarter end'],
  questions_to_ask: ['How is IFRS 9 model ownership split?'],
  gaps_to_bridge: ['SAS'],
};

const OPENAI_ONLY: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: true,
};

const OLLAMA_ONLY: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
  anthropicKey: false,
  openaiKey: false,
};

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
          throw new Error('the panel must never list models');
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
  const port = createFakeTrackerPort([ENTRY], { profile: PROFILE, cvText: 'Jane Doe. SQL.' });
  const transport = countingFactory(options.body);

  render(
    <InterviewPanel
      entry={ENTRY}
      port={port}
      availability={options.availability}
      createTransport={transport.factory}
      consentPort={options.consentPort}
      now={NOW}
    />,
  );

  await waitFor(() =>
    expect((screen.getByTestId('detail-interview-prepare') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );

  return { user, built: transport.built };
}

afterEach(() => {
  cleanup();
});

describe('the interview panel asks for consent itself (L-171)', () => {
  it('a first cloud run opens the consent dialog, and no transport is built', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(PACK)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));

    const gate = await screen.findByTestId('analysis-consent-gate');
    expect(gate.textContent).toContain('OpenAI');
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
    expect(consentPort.state().openai).toBe(false);
  });

  it('agreeing records the choice and prepares the pack that was pending', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(PACK)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    const pack = await screen.findByTestId('detail-interview-pack');
    expect(pack.textContent).toContain('Why credit risk?');
    expect(rig.built()).toBe(1);
    expect(consentPort.state().openai).toBe(true);
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
  });

  it('declining prepares nothing, records nothing, and leaves the button live', async () => {
    const consentPort = createFakeConsentPort();
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(PACK)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-decline'));

    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
    expect(consentPort.state().openai).toBe(false);
    expect((screen.getByTestId('detail-interview-prepare') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('consent already recorded: the press prepares straight away, no dialog', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(PACK)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));

    await screen.findByTestId('detail-interview-pack');
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(rig.built()).toBe(1);
  });

  it('the Ollama exemption: a local run never asks, and never touches the store', async () => {
    const consentPort = createFakeConsentPort();
    const grant = vi.spyOn(consentPort, 'grant');
    const rig = await renderPanel({
      availability: OLLAMA_ONLY,
      body: ollamaBody(JSON.stringify(PACK)),
      consentPort,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));

    await screen.findByTestId('detail-interview-pack');
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(grant).not.toHaveBeenCalled();
    expect(rig.built()).toBe(1);
  });

  it('boundary: consent withdrawn elsewhere after the card opened is honoured at press time', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const rig = await renderPanel({
      availability: OPENAI_ONLY,
      body: openaiBody(JSON.stringify(PACK)),
      consentPort,
    });

    await consentPort.revoke('openai');
    await rig.user.click(screen.getByTestId('detail-interview-prepare'));

    await screen.findByTestId('analysis-consent-gate');
    expect(rig.built()).toBe(0);
  });

  it('negative: a choice that cannot be saved is said on screen, and nothing is prepared', async () => {
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
      body: openaiBody(JSON.stringify(PACK)),
      consentPort: failing,
    });

    await rig.user.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('analysis-consent-gate');
    await rig.user.click(screen.getByTestId('analysis-consent-accept'));

    const note = await screen.findByTestId('detail-interview-note');
    expect(note.textContent).toContain('could not be saved');
    expect(rig.built()).toBe(0);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
  });
});
