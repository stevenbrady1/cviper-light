// @vitest-environment jsdom
/**
 * L-200 on the Analysis screen: the step bar for the job being checked.
 *
 * Shown only when the advert belongs to a tracked job; Analyse is "here",
 * Tailor / ATS Score / Export are handed to the shell with the same hand-off
 * "Tailor my CV for this job" builds; and nothing on the bar runs a check.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv, type Job } from '@cviper/core-types';

import type { TailorHandoff } from '../flow/handoff';
import type { StepId } from '../flow/steps';

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

type OnJobStep = (step: StepId, job: Job, handoff: TailorHandoff) => void;

async function renderAnalysis(
  options: {
    withJob?: boolean;
    tailored?: boolean;
    progress?: Parameters<typeof createFakeProgressPort>[0];
  } = {},
) {
  const session = createAnalysisSession();
  if (options.withJob !== false) {
    loadJobIntoAnalysis(session, { job: JOB, applicationId: null, note: null });
  }
  const onJobStep = vi.fn<OnJobStep>();
  const onTracker = vi.fn();
  const user = userEvent.setup();
  render(
    <Analysis
      port={createFakeAnalysisPort({ cvs: [CV], jobs: [JOB] })}
      filePort={createFakeFilePort()}
      consentPort={createFakeConsentPort()}
      profilePort={createFakeProfilePort()}
      now={new Date('2026-10-06T09:00:00.000Z')}
      session={session}
      progressPort={createFakeProgressPort(options.progress ?? {})}
      tailoredJob={() => options.tailored ?? false}
      onJobStep={onJobStep}
      onTracker={onTracker}
    />,
  );
  await screen.findByDisplayValue('CV.docx');
  return { session, onJobStep, onTracker, user };
}

const stateOf = (id: string) => screen.getByTestId(`job-step-${id}`).getAttribute('data-state');

describe('the step bar on Analysis (L-200)', () => {
  it('negative: a pasted advert with no tracked job has no bar', async () => {
    await renderAnalysis({ withJob: false });
    expect(screen.queryByTestId('job-steps')).toBeNull();
  });

  it('happy: a tracked job shows its bar on the Analyse step', async () => {
    await renderAnalysis({ tailored: true, progress: { 'job-1': { exported: true } } });

    const bar = await screen.findByTestId('job-steps');
    expect(bar.textContent).toContain('Credit Risk Analyst · Barclays · London');
    expect(stateOf('analyse')).toBe('current');
    expect(stateOf('tailor')).toBe('done');
    await vi.waitFor(() => expect(stateOf('export')).toBe('done'));
  });

  it('after a check, Next hands over that check’s keyword gaps, for this CV and advert', async () => {
    const { onJobStep, user } = await renderAnalysis();
    await screen.findByTestId('job-steps');
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    await user.click(screen.getByTestId('job-steps-next'));

    const [, , handoff] = onJobStep.mock.calls[0]!;
    expect(handoff.keywordGaps).toMatchObject({ cvId: 'cv-1' });
    expect(handoff.keywordGaps?.advert).toContain('IFRS 9 impairment');
    expect(handoff.keywordGaps?.gaps.length).toBeGreaterThan(0);
    // This screen is still Analyse: moving is the shell's job.
    expect(stateOf('analyse')).toBe('current');
  });

  it('Next hands Tailor to the shell, with the same hand-off the Tailor button builds', async () => {
    const { onJobStep, user } = await renderAnalysis();
    await screen.findByTestId('job-steps');

    await user.click(screen.getByTestId('job-steps-next'));

    expect(onJobStep).toHaveBeenCalledTimes(1);
    const [step, job, handoff] = onJobStep.mock.calls[0]!;
    expect(step).toBe('tailor');
    expect(job.id).toBe('job-1');
    expect(handoff).toMatchObject({ jobId: 'job-1', cvId: 'cv-1', keywordGaps: null });
  });

  it('nothing on the bar runs a check: no model, no keyword run, no saved analysis', async () => {
    const { onJobStep, onTracker, user } = await renderAnalysis();
    await screen.findByTestId('job-steps');

    for (const id of ['find', 'analyse', 'tailor', 'ats', 'export']) {
      await user.click(screen.getByTestId(`job-step-${id}`));
    }
    await user.click(screen.getByTestId('job-steps-tracker'));

    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(onJobStep.mock.calls.map(([step]) => step)).toEqual(['find', 'tailor', 'ats', 'export']);
    expect(onTracker).toHaveBeenCalledTimes(1);
  });

  it('skipped never applies before Analyse: Find is done because the job exists', async () => {
    await renderAnalysis();
    await screen.findByTestId('job-steps');
    expect(stateOf('find')).toBe('done');
    expect(stateOf('tailor')).toBe('todo');
  });
});
