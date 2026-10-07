// @vitest-environment jsdom
/**
 * L-200 on the tracker board: a started job's card carries ●●●○○ and
 * Continue, which hands the job and its next step to the shell.
 *
 * A card fresh from Search shows nothing extra, and the card itself — select
 * it, drag it — is the same button it always was.
 */
import { type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BoardProgressPort, type SavedProgress } from '../flow/progress';
import { type StepId } from '../flow/steps';
import { Tracker } from './Tracker';
import { type TrackerEntry } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 9, 7, 9, 0, 0);

function entry(id: string): TrackerEntry {
  return {
    job: {
      id: `job-${id}`,
      source: 'manual',
      external_id: null,
      title: `Role ${id}`,
      company: 'Acme',
      agency: null,
      location: 'London',
      salary_min: null,
      salary_max: null,
      salary_currency: null,
      salary_period: null,
      description: 'An advert.',
      url: null,
      posted_date: null,
      created_at: NOW.toISOString(),
    },
    application: {
      id,
      job_id: `job-${id}`,
      status: 'saved',
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: NOW.toISOString(),
    },
  };
}

function boardPort(byJob: Record<string, Partial<SavedProgress>>): BoardProgressPort {
  return {
    loadAll: async () =>
      new Map(
        Object.entries(byJob).map(([jobId, saved]) => [
          jobId,
          { analysed: false, exported: false, ...saved },
        ]),
      ),
  };
}

afterEach(() => {
  cleanup();
});

async function renderBoard(options: {
  saved?: Record<string, Partial<SavedProgress>>;
  tailored?: readonly string[];
  withContinue?: boolean;
}) {
  const onContinue = vi.fn<(job: Job, step: StepId) => void>();
  const onSelect = vi.fn();
  render(
    <Tracker
      port={createFakeTrackerPort([entry('a'), entry('b'), entry('c')])}
      now={NOW}
      boardProgressPort={boardPort(options.saved ?? {})}
      tailoredJob={(jobId) => (options.tailored ?? []).includes(jobId)}
      onContinue={options.withContinue === false ? undefined : onContinue}
    />,
  );
  await screen.findByTestId('tracker-card-a');
  return { onContinue, onSelect, user: userEvent.setup() };
}

describe('tracker cards for started jobs (L-200)', () => {
  it('happy: a started job shows its dots and Continue goes to its next step', async () => {
    const { onContinue, user } = await renderBoard({
      saved: { 'job-a': { analysed: true } },
      tailored: ['job-a'],
    });

    const row = await screen.findByTestId('tracker-card-progress-a');
    expect(row.textContent).toContain('●●●○○');
    await user.click(screen.getByTestId('tracker-card-continue-a'));

    expect(onContinue).toHaveBeenCalledTimes(1);
    const [job, step] = onContinue.mock.calls[0]!;
    expect(job.id).toBe('job-a');
    expect(step).toBe('ats');
  });

  it('a job that is only analysed continues to Tailor; one only exported shows its dot', async () => {
    await renderBoard({ saved: { 'job-b': { analysed: true }, 'job-c': { exported: true } } });
    expect((await screen.findByTestId('tracker-card-continue-b')).getAttribute('aria-label')).toBe(
      'Continue: Tailor',
    );
    expect(screen.getByTestId('tracker-card-progress-c').textContent).toContain('●○○○●');
  });

  it('negative: a job nothing has happened to shows no row at all', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await screen.findByTestId('tracker-card-progress-a');
    expect(screen.queryByTestId('tracker-card-progress-b')).toBeNull();
    expect(screen.queryByTestId('tracker-card-progress-c')).toBeNull();
  });

  it('Continue is not the card: pressing it does not open the card’s pane', async () => {
    const { user } = await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await user.click(await screen.findByTestId('tracker-card-continue-a'));
    expect(screen.getByTestId('tracker-card-a').getAttribute('aria-pressed')).toBe('false');
  });

  it('boundary: with nowhere to continue to, no row is drawn — never a dead button', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } }, withContinue: false });
    expect(screen.queryByTestId('tracker-card-progress-a')).toBeNull();
  });
});
