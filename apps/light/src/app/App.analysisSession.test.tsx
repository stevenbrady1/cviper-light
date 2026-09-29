// @vitest-environment jsdom
/**
 * L-187: an analysis survives a trip to another view.
 *
 * The shell mounts ONE view at a time, so leaving Analysis unmounts it. Before
 * this fix everything the user had typed, picked and been shown lived in that
 * component's own state and went with it — come back, and the advert box was
 * empty and the result was "Nothing checked yet". These tests drive the whole
 * shell the way the user did: run a check, click away, click back.
 *
 * `@tauri-apps/api/core` is mocked with Ollama running (one model) and no cloud
 * keys, and the provider is a fake transport, so the result carries a real
 * provider/model label without a socket.
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

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models.';

// Ends in a newline and two spaces on purpose: the box must come back with
// EXACTLY what was typed, not a trimmed approximation of it.
const ADVERT = 'Credit Risk Analyst. SQL and Python essential. IFRS 9 impairment.\n  ';

function cv(id: string, name: string): Cv {
  return {
    id,
    name,
    file_path: null,
    extracted_text: CV_TEXT,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };
}

function tags(...models: string[]): string {
  return JSON.stringify({
    models: models.map((model) => ({
      model,
      name: model,
      capabilities: ['completion'],
      details: { parameter_size: '3.2B' },
    })),
  });
}

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

const ANSWER: Result<ProviderHttpResponse, ProviderError> = ok({
  status: 200,
  body: JSON.stringify({ message: { role: 'assistant', content: REPLY } }),
});

/** What `ollama_probe` answers — changed by a test to model a daemon that moved on. */
let probe: string | null = tags('llama3.2:3b');

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  markWelcomeSeen();
  probe = tags('llama3.2:3b');
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return probe;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

/** A transport whose replies are held open until `settle` is called. */
function heldTransport() {
  let release: (value: Result<ProviderHttpResponse, ProviderError>) => void = () => undefined;
  const pending = new Promise<Result<ProviderHttpResponse, ProviderError>>((resolve) => {
    release = resolve;
  });
  const transport: ChatTransport = {
    chat: () => pending,
    listModels: () => Promise.resolve(ok({ status: 200, body: probe ?? '' })),
  };
  return { transport, settle: (value = ANSWER) => release(value) };
}

const answering: ChatTransport = {
  chat: () => Promise.resolve(ANSWER),
  listModels: () => Promise.resolve(ok({ status: 200, body: probe ?? '' })),
};

async function renderApp(transport: ChatTransport = answering, cvs = [cv('cv-1', 'CV.docx')]) {
  const analysisPort = createFakeAnalysisPort({ cvs });
  const erasePort = createFakeErasePort();
  const user = userEvent.setup();
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      analysisPort={analysisPort}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={erasePort}
      createTransport={() => transport}
      now={NOW}
    />,
  );
  await screen.findByTestId('shell');
  return { user, analysisPort, erasePort };
}

type User = ReturnType<typeof userEvent.setup>;

function provider(): HTMLSelectElement {
  return screen.getByTestId<HTMLSelectElement>('analysis-provider');
}

function advert(): HTMLTextAreaElement {
  return screen.getByTestId<HTMLTextAreaElement>('analysis-job-text');
}

/** Open Analysis and wait for the CV list and this machine's options to land. */
async function openAnalysis(user: User, expectedOption = 'ollama:llama3.2:3b') {
  await user.click(screen.getByTestId('nav-analysis'));
  await screen.findByTestId('view-analysis');
  await screen.findByDisplayValue('CV.docx');
  await vi.waitFor(() => expect(provider().value).toBe(expectedOption));
}

/** Type the advert, key by key as a user would, and press Run. */
async function runCheck(user: User) {
  await user.type(advert(), ADVERT);
  await user.click(screen.getByTestId('analysis-run'));
}

/** The trip the bug report describes: somewhere else, then back. */
async function leaveAndReturn(user: User, via: 'tracker' | 'search' = 'tracker') {
  await user.click(screen.getByTestId(`nav-${via}`));
  await screen.findByTestId(`view-${via}`);
  expect(screen.queryByTestId('view-analysis')).toBeNull();
  await user.click(screen.getByTestId('nav-analysis'));
  await screen.findByTestId('view-analysis');
}

