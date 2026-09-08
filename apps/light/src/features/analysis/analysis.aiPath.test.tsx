// @vitest-environment jsdom
/**
 * The AI path: what the screen does while a model is thinking, and what it says
 * about the answer afterwards.
 *
 * ============================================================================
 * THIRTY SECONDS OF SILENCE READS AS A CRASH.
 * ============================================================================
 * A local model that is not already resident loads several gigabytes into
 * memory before it emits a single token — 5 to 30 seconds on a normal machine,
 * longer on a laptop. That wait is unavoidable and it is not a bug. What WOULD
 * be a bug is a still screen for half a minute, because the user cannot tell it
 * from a hang, and their next action is to close the app.
 *
 * So the wait is asserted here, in flight, with the transport deliberately held
 * open.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Analysis } = await import('./Analysis');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models.';

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

/** A daemon with one chat model pulled. */
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

function ollamaEnvelope(content: string): ProviderHttpResponse {
  return { status: 200, body: JSON.stringify({ message: { role: 'assistant', content } }) };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // Ollama running, no cloud keys — the setup a privacy-minded user has.
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

/** A transport whose one reply is held open until `settle` is called. */
function heldTransport(): {
  transport: ChatTransport;
  settle: (response: Result<ProviderHttpResponse, ProviderError>) => void;
} {
  let release: (value: Result<ProviderHttpResponse, ProviderError>) => void = () => undefined;
  const pending = new Promise<Result<ProviderHttpResponse, ProviderError>>((resolve) => {
    release = resolve;
  });

  return {
    transport: {
      chat: () => pending,
      listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
    },
    settle: (response) => release(response),
  };
}

async function renderReady(createTransport: () => ChatTransport) {
  const port = createFakeAnalysisPort({ cvs: [CV] });
  const user = userEvent.setup();

  render(
    <Analysis
      port={port}
      filePort={createFakeFilePort()}
      createTransport={createTransport}
      now={NOW}
    />,
  );

  await screen.findByDisplayValue('CV.docx');
  // The picker starts on the local model — better than the word list, free, and
  // private — so nothing has to be selected first.
  await vi.waitFor(() =>
    expect((screen.getByTestId('analysis-provider') as HTMLSelectElement).value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  await user.type(screen.getByTestId('analysis-job-text'), ADVERT);

  return { port, user };
}

describe('while a local model is thinking', () => {
  it('says what is happening, why it is slow, and that nothing is leaving', async () => {
    const held = heldTransport();
    const { user } = await renderReady(() => held.transport);

    await user.click(screen.getByTestId('analysis-run'));

    const progress = await screen.findByTestId('analysis-progress');
    expect(progress.textContent).toContain('llama3.2:3b');
    expect(progress.textContent).toContain('5 to 30 seconds');
    expect(progress.textContent).toContain('Nothing is being sent anywhere');
    // Announced, not just painted: a status region so a screen reader hears it.
    expect(progress.getAttribute('role')).toBe('status');

    // And the button says so too, rather than looking pressable again.
    expect(screen.getByTestId('analysis-run').textContent).toContain('Checking');
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('analysis-run-reason').textContent).toContain('Already running');

    held.settle(ok(ollamaEnvelope(REPLY)));
    await screen.findByTestId('analysis-result');
  });

  it('clears the wait once the answer arrives', async () => {
    const held = heldTransport();
    const { user } = await renderReady(() => held.transport);

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-progress');

    held.settle(ok(ollamaEnvelope(REPLY)));
    await screen.findByTestId('analysis-result');

    expect(screen.queryByTestId('analysis-progress')).toBeNull();
  });
});

describe('the answer', () => {
  it('is labelled with the model that produced it, never as a basic match', async () => {
    const { user, port } = await renderReady(
      () =>
        ({
          chat: () => Promise.resolve(ok(ollamaEnvelope(REPLY))),
          listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
        }) satisfies ChatTransport,
    );

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Read by Ollama · llama3.2:3b',
    );
    expect(screen.getByTestId('band-scale-score').textContent).toBe('81');

    // 81 is strong. The model said "possible" in the same breath; the derived
    // verdict is what reaches the screen, so the two can never contradict.
    expect(screen.getByTestId('analysis-verdict').textContent).toBe('Strong match');

    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.provider).toBe('ollama');
    expect(port.storedAnalyses()[0]?.model).toBe('llama3.2:3b');
  });

  it('negative: a stopped daemon is reported in the words Rust wrote for it', async () => {
    const { user, port } = await renderReady(
      () =>
        ({
          chat: () =>
            Promise.resolve(
              err({
                provider: 'ollama' as const,
                kind: 'not-running' as const,
                message: 'Ollama is not running. Start it and try again.',
              }),
            ),
          listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
        }) satisfies ChatTransport,
    );

    await user.click(screen.getByTestId('analysis-run'));

    expect((await screen.findByTestId('analysis-error')).textContent).toBe(
      'Ollama is not running. Start it and try again.',
    );
    // Nothing half-finished is shown or stored.
    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(port.storedAnalyses()).toEqual([]);
    // And the button is pressable again, so the user can retry after starting it.
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', false);
  });
});

describe('the basic match is still there', () => {
  it('is offered alongside the model, and can still be chosen', async () => {
    const createTransport = vi.fn();
    const { user, port } = await renderReady(createTransport as () => ChatTransport);

    const picker = screen.getByTestId('analysis-provider') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual([
      'keyword',
      'ollama:llama3.2:3b',
    ]);

    await user.selectOptions(picker, 'keyword');
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    // Chosen deliberately on a machine that HAS a model: the label must not
    // tell this user to add a key they do not need.
    const provenance = screen.getByTestId('analysis-provenance').textContent ?? '';
    expect(provenance).toContain('Basic match');
    expect(provenance).not.toContain('add an AI key');

    expect(createTransport).not.toHaveBeenCalled();
    expect(port.storedAnalyses()[0]?.provider).toBe('keyword');
  });
});
