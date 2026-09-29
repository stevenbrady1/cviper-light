// @vitest-environment jsdom
/**
 * L-190: one flow — Find Job → Analyse → Tailor CV — with the job carried
 * across, driven through the whole shell the way a user drives it.
 *
 * ============================================================================
 * ONE PRETEND DATABASE UNDER FOUR SCREENS
 * ============================================================================
 * The fake ports do not share storage: each was built to test one screen. A
 * flow test that seeded them separately would prove each screen shows what it
 * was seeded with, not that a job saved on one screen is the job the next one
 * finds. So the ports below are the ordinary fakes with their JOB reads
 * pointed at one store — the search fake's saved adverts, and the applications
 * its saves created — and the assertions follow one job id from the search
 * result to the tailor screen's save target.
 *
 * `@tauri-apps/api/core` is mocked with Ollama running (two models) and no
 * cloud keys, so the option picked on Analysis is distinguishable from the
 * Tailor screen's own default.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Application, type Cv, type Job, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';
import { emptyQuota, type JobProviderId } from '@cviper/job-apis';

import type { SearchPort } from '../features/search/port';
import type { TailorPort } from '../features/tailor/port';
import type { TrackerEntry } from '../features/tracker/model';
import type { PageFetchTransport } from '../features/tracker/pageFetch';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { default: App } = await import('./App');
const { WIDE_QUERY } = await import('./viewport');
const { markWelcomeSeen } = await import('../features/onboarding/store');
const { createFakeTrackerPort } = await import('../features/tracker/test/fakePort');
const { createFakeProfilePort } = await import('../features/profile/test/fakePort');
const { createFakeAnalysisPort } = await import('../features/analysis/test/fakePort');
const { createFakeTailorPort } = await import('../features/tailor/test/fakePort');
const { createFakeSearchPort, outcomeOf } = await import('../features/search/test/fakeSearchPort');
const { createFakeBoardPort } = await import('../features/boards/test/fakeBoardPort');
const { createFakeBackupPort } = await import('../features/settings/test/fakePort');
const { createFakeErasePort } = await import('../features/settings/erase/test/fakeErasePort');
const { createFakeFilePort } = await import('../platform/test/fakeFilePort');
const { createFakeOpenedCvPort } = await import('../platform/test/fakeOpenedCvPort');
const { createFakeBrowserPort } = await import('../platform/test/fakeBrowserPort');
const { PREVIEW_SITE_BLOCKS_NOTE } = await import('../features/flow/advert');

const NOW = new Date('2026-09-29T09:00:00.000Z');
const TODAY = '2026-09-29';
const BOTH_KEYS: Record<JobProviderId, 'configured'> = { adzuna: 'configured', reed: 'configured' };

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models.';

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

const CVS = [cv('cv-1', 'CV.docx'), cv('cv-2', 'Banking CV.docx')];

const PREVIEW = 'We are looking for a credit risk analyst to join a London team…';

/** A Reed search result: a preview, as Reed's search API sends it. */
const RESULT_JOB: Job = {
  id: 'search-copy',
  source: 'reed',
  external_id: '99900001',
  title: 'Credit Risk Contractor',
  company: 'Lloyds',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: PREVIEW,
  url: 'https://www.reed.co.uk/jobs/99900001',
  posted_date: '2026-09-20',
  created_at: NOW.toISOString(),
};

const FULL_TEXT =
  'You will sit in second-line credit risk for the wholesale book, reviewing limit ' +
  'applications from the corporate and institutional coverage teams and challenging the ' +
  'assumptions behind them. SQL and Python are essential, with IFRS 9 impairment modelling. ' +
  'Study support for ACCA or CFA is available, and the team sits three days a week in the ' +
  'City office with the rest of the week worked from home. '.repeat(2);

function tags(...models: string[]): string {
  return JSON.stringify({
    models: models.map((model) => ({
      model,
      name: model,
      capabilities: ['completion'],
      details: { parameter_size: '3B' },
    })),
  });
}

const TAGS = tags('llama3.2:3b', 'qwen2.5:7b');