describe('leaving Analysis and coming back (L-187)', () => {
  it('keeps the CV, the advert, the option and the result — with its model label', async () => {
    const { user, analysisPort } = await renderApp();
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-result');
    await vi.waitFor(() => expect(analysisPort.storedAnalyses()).toHaveLength(1));

    await leaveAndReturn(user);

    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Read by Ollama · llama3.2:3b',
    );
    expect(screen.getByTestId('band-scale-score').textContent).toBe('81');
    expect(screen.queryByTestId('analysis-empty')).toBeNull();
    expect(advert().value).toBe(ADVERT);
    expect(screen.getByTestId<HTMLSelectElement>('analysis-cv').value).toBe('cv-1');
    await vi.waitFor(() => expect(provider().value).toBe('ollama:llama3.2:3b'));
    // Coming back is not running it again.
    expect(analysisPort.storedAnalyses()).toHaveLength(1);
  });

  it('keeps an option the user picked, rather than resetting it to the default', async () => {
    const { user } = await renderApp();
    await openAnalysis(user);

    await user.selectOptions(provider(), 'keyword');
    await leaveAndReturn(user, 'search');

    // Wait for the options to be re-read — the default would be the model —
    // and only then check the pick held.
    await vi.waitFor(() =>
      expect([...provider().options].map((option) => option.value)).toContain('ollama:llama3.2:3b'),
    );
    expect(provider().value).toBe('keyword');
  });

  it('boundary: a remembered model that is no longer offered falls back to the default', async () => {
    const { user } = await renderApp();
    await openAnalysis(user);
    await user.selectOptions(provider(), 'ollama:llama3.2:3b');

    // Pulled a different model, removed the old one, while on another view.
    probe = tags('qwen2.5:7b');
    await leaveAndReturn(user);

    await vi.waitFor(() => expect(provider().value).toBe('ollama:qwen2.5:7b'));
    expect([...provider().options].map((option) => option.value)).not.toContain(
      'ollama:llama3.2:3b',
    );
  });

  it('boundary: nothing done yet comes back as the ordinary empty state', async () => {
    const { user } = await renderApp();
    await openAnalysis(user);

    await leaveAndReturn(user);

    expect(screen.getByTestId('analysis-empty')).toBeTruthy();
    expect(advert().value).toBe('');
    expect(screen.queryByTestId('analysis-error')).toBeNull();
  });

  it('negative: nothing typed or shown is written to browser storage', async () => {
    // A CV is personal data. Surviving a view switch must not mean surviving
    // on disk: the session is memory only.
    const { user } = await renderApp();
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-result');
    await leaveAndReturn(user);

    const stored = [localStorage, sessionStorage]
      .flatMap((storage) =>
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) ?? '';
          return `${key}=${storage.getItem(key) ?? ''}`;
        }),
      )
      .join('\n');
    expect(stored).not.toContain('Credit Risk Analyst');
    expect(stored).not.toContain('London banking');
    expect(stored).not.toContain('A close fit');
  });
});

describe('a check still running when the user leaves', () => {
  it('negative: a check that fails while the user is away says why when they return', async () => {
    // The component that started it is gone by the time it fails; a silent
    // "Nothing checked yet" on return would be a dead end with no explanation.
    const held = heldTransport();
    const { user } = await renderApp(held.transport);
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-progress');

    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('view-tracker');
    held.settle(
      err({
        provider: 'ollama' as const,
        kind: 'not-running' as const,
        message: 'Ollama is not running. Start it and try again.',
      }),
    );
    await user.click(screen.getByTestId('nav-analysis'));

    expect((await screen.findByTestId('analysis-error')).textContent).toBe(
      'Ollama is not running. Start it and try again.',
    );
    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(screen.getByTestId<HTMLButtonElement>('analysis-run').disabled).toBe(false);
  });

  it('lands its answer while the user is away, and it is there when they return', async () => {
    const held = heldTransport();
    const { user, analysisPort } = await renderApp(held.transport);
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-progress');

    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('view-tracker');
    held.settle();
    await vi.waitFor(() => expect(analysisPort.storedAnalyses()).toHaveLength(1));

    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByTestId('view-analysis');

    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Read by Ollama · llama3.2:3b',
    );
    expect(screen.queryByTestId('analysis-progress')).toBeNull();
    expect(screen.getByTestId('analysis-run').textContent).toContain('Check this CV');
  });

  it('is still shown as running on return, so it cannot be started twice', async () => {
    const held = heldTransport();
    const { user, analysisPort } = await renderApp(held.transport);
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-progress');

    await leaveAndReturn(user);

    expect(screen.getByTestId('analysis-run').textContent).toContain('Checking');
    expect(screen.getByTestId<HTMLButtonElement>('analysis-run').disabled).toBe(true);

    held.settle();
    await screen.findByTestId('analysis-result');
    expect(screen.getByTestId<HTMLButtonElement>('analysis-run').disabled).toBe(false);
    expect(analysisPort.storedAnalyses()).toHaveLength(1);
  });

  it('negative: picking another CV mid-run drops the old answer rather than showing it', async () => {
    const held = heldTransport();
    const { user, analysisPort } = await renderApp(held.transport, [
      cv('cv-1', 'CV.docx'),
      cv('cv-2', 'Other CV.docx'),
    ]);
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-progress');

    await user.selectOptions(screen.getByTestId('analysis-cv'), 'cv-2');
    held.settle();
    // Give the late answer every chance to (wrongly) land.
    await vi.waitFor(() => expect(screen.queryByTestId('analysis-progress')).toBeNull());
    await Promise.resolve();

    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(screen.getByTestId('analysis-empty')).toBeTruthy();
    expect(analysisPort.storedAnalyses()).toEqual([]);
  });
});

describe('Delete everything', () => {
  async function eraseEverything(user: User) {
    await user.click(screen.getByTestId('nav-settings'));
    await user.click(await screen.findByTestId('settings-erase'));
    await user.click(await screen.findByTestId('settings-erase-confirm'));
    // Back to the first run: the introduction, which the user skips.
    await user.click(await screen.findByTestId('welcome-skip'));
    await screen.findByTestId('shell');
  }

  it('negative: forgets the last analysis — advert, result and all', async () => {
    const { user, erasePort } = await renderApp();
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-result');

    await eraseEverything(user);
    expect(erasePort.calls).toContain('database');
    await openAnalysis(user);

    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(screen.getByTestId('analysis-empty')).toBeTruthy();
    expect(advert().value).toBe('');
  });

  it('negative: a check still running when everything is deleted is dropped, not saved', async () => {
    const held = heldTransport();
    const { user, analysisPort } = await renderApp(held.transport);
    await openAnalysis(user);
    await runCheck(user);
    await screen.findByTestId('analysis-progress');

    await eraseEverything(user);
    held.settle();
    await openAnalysis(user);
    await Promise.resolve();

    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(screen.queryByTestId('analysis-progress')).toBeNull();
    // Writing it now would put a row back into a database the user just emptied.
    expect(analysisPort.storedAnalyses()).toEqual([]);
  });
});
