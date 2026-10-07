// @vitest-environment jsdom
/**
 * L-200 through the whole shell: one job's step bar, followed from the
 * tracker through Analysis and Tailor and back, with the shell moving the
 * user for every step that lives on another screen — and nothing on the bar
 * ever running a check or a model. Also at phone width, and with no job.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';
import { type JobProviderId } from '@cviper/job-apis';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { WIDE_QUERY } = await import('./viewport');

import type { TrackerEntry } from '../features/tracker/model';

const BOTH_KEYS: Record<JobProviderId, 'configured'> = { adzuna: 'configured', reed: 'configured' };

const CVS: Cv[] = [
  {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text:
      'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
      'stress testing, IFRS 9 impairment models, stakeholder reporting.',
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  },
];

const TRACKED: TrackerEntry = {
  job: {
    id: 'job-tracked',
    source: 'manual',
    external_id: null,
    title: 'Market Risk Analyst',
    company: 'Barclays',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: 'SQL and Python for market risk reporting. IFRS 9 a plus.',
    url: null,
    posted_date: null,
    created_at: '2026-09-01T09:00:00.000Z',
  },
  application: {
    id: 'app-tracked',
    job_id: 'job-tracked',
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: '2026-09-29T09:00:00.000Z',
  },
};

let chats = 0;
const chat: ChatTransport = {
  chat: () => {
    chats += 1;
    return Promise.reject(new Error('the step bar must never call a model'));
  },
  listModels: () => Promise.resolve(ok({ status: 200, body: JSON.stringify({ models: [] }) })),
};

beforeEach(() => {
  chats = 0;
  localStorage.clear();
  sessionStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

function installMatchMedia(widthPx: number) {
  const list = {
    matches: widthPx >= 768,
    media: WIDE_QUERY,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => list,
  });
}

async function renderApp(saved: Record<string, { analysed?: boolean; exported?: boolean }> = {}) {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort([TRACKED])}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs: CVS, jobs: [TRACKED.job] })}
      tailorPort={createFakeTailorPort({
        cvs: CVS,
        jobs: [TRACKED.job],
        applications: [TRACKED.application],
      })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      createTransport={() => chat}
      workflowPort={null}
      boardProgressPort={{
        loadAll: async () =>
          new Map(
            Object.entries(saved).map(([jobId, progress]) => [
              jobId,
              { analysed: false, exported: false, ...progress },
            ]),
          ),
      }}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

type User = ReturnType<typeof userEvent.setup>;

const current = () =>
  document.querySelector('[aria-current="step"]')?.getAttribute('data-testid') ?? null;

async function analyseTrackedJob(user: User) {
  await user.click(screen.getByTestId('nav-tracker'));
  await user.click(await screen.findByTestId('tracker-card-app-tracked'));
  await user.click(await screen.findByTestId('detail-analyse'));
  await screen.findByTestId('view-analysis');
  await screen.findByTestId('job-steps');
}

describe('one job, step by step (L-200)', () => {
  it('happy: Tracker → Analyse → Next → Tailor → back to Analyse → Export, and never a model call', async () => {
    const { user } = await renderApp();
    await analyseTrackedJob(user);
    expect(current()).toBe('job-step-analyse');
    expect(screen.getByTestId('job-steps-job').textContent).toContain('Market Risk Analyst');

    await user.click(screen.getByTestId('job-steps-next'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked'),
    );
    expect(current()).toBe('job-step-tailor');

    await user.click(screen.getByTestId('job-step-analyse'));
    await screen.findByTestId('view-analysis');
    expect(screen.getByTestId<HTMLTextAreaElement>('analysis-job-text').value).toContain(
      'market risk reporting',
    );
    expect(current()).toBe('job-step-analyse');

    await user.click(screen.getByTestId('job-step-export'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() => expect(current()).toBe('job-step-export'));

    expect(chats).toBe(0);
    expect(screen.queryByTestId('analysis-result')).toBeNull();
  });

  it('"◀ Tracker" and Find go where they say', async () => {
    const { user } = await renderApp();
    await analyseTrackedJob(user);

    await user.click(screen.getByTestId('job-step-find'));
    await screen.findByTestId('view-search');

    await analyseTrackedJob(user);
    await user.click(screen.getByTestId('job-steps-tracker'));
    await screen.findByTestId('view-tracker');
  });

  it('negative: with no job chosen, neither Analysis nor Tailor shows a bar', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByTestId('view-analysis');
    expect(screen.queryByTestId('job-steps')).toBeNull();

    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByTestId('view-tailor');
    expect(screen.queryByTestId('job-steps')).toBeNull();
  });

  it('the sidebar is not the bar: opening Tailor from it starts on the Tailor step', async () => {
    const { user } = await renderApp();
    await analyseTrackedJob(user);
    await user.click(screen.getByTestId('job-step-export'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() => expect(current()).toBe('job-step-export'));

    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() => expect(current()).toBe('job-step-tailor'));
  });
});

describe('at phone width (375px)', () => {
  it('the bar is there and Next still moves the user, with the bottom bar following', async () => {
    installMatchMedia(375);
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-app-tracked'));
    await user.click(await screen.findByTestId('detail-analyse'));
    await screen.findByTestId('view-analysis');

    await user.click(await screen.findByTestId('job-steps-next'));
    await screen.findByTestId('view-tailor');
    expect(current()).toBe('job-step-tailor');
    expect(screen.getByTestId('nav-tailor').getAttribute('aria-current')).toBe('page');
  });
});

describe('Continue on a tracker card (L-200)', () => {
  it('happy: an analysed job’s card continues straight to Tailor, with the job chosen', async () => {
    const { user } = await renderApp({ 'job-tracked': { analysed: true } });
    await user.click(screen.getByTestId('nav-tracker'));

    const row = await screen.findByTestId('tracker-card-progress-app-tracked');
    expect(row.textContent).toContain('●●○○○');
    await user.click(screen.getByTestId('tracker-card-continue-app-tracked'));

    await screen.findByTestId('view-tailor');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-tracked'),
    );
    expect(current()).toBe('job-step-tailor');
    expect(chats).toBe(0);
  });

  it('negative: a job nothing has happened to has no Continue on its card', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('nav-tracker'));
    await screen.findByTestId('tracker-card-app-tracked');
    expect(screen.queryByTestId('tracker-card-continue-app-tracked')).toBeNull();
  });
});