const REPLY = JSON.stringify({
  matched_skills: ['sql', 'python'],
  missing_skills: [],
  matched_keywords: ['risk'],
  keyword_gaps: [],
  ats_notes: [],
  suggestions: [],
  summary: 'A close fit.',
  match_score: 81,
  verdict: 'possible',
});

const ANSWER: Result<ProviderHttpResponse, ProviderError> = ok({
  status: 200,
  body: JSON.stringify({ message: { role: 'assistant', content: REPLY } }),
});

const answering: ChatTransport = {
  chat: () => Promise.resolve(ANSWER),
  listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
};

function pages(status: number, body = ''): () => PageFetchTransport {
  return () => ({ fetchPage: () => Promise.resolve(ok({ status, body })) });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  markWelcomeSeen();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  cleanup();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/**
 * The four ports over one store. Saving from Search is what puts a job — and
 * its application — where Analysis and Tailor look for them.
 */
function world(options: { page: () => PageFetchTransport; tracker?: readonly TrackerEntry[] }) {
  const search = createFakeSearchPort([], undefined, options.page);
  search.nextOutcome(outcomeOf([{ job: RESULT_JOB, contractType: 'Contract' }], emptyQuota(TODAY)));
  const applications: Application[] = [
    ...(options.tracker ?? []).map((entry) => entry.application),
  ];
  const trackerJobs = (options.tracker ?? []).map((entry) => entry.job);
  const jobs = (): Job[] => [...search.savedJobs(), ...trackerJobs];

  const searchPort: SearchPort = {
    ...search,
    async saveToTracker(job, ids, now) {
      const saved = await search.saveToTracker(job, ids, now);
      if (saved.ok && saved.value.outcome === 'saved') {
        applications.push({
          id: ids.applicationId,
          job_id: saved.value.job.id,
          status: 'saved',
          applied_date: null,
          notes: null,
          next_action: null,
          next_action_date: null,
          updated_at: now,
        });
      }
      return saved;
    },
  };

  const analysis = createFakeAnalysisPort({ cvs: CVS });
  const analysisPort = { ...analysis, loadJobs: async () => ok(jobs()) };

  const tailor = createFakeTailorPort({ cvs: CVS });
  const tailorPort: TailorPort & { storedDocuments: typeof tailor.storedDocuments } = {
    ...tailor,
    loadJobs: async () => ok(jobs()),
    loadApplicationsFor: async (jobId: string) =>
      ok(applications.filter((application) => application.job_id === jobId)),
  };

  return { search, searchPort, analysis, analysisPort, tailorPort, applications };
}

type World = ReturnType<typeof world>;

async function renderApp(
  w: World,
  extra: { tracker?: readonly TrackerEntry[]; tailorPort?: TailorPort } = {},
) {
  const erasePort = createFakeErasePort();
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort(extra.tracker ?? [])}
      profilePort={createFakeProfilePort()}
      analysisPort={w.analysisPort}
      tailorPort={extra.tailorPort ?? w.tailorPort}
      searchPort={w.searchPort}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={erasePort}
      createTransport={() => answering}
      newId={() => `generated-${(counter += 1)}`}
      now={NOW}
    />,
  );
  await screen.findByTestId('shell');
  return { user, erasePort };
}

type User = ReturnType<typeof userEvent.setup>;

const select = (id: string) => screen.getByTestId<HTMLSelectElement>(id);
const text = (id: string) => screen.getByTestId<HTMLTextAreaElement>(id);

/** Search, and press "Analyse this job" on the one result. */
async function analyseFromSearch(user: User) {
  await user.click(screen.getByTestId('nav-search'));
  await screen.findByTestId('search-empty');
  await user.type(screen.getByTestId('search-keywords'), 'credit risk');
  await user.click(screen.getByTestId('search-submit'));
  await user.click(await screen.findByTestId('result-analyse-search-copy'));
  await screen.findByTestId('view-analysis');
  // Whichever CV is selected — the CV list has been read once one is.
  await vi.waitFor(() => expect(select('analysis-cv').value).not.toBe(''));
}

