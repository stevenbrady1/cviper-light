// @vitest-environment jsdom
/**
 * The consent gate wired into the analysis screen (Apple 5.1.2(i)): a CV must
 * never reach OpenAI or Anthropic without the user's explicit, per-provider,
 * revocable agreement, and Ollama must never trigger it at all.
 *
 * ============================================================================
 * WHY A FAKE `ConsentPort`, NOT THE REAL ONE
 * ============================================================================
 * Same reasoning as `test/fakePort.ts`: this is the inspection surface —
 * `grant`/`revoke` calls, and the state they leave behind — not a rehearsal of
 * `@tauri-apps/plugin-store`, which `consent.test.ts` already covers through
 * the real port.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Analysis } = await import('./Analysis');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeConsentPort } = await import('./test/fakeConsentPort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting.';

const ADVERT =
  'Credit Risk Analyst. You will build SQL models and report on IFRS 9 impairment. ' +
  'Python experience essential.';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

/** A `CvAnalysis` a model might return. */
const REPLY = JSON.stringify({
  matched_skills: ['sql', 'python'],
  missing_skills: ['sas'],
  matched_keywords: ['risk'],
  keyword_gaps: ['impairment'],
  ats_notes: ['Use a single column layout.'],
  suggestions: [
    { section: 'Skills', issue: 'No SAS.', recommendation: 'Add it.', priority: 'high' },
  ],
  summary: 'A close fit on the modelling side.',
  match_score: 81,
  verdict: 'possible',
});

/** Ollama running with one chat model, and both cloud keys saved. */
const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3.2B' },
    },
  ],
});

function everyProviderAvailable(): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return true;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  everyProviderAvailable();
});

afterEach(() => {
  cleanup();
});

function openaiEnvelope(content: string) {
  return { status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) };
}

/** An Ollama `/api/chat` envelope wrapping one assistant message. */
function ollamaEnvelope(content: string) {
  return { status: 200, body: JSON.stringify({ message: { role: 'assistant', content } }) };
}

/** Answers in the envelope shape the ASKED provider actually uses. */
function fakeTransport(): ChatTransport {
  return {
    chat: (provider) =>
      Promise.resolve(ok(provider === 'ollama' ? ollamaEnvelope(REPLY) : openaiEnvelope(REPLY))),
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
}

async function renderReady(consentPort: ReturnType<typeof createFakeConsentPort>) {
  const port = createFakeAnalysisPort({ cvs: [CV] });
  const user = userEvent.setup();

  render(
    <Analysis
      port={port}
      filePort={createFakeFilePort()}
      createTransport={fakeTransport}
      consentPort={consentPort}
      now={NOW}
    />,
  );

  await screen.findByDisplayValue('CV.docx');
  await user.type(screen.getByTestId('analysis-job-text'), ADVERT);

  return { port, user };
}

describe('choosing a cloud provider for the first time', () => {
  it('happy: shows the gate, and accepting it grants consent and runs the analysis', async () => {
    const consentPort = createFakeConsentPort();
    const { user, port } = await renderReady(consentPort);

    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));

    // Blocked on the gate — nothing has run yet.
    const gate = await screen.findByTestId('analysis-consent-gate');
    expect(gate.textContent).toContain('OpenAI');
    expect(screen.queryByTestId('analysis-result')).toBeNull();

    await user.click(screen.getByTestId('analysis-consent-accept'));

    await screen.findByTestId('analysis-result');
    expect(consentPort.state()).toEqual({ anthropic: false, openai: true });
    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.provider).toBe('openai');
  });

  it('negative: declining leaves consent untouched, runs nothing, and the app stays usable', async () => {
    const consentPort = createFakeConsentPort();
    const { user, port } = await renderReady(consentPort);

    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-consent-gate');

    await user.click(screen.getByTestId('analysis-consent-decline'));

    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(consentPort.state()).toEqual({ anthropic: false, openai: false });
    expect(port.storedAnalyses()).toEqual([]);

    // The app is still usable: the deterministic basic match still works.
    await user.selectOptions(screen.getByTestId('analysis-provider'), 'keyword');
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');
    expect(port.storedAnalyses()[0]?.provider).toBe('keyword');
  });

  it('boundary: consenting to Anthropic earlier does not skip the gate for OpenAI', async () => {
    const consentPort = createFakeConsentPort({ anthropic: true, openai: false });
    const { user } = await renderReady(consentPort);

    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));

    expect(await screen.findByTestId('analysis-consent-gate')).toBeTruthy();
  });

  it('the Ollama exemption: running a local model never shows the gate', async () => {
    const consentPort = createFakeConsentPort();
    const { user } = await renderReady(consentPort);

    await user.selectOptions(screen.getByTestId('analysis-provider'), 'ollama:llama3.2:3b');
    await user.click(screen.getByTestId('analysis-run'));

    await screen.findByTestId('analysis-result');
    expect(screen.queryByTestId('analysis-consent-gate')).toBeNull();
  });
});

describe('withdrawing consent', () => {
  it('is reachable from this screen regardless of which option is currently picked', async () => {
    const consentPort = createFakeConsentPort({ anthropic: true, openai: false });
    const { user } = await renderReady(consentPort);

    // The current picker selection is Ollama (the default), not Anthropic —
    // the withdraw row must still be there.
    const row = await screen.findByTestId('analysis-consent-status-anthropic');
    expect(row.textContent).toContain('Anthropic');

    await user.click(screen.getByTestId('analysis-consent-withdraw-anthropic'));

    await vi.waitFor(() => expect(consentPort.state().anthropic).toBe(false));
    expect(screen.queryByTestId('analysis-consent-status-anthropic')).toBeNull();
  });

  it('negative: withdrawing brings the gate back on the next cloud run', async () => {
    const consentPort = createFakeConsentPort({ anthropic: false, openai: true });
    const { user } = await renderReady(consentPort);

    await user.click(screen.getByTestId('analysis-consent-withdraw-openai'));
    await vi.waitFor(() => expect(consentPort.state().openai).toBe(false));

    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));

    expect(await screen.findByTestId('analysis-consent-gate')).toBeTruthy();
  });
});
