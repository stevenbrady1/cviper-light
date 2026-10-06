// @vitest-environment jsdom
/**
 * L-199, part 2, through the whole shell: a restart. The app is rendered over
 * a workflow port that already holds a job's work — what the last run of the
 * app wrote — and must offer it back, put it back, and keep writing.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, renderTailoredCv, type Cv, type Job } from '@cviper/core-types';
import { type ChatTransport } from '@cviper/ai-providers';
import { type JobProviderId } from '@cviper/job-apis';

import type { JobWorkflowRow } from '../db/workflow';
import type { WorkflowPort } from '../features/tailor/persistence';

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
const { EMPTY_TAILOR_JOB } = await import('../features/tailor/jobSessions');
const { toRow } = await import('../features/tailor/persistence');
const { jobAdvertText } = await import('../features/analysis/model');

const BOTH_KEYS: Record<JobProviderId, 'configured'> = { adzuna: 'configured', reed: 'configured' };

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment dashboards in Python for the credit committee.
BSc Mathematics, University of Leeds, 2016`;

const CVS: Cv[] = [
  {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text: CV_TEXT,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  },
];

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Senior Data Analyst',
  company: 'Acme Ltd',
  agency: null,
  location: 'Leeds',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'Build IFRS 9 reporting in Python and SQL. Present to stakeholders.',
  url: null,
  posted_date: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const EDITED_ADVERT = 'Build IFRS 9 reporting in Python and SQL. Present to stakeholders. Edited.';

const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3B' },
    },
  ],
});

const TAILORED = {
  summary: 'Data analyst who builds IFRS 9 impairment dashboards at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: ['Built IFRS 9 impairment dashboards in Python for the credit committee.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
};

/** What the previous run of the app wrote for job-1: an edited advert and a draft. */
const SAVED_ROW: JobWorkflowRow = toRow(
  'job-1',
  {
    ...EMPTY_TAILOR_JOB,
    cvId: 'cv-1',
    optionKey: 'ollama:llama3.2:3b',
    advert: EDITED_ADVERT,
    result: {
      cv: TAILORED,
      text: renderTailoredCv(TAILORED, null),
      report: { clean: true, flagged: [] },
      provider: 'ollama',
      model: 'llama3.2:3b',
      retried: false,
      userMetrics: [],
    },
  },
  '2026-10-05T18:00:00.000Z',
);

const chat: ChatTransport = {
  chat: () => Promise.reject(new Error('no model call is expected in this test')),
  listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
};

function workflowPort(rows: JobWorkflowRow[], lastJob: string | null) {
  const saved: JobWorkflowRow[] = [];
  const port: WorkflowPort = {
    load: async () => ok(rows),
    save: async (row) => {
      saved.push(row);
      return ok(undefined);
    },
    readLastJob: async () => lastJob,
    writeLastJob: async () => undefined,
  };
  return { port, saved };
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
});

async function renderApp(port: WorkflowPort) {
  const user = userEvent.setup();
  let counter = 0;
  render(
    <App
      trackerPort={createFakeTrackerPort([])}
      profilePort={createFakeProfilePort()}
      analysisPort={createFakeAnalysisPort({ cvs: CVS })}
      tailorPort={createFakeTailorPort({ cvs: CVS, jobs: [JOB] })}
      searchPort={createFakeSearchPort([])}
      boardsPort={createFakeBoardPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => BOTH_KEYS}
      filePort={createFakeFilePort()}
      openedCv={createFakeOpenedCvPort()}
      backupPort={createFakeBackupPort()}
      erasePort={createFakeErasePort()}
      createTransport={() => chat}
      workflowPort={port}
      newId={() => `generated-${(counter += 1)}`}
      now={new Date('2026-10-06T09:00:00.000Z')}
    />,
  );
  await screen.findByTestId('shell');
  return { user };
}

describe('restarting mid-Tailor (L-199)', () => {
  it('happy: offers the job back, and Continue reopens the same job, CV, advert and draft', async () => {
    const { port } = workflowPort([SAVED_ROW], 'job-1');
    const { user } = await renderApp(port);

    const banner = await screen.findByTestId('resume-banner');
    expect(banner.textContent).toContain('Tailor for Senior Data Analyst at Acme Ltd');

    await user.click(screen.getByTestId('resume-continue'));
    await screen.findByTestId('view-tailor');
    expect(screen.queryByTestId('resume-banner')).toBeNull();

    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLSelectElement>('tailor-job-pick').value).toBe('job-1'),
    );
    expect(screen.getByTestId<HTMLSelectElement>('tailor-cv-pick').value).toBe('cv-1');
    expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe(EDITED_ADVERT);
    expect(screen.getByTestId('tailor-advert-edited')).toBeTruthy();
    expect(screen.getByTestId('tailor-cv').textContent).toContain('IFRS 9 impairment dashboards');
  });

  it('"Not now" closes the offer and keeps the work for that job', async () => {
    const { port } = workflowPort([SAVED_ROW], 'job-1');
    const { user } = await renderApp(port);

    await user.click(await screen.findByTestId('resume-dismiss'));
    expect(screen.queryByTestId('resume-banner')).toBeNull();

    await user.click(screen.getByTestId('nav-tailor'));
    await screen.findByTestId('view-tailor');
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe(EDITED_ADVERT),
    );
  });

  it('negative: nothing to resume means no offer at all', async () => {
    const { port } = workflowPort([], null);
    await renderApp(port);
    // Give the launch read time to land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });

  it('keeps writing: an edit after the restart reaches the port', async () => {
    const { port, saved } = workflowPort([SAVED_ROW], 'job-1');
    const { user } = await renderApp(port);
    await user.click(await screen.findByTestId('resume-continue'));
    await vi.waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe(EDITED_ADVERT),
    );

    await user.click(screen.getByTestId('tailor-advert-restore'));

    await vi.waitFor(
      () => expect(saved.at(-1)).toMatchObject({ id: 'job-1', advert: jobAdvertText(JOB) }),
      { timeout: 3000 },
    );
  });
});