async function eraseEverything(user: User) {
  await user.click(screen.getByTestId('nav-settings'));
  await user.click(await screen.findByTestId('settings-erase'));
  await user.click(await screen.findByTestId('settings-erase-confirm'));
  await user.click(await screen.findByTestId('welcome-skip'));
  await screen.findByTestId('shell');
}

describe('Search → Analyse → Tailor, one job all the way', () => {
  it('lands on Analysis with the advert, the CV and the note, then on Tailor with the same job, CV and option', async () => {
    const w = world({ page: pages(403) });
    const { user } = await renderApp(w);

    // Pick a CV and an option first, so "kept" is distinguishable from "default".
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');
    await user.selectOptions(select('analysis-cv'), 'cv-2');
    await vi.waitFor(() => expect(select('analysis-provider').value).toBe('ollama:llama3.2:3b'));
    await user.selectOptions(select('analysis-provider'), 'ollama:qwen2.5:7b');

    await analyseFromSearch(user);

    // ── On Analysis ─────────────────────────────────────────────────────
    expect(text('analysis-job-text').value).toContain('Credit Risk Contractor');
    expect(text('analysis-job-text').value).toContain(PREVIEW);
    expect(screen.getByTestId('analysis-job-note').textContent).toBe(PREVIEW_SITE_BLOCKS_NOTE);
    expect(select('analysis-cv').value).toBe('cv-2');
    await vi.waitFor(() => expect(select('analysis-provider').value).toBe('ollama:qwen2.5:7b'));
    // Saved to the tracker, once, under the search's id (it was new).
    expect(w.search.savedJobs().map((job) => job.id)).toEqual(['search-copy']);
    expect(w.applications.map((application) => application.job_id)).toEqual(['search-copy']);

    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');
    await vi.waitFor(() => expect(w.analysis.storedAnalyses()).toHaveLength(1));
    expect(w.analysis.storedAnalyses()[0]?.job_id).toBe('search-copy');

    // ── On to Tailor ────────────────────────────────────────────────────
    await user.click(screen.getByTestId('analysis-to-tailor'));
    await screen.findByTestId('view-tailor');

    await vi.waitFor(() => expect(select('tailor-job-pick').value).toBe('search-copy'));
    expect(select('tailor-cv-pick').value).toBe('cv-2');
    expect(select('tailor-provider').value).toBe('ollama:qwen2.5:7b');
    expect(text('tailor-job-text').value).toContain(PREVIEW);
  });

  it('a readable page replaces the preview everywhere, with no note', async () => {
    const page = `<html><body><main><h1>Credit Risk Contractor</h1><p>${FULL_TEXT}</p></main></body></html>`;
    const w = world({ page: pages(200, page) });
    const { user } = await renderApp(w);

    await analyseFromSearch(user);

    expect(text('analysis-job-text').value).toContain('second-line credit risk');
    expect(screen.queryByTestId('analysis-job-note')).toBeNull();
    // The tracker's copy is the whole advert too.
    expect(w.search.savedJobs()[0]?.description).toContain('second-line credit risk');
  });
});

