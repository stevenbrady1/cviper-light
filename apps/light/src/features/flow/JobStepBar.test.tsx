// @vitest-environment jsdom
/**
 * The step bar (L-200): what it shows, how it reads to a screen reader, and
 * that every control — each step, Back, Next, Tracker — works by mouse AND by
 * keyboard, and only ever moves the user.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FLOW_HINT, STEP_HINT } from '../../app/hints';
import { JobStepBar } from './JobStepBar';
import { type JobProgress, type StepId } from './steps';

afterEach(() => {
  cleanup();
});

/** The drawn marks inside `element`, in order (L-360). */
function marksIn(element: Element): (string | null)[] {
  return [...element.querySelectorAll('[data-mark]')].map((mark) => mark.getAttribute('data-mark'));
}

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
    // L-360: the mark is drawn, not typed — first in the button, then the words.
    expect(marksIn(analyse)).toEqual(['skipped']);
    expect(analyse.firstElementChild?.getAttribute('data-mark')).toBe('skipped');
    expect(analyse.textContent).toBe('Analyse, skipped');
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

  it('shows the CV and engine chosen for the job, once, for every step', () => {
    render(
      <JobStepBar
        title="Analyst"
        company="Acme"
        location={null}
        current="tailor"
        progress={{ analysed: false, tailored: false, exported: false }}
        onStep={() => undefined}
        choice={{ cv: 'jamie-cv-2026.docx', engine: 'Ollama · llama3.1:8b' }}
      />,
    );
    expect(screen.getByTestId('job-steps-choice').textContent).toBe(
      'CV: jamie-cv-2026.docx · , Engine: Ollama · llama3.1:8b',
    );
  });

  it('boundary: nothing chosen yet says so rather than leaving a blank', () => {
    render(
      <JobStepBar
        title="Analyst"
        company="Acme"
        location={null}
        current="tailor"
        progress={{ analysed: false, tailored: false, exported: false }}
        onStep={() => undefined}
        choice={{ cv: null, engine: null }}
      />,
    );
    expect(screen.getByTestId('job-steps-choice').textContent).toContain('CV: none chosen');
    expect(screen.getByTestId('job-steps-choice').textContent).toContain('Engine: none set up');
  });
});

/**
 * L-360: the step bar's marks are drawn (`StateMark`), not typed, so they look
 * the same on every machine. Each state keeps its own SHAPE — done, current,
 * skipped and to-do differ without colour — and the words a screen reader
 * hears are unchanged, because a drawn mark is hidden from it.
 */
describe('JobStepBar draws its marks (L-360)', () => {
  const STEP_IDS = ['find', 'analyse', 'tailor', 'ats', 'export'] as const;

  function stepMarks(): (string | null)[][] {
    return STEP_IDS.map((id) => marksIn(screen.getByTestId(`job-step-${id}`)));
  }

  it('happy: one mark per step, in order — done, done, current, to do, to do', () => {
    renderBar();
    expect(stepMarks()).toEqual([['tick'], ['tick'], ['dot'], ['ring'], ['ring']]);
  });

  it('done, current, skipped and to-do are four different shapes, not four colours', () => {
    renderBar('ats', { analysed: false, tailored: true, exported: false });
    const byState = new Map<string, string>();
    for (const id of STEP_IDS) {
      const step = screen.getByTestId(`job-step-${id}`);
      const mark = step.querySelector('[data-mark]')!;
      byState.set(step.getAttribute('data-state')!, mark.innerHTML);
    }
    expect([...byState.keys()].sort()).toEqual(['current', 'done', 'skipped', 'todo']);
    expect(new Set(byState.values()).size).toBe(4);
    // And no state puts a colour on its mark: shape is what tells them apart.
    for (const mark of document.querySelectorAll('[data-testid^="job-step-"] [data-mark]')) {
      expect(mark.getAttribute('class') ?? '').not.toMatch(/\btext-/);
    }
  });

  it('the step hints no longer quote a typed symbol the bar does not show', () => {
    expect(Object.values(STEP_HINT).join(' ')).not.toMatch(/[✓●○⊘◀]/);
    expect(FLOW_HINT.tracker).not.toMatch(/[✓●○⊘◀]/);
  });

  it('no step types a symbol any more', () => {
    renderBar('ats', { analysed: false, tailored: true, exported: false });
    const bar = screen.getByTestId('job-steps');
    expect(bar.textContent).not.toMatch(/[✓●○⊘◀]/);
  });

  it('negative: a job with every step it can skip skipped', () => {
    // Find is done whenever there is a job, and the step you are on is
    // current, so on Export with nothing done the three between are skipped.
    renderBar('export', { analysed: false, tailored: false, exported: false });
    expect(stepMarks()).toEqual([['tick'], ['skipped'], ['skipped'], ['skipped'], ['dot']]);
    for (const [id, name] of [
      ['analyse', 'Analyse, skipped'],
      ['tailor', 'Tailor, skipped'],
      ['ats', 'ATS Score, skipped'],
    ] as const) {
      expect(screen.getByRole('button', { name })).toBe(screen.getByTestId(`job-step-${id}`));
    }
  });

  it('boundary: all five steps done — four ticks and the step you are on', () => {
    renderBar('export', { analysed: true, tailored: true, exported: true });
    expect(stepMarks()).toEqual([['tick'], ['tick'], ['tick'], ['tick'], ['dot']]);
  });

  it('screen readers hear the same names as before: the mark is hidden, the words stay', () => {
    renderBar('ats', { analysed: false, tailored: true, exported: false });
    const names = STEP_IDS.map(
      (id) => screen.getByTestId(`job-step-${id}`).textContent, // the mark adds no text
    );
    expect(names).toEqual([
      'Find, done',
      'Analyse, skipped',
      'Tailor, done',
      'ATS Score, you are here',
      'Export, not started',
    ]);
    for (const name of names) expect(screen.getByRole('button', { name: name! })).toBeTruthy();
    for (const mark of document.querySelectorAll('[data-testid="job-steps"] [data-mark]')) {
      expect(mark.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('the Tracker link draws its back mark first and is still named "Tracker"', () => {
    renderBar();
    const tracker = screen.getByTestId('job-steps-tracker');
    expect(marksIn(tracker)).toEqual(['back']);
    expect(tracker.firstElementChild?.getAttribute('data-mark')).toBe('back');
    expect(screen.getByRole('button', { name: 'Tracker' })).toBe(tracker);
  });
});
