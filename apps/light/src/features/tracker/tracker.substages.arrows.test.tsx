// @vitest-environment jsdom
/**
 * The stage editor's reorder arrows are drawn, not typed (L-369).
 *
 * They were the characters ↑ and ↓, which render in whatever fallback font the
 * machine picks. They now draw the `arrowUp` / `arrowDown` icons. Everything
 * else about them is pinned here as it was: the name a screen reader hears,
 * the shared quiet button style with its 44px width, disabled (never hidden)
 * at the ends of the list — and pressing one still moves the stage.
 */
import { type Application, type InterviewSubstage, type Job } from '@cviper/core-types';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { QUIET_BUTTON } from '../../app/buttons';
import { drawingsAreDecoration, shownAs } from '../../ui/test/shownAs';

import { Tracker } from './Tracker';
import { type TrackerEntry } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 9, 5, 9, 0, 0);
const STAMP = '2026-10-05T08:00:00.000Z';

const STAGES: InterviewSubstage[] = [
  { id: 'sub-a', name: 'HR Screen', position: 0 },
  { id: 'sub-b', name: 'Technical Test', position: 1 },
  { id: 'sub-c', name: 'Panel Round', position: 2 },
];

function entry(): TrackerEntry {
  const job: Job = {
    id: 'job-one',
    source: 'manual',
    external_id: null,
    title: 'Role one',
    company: 'Acme',
    agency: null,
    location: null,
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: STAMP,
  };
  const application: Application = {
    id: 'one',
    job_id: job.id,
    status: 'interviewing',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: STAMP,
    interview_substage_id: null,
  };
  return { job, application };
}

async function openEditor(stages: readonly InterviewSubstage[] = STAGES) {
  const user = userEvent.setup();
  const port = createFakeTrackerPort([entry()], { substages: stages });
  render(<Tracker port={port} now={NOW} />);
  await user.click(await screen.findByTestId('tracker-edit-substages'));
  const editor = await screen.findByTestId('substage-editor');
  return { user, port, editor };
}

function arrow(editor: HTMLElement, name: string, direction: 'up' | 'down'): HTMLButtonElement {
  return within(editor).getByRole('button', {
    name: `Move ${name} ${direction}`,
  }) as HTMLButtonElement;
}

afterEach(cleanup);

describe('the stage editor draws its reorder arrows (L-369)', () => {
  it('happy: every row draws an up arrow and a down arrow, and nothing else, named by the stage', async () => {
    const { editor } = await openEditor();

    for (const { name } of STAGES) {
      expect(shownAs(arrow(editor, name, 'up')), name).toBe('[arrowUp]');
      expect(shownAs(arrow(editor, name, 'down')), name).toBe('[arrowDown]');
    }
  });

  it('the arrows are decoration: hidden from screen readers, never a Tab stop; the label is the name', async () => {
    const { editor } = await openEditor();

    for (const direction of ['up', 'down'] as const) {
      const button = arrow(editor, 'Technical Test', direction);
      expect(drawingsAreDecoration(button), direction).toBe(true);
      expect(button.getAttribute('aria-label'), direction).toBe(`Move Technical Test ${direction}`);
      expect(button.textContent, direction).toBe('');
    }
  });

  it('keeps the shared quiet button style and its 44px width', async () => {
    const { editor } = await openEditor();

    for (const direction of ['up', 'down'] as const) {
      const classes = arrow(editor, 'HR Screen', direction).className;
      expect(classes.startsWith(`${QUIET_BUTTON} min-w-11 `), direction).toBe(true);
    }
  });

  it('pressing the down arrow moves that stage down one, and saves it', async () => {
    const { user, port, editor } = await openEditor();

    await user.click(arrow(editor, 'HR Screen', 'down'));

    await waitFor(() =>
      expect(port.substageList().map((stage) => stage.name)).toEqual([
        'Technical Test',
        'HR Screen',
        'Panel Round',
      ]),
    );
  });

  it('pressing the up arrow moves that stage up one, and saves it', async () => {
    const { user, port, editor } = await openEditor();

    await user.click(arrow(editor, 'Panel Round', 'up'));

    await waitFor(() =>
      expect(port.substageList().map((stage) => stage.name)).toEqual([
        'HR Screen',
        'Panel Round',
        'Technical Test',
      ]),
    );
  });

  it('negative: the first up and the last down are disabled AND still drawn, never hidden', async () => {
    const { editor } = await openEditor();

    const firstUp = arrow(editor, 'HR Screen', 'up');
    const lastDown = arrow(editor, 'Panel Round', 'down');
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);
    expect(shownAs(firstUp)).toBe('[arrowUp]');
    expect(shownAs(lastDown)).toBe('[arrowDown]');
    // The ones in between can be pressed.
    expect(arrow(editor, 'HR Screen', 'down').disabled).toBe(false);
    expect(arrow(editor, 'Panel Round', 'up').disabled).toBe(false);
  });

  it('boundary: a list of one stage keeps both arrows, both disabled, both drawn', async () => {
    const { editor } = await openEditor([{ id: 'sub-only', name: 'Only Stage', position: 0 }]);

    const up = arrow(editor, 'Only Stage', 'up');
    const down = arrow(editor, 'Only Stage', 'down');
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    expect(shownAs(up)).toBe('[arrowUp]');
    expect(shownAs(down)).toBe('[arrowDown]');
    // Remove still works on the only stage.
    expect(
      (within(editor).getByRole('button', { name: 'Remove Only Stage' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
