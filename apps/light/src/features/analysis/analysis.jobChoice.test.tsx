// @vitest-environment jsdom
/**
 * L-200, "pick once": the CV and engine are chosen once per JOB. A job that
 * already has a choice (made here or on Tailor) brings it back when it
 * arrives on Analysis; a choice made here, for a tracked job, is recorded for
 * that job. A pasted advert has no job, and records nothing.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv, type Job } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Analysis } = await import('./Analysis');
const { createAnalysisSession } = await import('./session');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeConsentPort } = await import('./test/fakeConsentPort');
const { createFakeProfilePort } = await import('../profile/test/fakePort');
const { loadJobIntoAnalysis } = await import('../flow/handoff');
const { createFakeProgressPort } = await import('../flow/test/fakeProgressPort');

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

const JOB: Job = {
  id: 'job-1',
  source: 'reed',
  external_id: '1',
  title: 'Credit Risk Analyst',
  company: 'Barclays',
  agency: null,
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'You will build SQL models in Python and report on IFRS 9 impairment.',
  url: null,
  posted_date: null,
  created_at: '2026-09-01T09:00:00.000Z',
};

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

type Choice = { cvId?: string | null; optionKey?: string | null };
const CV_2: Cv = { ...CV, id: 'cv-2', name: 'Banking CV.docx' };

async function renderAnalysis(
  options: {
    withJob?: boolean;
    choice?: { cvId: string | null; optionKey: string | null } | null;
  } = {},
) {
  const session = createAnalysisSession();
  if (options.withJob !== false) {
    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: null });
  }
  const onJobChoice = vi.fn<(job: Job, choice: Choice) => void>();
  const user = userEvent.setup();
  render(
    <Analysis
      port={createFakeAnalysisPort({ cvs: [CV, CV_2], jobs: [JOB] })}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      profilePort={createFakeProfilePort()}
      now={new Date('2026-10-07T09:00:00.000Z')}
      session={session}
      progressPort={createFakeProgressPort({})}
      jobChoice={() => options.choice ?? null}
      onJobChoice={onJobChoice}
    />,
  );
  // The CV list has loaded — whichever CV the job's choice then selected.
  await vi.waitFor(() =>
    expect(screen.getByTestId<HTMLSelectElement>('analysis-cv').disabled).toBe(false),
  );
  return { session, onJobChoice, user };
}

const pick = (id: string) => screen.getByTestId<HTMLSelectElement>(id);

describe('the CV and engine are picked once per job (L-200)', () => {
  it('happy: a job that already has a CV brings it back on arrival', async () => {
    await renderAnalysis({ choice: { cvId: 'cv-2', optionKey: null } });
    await vi.waitFor(() => expect(pick('analysis-cv').value).toBe('cv-2'));
    expect(screen.getByTestId('job-steps-choice').textContent).toContain('CV: Banking CV.docx');
  });

  it('picking a CV or an engine here records it for the job', async () => {
    const { onJobChoice, user } = await renderAnalysis();
    await screen.findByTestId('job-steps');

    await user.selectOptions(pick('analysis-cv'), 'cv-2');
    await user.selectOptions(pick('analysis-provider'), 'keyword');

    expect(onJobChoice.mock.calls.map(([job, choice]) => [job.id, choice])).toEqual([
      ['job-1', { cvId: 'cv-2' }],
      ['job-1', { optionKey: 'keyword' }],
    ]);
  });

  it('negative: a pasted advert has no job, so nothing is recorded', async () => {
    const { onJobChoice, user } = await renderAnalysis({ withJob: false });
    await user.selectOptions(pick('analysis-cv'), 'cv-2');
    expect(onJobChoice).not.toHaveBeenCalled();
  });

  it('negative: a recorded CV that has been deleted since is ignored, not selected', async () => {
    await renderAnalysis({ choice: { cvId: 'cv-deleted', optionKey: null } });
    await screen.findByTestId('job-steps');
    expect(pick('analysis-cv').value).toBe('cv-1');
  });

  it('boundary: a job with no choice yet keeps whatever is picked now', async () => {
    await renderAnalysis({ choice: null });
    await screen.findByTestId('job-steps');
    expect(pick('analysis-cv').value).toBe('cv-1');
  });
});
