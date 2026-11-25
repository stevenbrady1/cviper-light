// @vitest-environment jsdom
/**
 * L-200 on the tracker board: a started job's card carries ●●●○○ and
 * Continue, which hands the job and its next step to the shell.
 *
 * A card fresh from Search shows nothing extra, and the card itself — select
 * it, drag it — is the same button it always was.
 */
import { type Job } from '@cviper/core-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BoardProgressPort, type SavedProgress } from '../flow/progress';
import { type StepId } from '../flow/steps';
import { Tracker } from './Tracker';
import { CARD_DRAG_TYPE } from './TrackerCard';
import { type TrackerEntry } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 9, 7, 9, 0, 0);

/** The drawn dots inside `element`, in order (L-360). */
function marksIn(element: Element): (string | null)[] {
  return [...element.querySelectorAll('[data-mark]')].map((mark) => mark.getAttribute('data-mark'));
}

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
    expect(marksIn(row)).toEqual(['tick', 'tick', 'tick', 'dot', 'ring']);
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
    expect(marksIn(screen.getByTestId('tracker-card-progress-c'))).toEqual([
      'tick',
      'dot',
      'ring',
      'ring',
      'tick',
    ]);
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

describe('tracker cards say which step the job is on (L-331)', () => {
  it('a mid-workflow card reads Step 3 of 5 · Tailor, in words, on the board', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    const row = await screen.findByRole('group', { name: 'Step 3 of 5 · Tailor' });
    expect(row).toBe(screen.getByTestId('tracker-card-progress-a'));
    expect(screen.getByTestId('tracker-card-step-a').textContent).toBe('Step 3 of 5 · Tailor');
  });

  it('boundary (step 0): a job nothing has happened to says no step at all', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await screen.findByTestId('tracker-card-step-a');
    expect(screen.queryByTestId('tracker-card-step-b')).toBeNull();
    expect(screen.queryByTestId('tracker-card-step-c')).toBeNull();
  });

  it('negative: a card with no saved progress row draws no broken text', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await screen.findByTestId('tracker-card-step-a');
    const column = screen.getByTestId('tracker-column-saved');
    expect(column.textContent ?? '').not.toMatch(/Step undefined|NaN|undefined/);
    expect(screen.getAllByText(/^Step \d of 5 · /)).toHaveLength(1);
  });
});

/** The classes of `element`, one per entry. */
function classesOf(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

/** The card's frame: the list item that holds the card button (L-438). */
function frameOf(applicationId: string): HTMLElement {
  const frame = screen.getByTestId(`tracker-card-${applicationId}`).parentElement;
  if (frame === null) throw new Error(`card ${applicationId} has no frame`);
  return frame;
}

const FRAME = ['rounded-card', 'border', 'border-line', 'border-l-2', 'bg-card', 'shadow-raised'];

describe('the step row joins its card (L-438)', () => {
  it('happy: a started card and its step row share one frame, and the row is not inside the card button', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    const row = await screen.findByTestId('tracker-card-progress-a');
    const card = screen.getByTestId('tracker-card-a');
    const frame = frameOf('a');

    expect(frame.tagName).toBe('LI');
    expect(row.parentElement).toBe(frame);
    expect(card.contains(row)).toBe(false);
    expect([...frame.children]).toEqual([card, row]);
    // The frame is drawn once, on the list item, with the age edge (moving: teal).
    expect(classesOf(frame)).toEqual(expect.arrayContaining([...FRAME, 'border-l-teal']));
    // The button keeps only the round corners, so its focus ring keeps the card's shape.
    for (const drawn of ['border', 'border-line', 'border-l-2', 'bg-card', 'shadow-raised']) {
      expect(classesOf(card), drawn).not.toContain(drawn);
    }
    expect(classesOf(card)).not.toContain('border-l-teal');
    // The row is the frame's bottom part, under a hairline.
    expect(classesOf(row)).toEqual(expect.arrayContaining(['border-t', 'border-line']));
    expect(classesOf(row)).not.toContain('mt-1');
  });

  it('interaction: a click on the top part selects the card; Continue does not', async () => {
    const { onContinue, user } = await renderBoard({ saved: { 'job-a': { analysed: true } } });
    const card = screen.getByTestId('tracker-card-a');

    await user.click(await screen.findByTestId('tracker-card-continue-a'));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(card.getAttribute('aria-pressed')).toBe('false');

    await user.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  it('interaction: the card button is still what is dragged, with its id as the payload', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await screen.findByTestId('tracker-card-progress-a');
    const card = screen.getByTestId('tracker-card-a');
    const setData = vi.fn();
    const dataTransfer = { setData, effectAllowed: 'none' };

    expect(card.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(card, { dataTransfer });

    expect(setData).toHaveBeenCalledWith(CARD_DRAG_TYPE, 'a');
    expect(dataTransfer.effectAllowed).toBe('move');
  });

  it('negative: a card with no step row draws no hairline and no empty footer', async () => {
    await renderBoard({ saved: { 'job-a': { analysed: true } } });
    await screen.findByTestId('tracker-card-progress-a');
    const card = screen.getByTestId('tracker-card-b');
    const frame = frameOf('b');

    expect([...frame.children]).toEqual([card]);
    expect(frame.querySelector('.border-t')).toBeNull();
    expect(classesOf(frame)).toEqual(expect.arrayContaining(FRAME));
  });

  it('boundary: the selected card shows the blue edge on its whole frame, step row included', async () => {
    const { user } = await renderBoard({ saved: { 'job-a': { analysed: true } } });
    const row = await screen.findByTestId('tracker-card-progress-a');
    const card = screen.getByTestId('tracker-card-a');
    const frame = frameOf('a');
    const selectedEdge = 'has-[[aria-pressed=true]]:border-blue';

    expect(classesOf(frame)).toContain(selectedEdge);
    expect(classesOf(card)).not.toContain('border-blue');
    expect(frame.matches(':has([aria-pressed="true"])')).toBe(false);

    await user.click(card);

    expect(frame.matches(':has([aria-pressed="true"])')).toBe(true);
    expect(frame.contains(row)).toBe(true);
    // Only the selected card's frame: the others keep their own edge.
    expect(frameOf('b').matches(':has([aria-pressed="true"])')).toBe(false);
  });
});