describe('Tracker → Analyse, and Tracker → Tailor', () => {
  const TRACKED: TrackerEntry = {
    job: {
      ...RESULT_JOB,
      id: 'job-tracked',
      source: 'manual',
      external_id: null,
      title: 'Market Risk Analyst',
      description: 'The advert the user pasted when they added it.',
    },
    application: {
      id: 'app-tracked',
      job_id: 'job-tracked',
      status: 'applied',
      applied_date: '2026-09-20',
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW.toISOString(),
    },
  };

  it('Analyse lands on Analysis with the stored advert and no note — and no page is read', async () => {
    const w = world({ page: pages(500), tracker: [TRACKED] });
    const { user } = await renderApp(w, { tracker: [TRACKED] });

    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-app-tracked'));
    await user.click(await screen.findByTestId('detail-analyse'));

    await screen.findByTestId('view-analysis');
    expect(text('analysis-job-text').value).toContain('Market Risk Analyst');
    expect(text('analysis-job-text').value).toContain('The advert the user pasted');
    expect(screen.queryByTestId('analysis-job-note')).toBeNull();
    expect(w.search.calls.readFullAdvert).toBe(0);
  });

  it('Tailor lands on Tailor with the job, its application and the CV chosen on Analysis', async () => {
    const w = world({ page: pages(500), tracker: [TRACKED] });
    const { user } = await renderApp(w, { tracker: [TRACKED] });
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');
    await user.selectOptions(select('analysis-cv'), 'cv-2');

    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-app-tracked'));
    await user.click(await screen.findByTestId('detail-tailor'));

    await screen.findByTestId('view-tailor');
    await vi.waitFor(() => expect(select('tailor-job-pick').value).toBe('job-tracked'));
    expect(select('tailor-cv-pick').value).toBe('cv-2');
    expect(text('tailor-job-text').value).toContain('The advert the user pasted');
  });
});

describe('Delete everything', () => {
  it('negative: forgets the job the advert belonged to, and its note', async () => {
    const w = world({ page: pages(403) });
    const { user } = await renderApp(w);
    await analyseFromSearch(user);
    expect(screen.getByTestId('analysis-job-note')).toBeTruthy();

    await eraseEverything(user);
    await user.click(screen.getByTestId('nav-analysis'));
    await screen.findByDisplayValue('CV.docx');

    expect(text('analysis-job-text').value).toBe('');
    expect(screen.queryByTestId('analysis-job-note')).toBeNull();

    // A check run now belongs to no job — the old id did not survive.
    await user.type(text('analysis-job-text'), 'Credit Risk Analyst. SQL and Python.');
    await user.selectOptions(select('analysis-provider'), 'keyword');
    await user.click(screen.getByTestId('analysis-run'));
    await vi.waitFor(() => expect(w.analysis.storedAnalyses()).toHaveLength(1));
    expect(w.analysis.storedAnalyses()[0]?.job_id).toBeNull();
  });

  it('negative: drops a tailor handoff that had not been applied yet', async () => {
    const TRACKED: TrackerEntry = {
      job: { ...RESULT_JOB, id: 'job-t', source: 'manual', external_id: null },
      application: {
        id: 'app-t',
        job_id: 'job-t',
        status: 'saved',
        applied_date: null,
        notes: null,
        next_action: null,
        next_action_date: null,
        updated_at: NOW.toISOString(),
      },
    };
    const w = world({ page: pages(500), tracker: [TRACKED] });
    // The first read of the saved jobs is held, so the handoff is still
    // waiting when everything is deleted.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const tailorPort: TailorPort = {
      ...w.tailorPort,
      loadJobs: async () => {
        reads += 1;
        if (reads === 1) await held;
        return w.tailorPort.loadJobs();
      },
    };
    const { user } = await renderApp(w, { tracker: [TRACKED], tailorPort });

    await user.click(screen.getByTestId('nav-tracker'));
    await user.click(await screen.findByTestId('tracker-card-app-t'));
    await user.click(await screen.findByTestId('detail-tailor'));
    await screen.findByTestId('view-tailor');

    await eraseEverything(user);
    release();
    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByDisplayValue('CV.docx');
    await vi.waitFor(() => expect(select('tailor-provider').value).toBe('ollama:llama3.2:3b'));

    expect(text('tailor-job-text').value).toBe('');
    expect(select('tailor-job-pick').value).toBe('');
  });
});

describe('on a phone', () => {
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

  it('at 375px the flow still lands on Analysis, and the bottom bar follows it', async () => {
    installMatchMedia(375);
    const w = world({ page: pages(403) });
    const { user } = await renderApp(w);
    expect(screen.getByTestId('bottom-nav')).toBeTruthy();

    await analyseFromSearch(user);

    expect(screen.getByTestId('nav-analysis').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('analysis-job-note').textContent).toBe(PREVIEW_SITE_BLOCKS_NOTE);
  });
});
