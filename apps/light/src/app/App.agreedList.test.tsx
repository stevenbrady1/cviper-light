// @vitest-environment jsdom
/**
 * "What I have agreed to" in Settings tells the truth across screens (L-410).
 *
 * Three screens draw the same consent rows from the same file: Analysis and
 * Tailor, where a consent is given, and Settings. Each reads the file as it is
 * shown, so none can be left holding an old answer:
 *
 *   - agree on Analysis  → Settings lists it the next time it is shown;
 *   - withdraw in Settings → Analysis and Tailor no longer show it, and the
 *     next run is stopped at the consent question again.
 *
 * The REAL consent port runs here, over a stand-in for the file, so what is
 * asserted is what is on "disk" — not what a screen happens to remember.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const plugin = vi.hoisted(() => {
  /** What is "on disk", keyed by store file. Survives a `load`, like a file. */
  const disk = new Map<string, Map<string, unknown>>();

  function load(path: string) {
    const contents = disk.get(path) ?? new Map<string, unknown>();
    disk.set(path, contents);
    return Promise.resolve({
      get: (key: string) => Promise.resolve(contents.get(key)),
      set: (key: string, value: unknown) => {
        // Through JSON, as the real plugin writes the file.
        contents.set(key, JSON.parse(JSON.stringify(value)));
        return Promise.resolve();
      },
      save: () => Promise.resolve(),
    });
  }

  return { disk, load };
});

vi.mock('@tauri-apps/plugin-store', () => ({ load: plugin.load }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { CONSENT_STORE_FILE, CONSENT_STORE_KEY } = await import('../features/analysis/consent');

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const ADVERT =
  'Credit Risk Analyst. You will build SQL models and report on IFRS 9 impairment. ' +
  'Python experience essential.';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text:
    'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
    'stress testing, IFRS 9 impairment models, stakeholder reporting.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

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

function fakeTransport(): ChatTransport {
  return {
    chat: () =>
      Promise.resolve(
        ok({ status: 200, body: JSON.stringify({ choices: [{ message: { content: REPLY } }] }) }),
      ),
    listModels: () => Promise.resolve(ok({ status: 200, body: JSON.stringify({ models: [] }) })),
  };
}

/** What the consent file holds right now. */
function onDisk(): unknown {
  return plugin.disk.get(CONSENT_STORE_FILE)?.get(CONSENT_STORE_KEY);
}

/** Put a consent in the file, as an earlier session left it. */
function agreedBefore(...kinds: string[]): void {
  plugin.disk.set(
    CONSENT_STORE_FILE,
    new Map([[CONSENT_STORE_KEY, Object.fromEntries(kinds.map((kind) => [kind, true]))]]),
  );
}

beforeEach(() => {
  localStorage.clear();
  markWelcomeSeen();
  plugin.disk.clear();
  tauri.invoke.mockReset();
  // No Ollama; every cloud key saved, so Analysis offers OpenAI.
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return true;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  const user = userEvent.setup();
  render(
    <App
      trackerPort={createFakeTrackerPort()}
      profilePort={createFakeProfilePort()}
      tailorPort={createFakeTailorPort()}
      analysisPort={createFakeAnalysisPort({ cvs: [CV] })}
      filePort={createFakeFilePort()}
      createTransport={fakeTransport}
      now={NOW}
    />,
  );
  return user;
}

async function agreedSection() {
  return within(await screen.findByTestId('settings-agreed'));
}

describe('agreeing on Analysis reaches Settings without a restart', () => {
  it('happy: Settings says "Nothing yet", then lists OpenAI once it is agreed to on Analysis', async () => {
    const user = renderApp();

    await user.click(screen.getByTestId('nav-settings'));
    expect(await (await agreedSection()).findByTestId('settings-agreed-empty')).toBeTruthy();

    // Agree the way a person does: run a check with OpenAI and say yes.
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));
    await user.click(await screen.findByTestId('analysis-consent-accept'));
    await vi.waitFor(() => expect(onDisk()).toMatchObject({ openai: true }));

    await user.click(screen.getByTestId('nav-settings'));
    const section = await agreedSection();
    const row = await section.findByTestId('analysis-consent-status-openai');
    expect(row.textContent).toContain(
      'OpenAI can receive your CV and the adverts you check it against.',
    );
    expect(section.queryByTestId('settings-agreed-empty')).toBeNull();
    expect(section.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('withdrawing in Settings reaches Analysis and Tailor without a restart', () => {
  it('happy: the row is on all three screens, and gone from all three after Withdraw in Settings', async () => {
    agreedBefore('openai', 'google');
    const user = renderApp();

    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByTestId('analysis-consent-status-google');
    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByTestId('analysis-consent-status-google');

    await user.click(screen.getByTestId('nav-settings'));
    const section = await agreedSection();
    await user.click(await section.findByTestId('analysis-consent-withdraw-google'));

    // On "disk", not just on screen. OpenAI's consent is untouched.
    await vi.waitFor(() => expect(onDisk()).toMatchObject({ google: false, openai: true }));
    await vi.waitFor(() =>
      expect(section.queryByTestId('analysis-consent-status-google')).toBeNull(),
    );
    expect(section.getByTestId('analysis-consent-status-openai')).toBeTruthy();

    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByTestId('analysis-consent-status-openai');
    expect(screen.queryByTestId('analysis-consent-status-google')).toBeNull();

    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByTestId('analysis-consent-status-openai');
    expect(screen.queryByTestId('analysis-consent-status-google')).toBeNull();
  });

  it('edge: a consent withdrawn in Settings is asked for again by the next run on Analysis', async () => {
    agreedBefore('openai');
    const user = renderApp();

    await user.click(screen.getByTestId('nav-settings'));
    const section = await agreedSection();
    await user.click(await section.findByTestId('analysis-consent-withdraw-openai'));
    await vi.waitFor(() => expect(onDisk()).toMatchObject({ openai: false }));
    expect(await section.findByTestId('settings-agreed-empty')).toBeTruthy();

    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.selectOptions(screen.getByTestId('analysis-provider'), 'openai');
    await user.click(screen.getByTestId('analysis-run'));

    // Stopped at the question: nothing was sent on the strength of the old yes.
    expect(await screen.findByTestId('analysis-consent-gate')).toBeTruthy();
    expect(screen.queryByTestId('analysis-result')).toBeNull();
  });

  it('negative: withdrawing on Analysis is gone from Settings too', async () => {
    agreedBefore('mistral');
    const user = renderApp();

    await user.click(screen.getByTestId('nav-analysis'));
    await user.click(await screen.findByTestId('analysis-consent-withdraw-mistral'));
    await vi.waitFor(() => expect(onDisk()).toMatchObject({ mistral: false }));

    await user.click(screen.getByTestId('nav-settings'));
    const section = await agreedSection();
    expect(await section.findByTestId('settings-agreed-empty')).toBeTruthy();
    expect(section.queryByTestId('analysis-consent-status-mistral')).toBeNull();
  });
});
