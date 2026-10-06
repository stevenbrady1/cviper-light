// @vitest-environment jsdom
/**
 * The step bar (L-200): what it shows, how it reads to a screen reader, and
 * that every control — each step, Back, Next, Tracker — works by mouse AND by
 * keyboard, and only ever moves the user.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobStepBar } from './JobStepBar';
import { type JobProgress, type StepId } from './steps';

afterEach(() => {
  cleanup();
});

function renderBar(
  current: StepId = 'tailor',
  progress: JobProgress = { analysed: true, tailored: false, exported: false },
  withTracker = true,
) {
  const onStep = vi.fn<(step: StepId) => void>();
  const onTracker = vi.fn();
  render(
    <JobStepBar
      title="Senior Data Analyst"
      company="Acme Ltd"
      location="Leeds"
      current={current}
      progress={progress}
      onStep={onStep}
      onTracker={withTracker ? onTracker : undefined}
    />,
  );
  return { onStep, onTracker, user: userEvent.setup() };
}

describe('JobStepBar', () => {
  it('names the job and shows the five steps in order, each with its state', () => {
    renderBar();
    expect(screen.getByTestId('job-steps-job').textContent).toBe(
      'Senior Data Analyst · Acme Ltd · Leeds',
    );
    const states = ['find', 'analyse', 'tailor', 'ats', 'export'].map((id) =>
      screen.getByTestId(`job-step-${id}`).getAttribute('data-state'),
    );
    expect(states).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });

  it('is an ordered list with exactly one aria-current="step" — "step 3 of 5"', () => {
    renderBar();
    const list = within(screen.getByRole('navigation', { name: 'Steps for this job' })).getByRole(
      'list',
    );
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(items.indexOf(current[0]!.closest('li')!)).toBe(2);
  });

  it('a skipped step says so — to the eye (⊘) and to a screen reader', () => {
    renderBar('tailor', { analysed: false, tailored: false, exported: false });
    const analyse = screen.getByTestId('job-step-analyse');
    expect(analyse.getAttribute('data-state')).toBe('skipped');
    expect(analyse.textContent).toBe('⊘Analyse, skipped');
  });

  it('a step is a link to that step, never locked — even one not reached yet', async () => {
    const { onStep, user } = renderBar();
    await user.click(screen.getByTestId('job-step-export'));
    expect(onStep).toHaveBeenCalledWith('export');
  });

  it('Back and Next move one step either way, and say where to', async () => {
    const { onStep, user } = renderBar();
    expect(screen.getByTestId('job-steps-next').textContent).toBe('Next: ATS Score');
    await user.click(screen.getByTestId('job-steps-next'));
    await user.click(screen.getByTestId('job-steps-back'));
    expect(onStep.mock.calls).toEqual([['ats'], ['analyse']]);
  });

  it('works by keyboard: Tab reaches the controls, Enter and Space press them', async () => {
    const { onStep, onTracker, user } = renderBar();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('job-steps-tracker'));
    await user.keyboard('{Enter}');
    expect(onTracker).toHaveBeenCalledTimes(1);

    screen.getByTestId('job-step-analyse').focus();
    await user.keyboard(' ');
    screen.getByTestId('job-steps-next').focus();
    await user.keyboard('{Enter}');
    expect(onStep.mock.calls).toEqual([['analyse'], ['ats']]);
  });

  it('boundary: on Find there is no Back; on Export there is no Next — disabled, not hidden', () => {
    renderBar('find');
    expect(screen.getByTestId('job-steps-back')).toHaveProperty('disabled', true);
    cleanup();
    renderBar('export');
    expect(screen.getByTestId('job-steps-next')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('job-steps-next').textContent).toBe('Next');
  });

  it('edge: a job with no location does not leave a trailing " · "', () => {
    render(
      <JobStepBar
        title="Analyst"
        company="Acme"
        location={null}
        current="analyse"
        progress={{ analysed: false, tailored: false, exported: false }}
        onStep={() => undefined}
      />,
    );
    expect(screen.getByTestId('job-steps-job').textContent).toBe('Analyst · Acme');
    expect(screen.queryByTestId('job-steps-tracker')).toBeNull();
  });

  it('never adds a primary (blue) button — each view keeps its one', () => {
    renderBar();
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(0);
  });
});
