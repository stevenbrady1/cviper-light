// @vitest-environment jsdom
/**
 * L-348 — a bare link in the Analysis advert box never reaches a model.
 *
 * Same rig as the tracker's `urlOnlyPasteGuard.test.tsx`: the assertion that
 * matters is how many chat transports were BUILT, and the guard's claim is that
 * the count stays at zero. A message on screen alone proves nothing — a build
 * that showed it AND still called the model would pass.
 *
 * And the counter is proved to work: the happy-path test drives a real advert
 * through the same rig and the count reaches one. Without that, every zero
 * below could be a broken counter.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport, type ProviderHttpResponse } from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Analysis } = await import('./Analysis');
const { runAnalysis } = await import('./runAnalysis');
const { KEYWORD_KEY } = await import('./providers');
const { URL_ONLY_RUN_REASON } = await import('../tracker/pastedUrl');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models.';

const ADVERT =
  'Credit Risk Analyst. You will build SQL models and report on IFRS 9 impairment. ' +
  'Python experience essential.';

const LINK = 'https://jobs.example.com/advert/credit-risk-analyst';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

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

/** A transport factory that counts how many transports, and chats, it made. */
function counting() {
  const count = { built: 0, chats: 0 };
  const createTransport = (): ChatTransport => {
    count.built += 1;
    return {
      chat: () => {
        count.chats += 1;
        return Promise.resolve(ok(ollamaEnvelope(REPLY)));
      },
      listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
    };
  };
  return { count, createTransport };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderReady(createTransport: () => ChatTransport) {
  const user = userEvent.setup();
  render(
    <Analysis
      port={createFakeAnalysisPort({ cvs: [CV] })}
      filePort={createFakeFilePort()}
      createTransport={createTransport}
      now={NOW}
    />,
  );
  await screen.findByDisplayValue('CV.docx');
  await vi.waitFor(() =>
    expect((screen.getByTestId('analysis-provider') as HTMLSelectElement).value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return { user };
}

async function pasteAdvert(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByTestId('analysis-job-text'));
  await user.paste(text);
}

describe('Analysis: a bare link instead of the advert (L-348)', () => {
  it('happy: a real advert still runs, and the counter reaches 1', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, ADVERT);
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', false);
    await user.click(screen.getByTestId('analysis-run'));

    await screen.findByTestId('analysis-result');
    expect(count.built).toBe(1);
    expect(count.chats).toBeGreaterThanOrEqual(1);
  });

  it('negative: a bare https link shows the reason, disables the button, builds 0 transports', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, LINK);

    const run = screen.getByTestId('analysis-run');
    expect(run).toHaveProperty('disabled', true);
    expect(screen.getByTestId('analysis-run-reason').textContent).toBe(URL_ONLY_RUN_REASON);
    await user.click(run);
    expect(count.built).toBe(0);
    expect(count.chats).toBe(0);
  });

  it('boundary: a short link gets the link reason, not "paste more"', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await pasteAdvert(user, 'https://a.co/x');

    expect(screen.getByTestId('analysis-run-reason').textContent).toBe(URL_ONLY_RUN_REASON);
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
    expect(count.built).toBe(0);
  });

  it('edge: the basic match (no AI) is guarded too', async () => {
    const { count, createTransport } = counting();
    const { user } = await renderReady(createTransport);

    await user.selectOptions(screen.getByTestId('analysis-provider'), KEYWORD_KEY);
    await pasteAdvert(user, LINK);

    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('analysis-run-reason').textContent).toBe(URL_ONLY_RUN_REASON);
    expect(count.built).toBe(0);
  });
});

describe('runAnalysis: the backstop when called directly (L-348)', () => {
  const OLLAMA = {
    key: 'ollama:llama3.2:3b',
    kind: 'ollama',
    label: 'Ollama · llama3.2:3b',
    note: '',
    model: 'llama3.2:3b',
    local: true,
    needsKey: false,
  } as const;

  it('negative: a link returns the link error and builds 0 transports', async () => {
    const { count, createTransport } = counting();
    const result = await runAnalysis(
      { option: OLLAMA, cvText: CV_TEXT, jobText: LINK },
      createTransport,
    );
    expect(result).toEqual({ ok: false, error: { message: URL_ONLY_RUN_REASON } });
    expect(count.built).toBe(0);
  });

  it('negative: a cloud option is refused before consent is even asked', async () => {
    const { count, createTransport } = counting();
    const hasConsent = vi.fn(() => Promise.resolve(true));
    const result = await runAnalysis(
      {
        option: {
          ...OLLAMA,
          key: 'anthropic',
          kind: 'anthropic',
          model: 'claude',
          local: false,
          needsKey: true,
        },
        cvText: CV_TEXT,
        jobText: ` ${LINK}\n`,
      },
      createTransport,
      hasConsent,
    );
    expect(result).toEqual({ ok: false, error: { message: URL_ONLY_RUN_REASON } });
    expect(hasConsent).not.toHaveBeenCalled();
    expect(count.built).toBe(0);
  });

  it('edge: the keyword option returns the link error, not a score of the address', async () => {
    const { count, createTransport } = counting();
    const result = await runAnalysis(
      {
        option: { ...OLLAMA, key: KEYWORD_KEY, kind: 'keyword', model: null },
        cvText: CV_TEXT,
        jobText: LINK,
      },
      createTransport,
    );
    expect(result).toEqual({ ok: false, error: { message: URL_ONLY_RUN_REASON } });
    expect(count.built).toBe(0);
  });

  it('happy: a real advert on the same call builds exactly 1 transport', async () => {
    const { count, createTransport } = counting();
    const result = await runAnalysis(
      { option: OLLAMA, cvText: CV_TEXT, jobText: ADVERT },
      createTransport,
    );
    expect(result.ok).toBe(true);
    expect(count.built).toBe(1);
  });
});
