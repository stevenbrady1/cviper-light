// @vitest-environment jsdom
/**
 * Customisable interview sub-stages on the board (L-205), driven the way a
 * person drives it: real clicks, real typing, and the stored result asserted
 * afterwards.
 */
import {
  INTERVIEW_SUBSTAGES_MAX,
  type Application,
  type InterviewSubstage,
  type Job,
} from '@cviper/core-types';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { CARD_DRAG_TYPE } from './TrackerCard';
import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 9, 5, 9, 0, 0);
const STAMP = '2026-10-05T08:00:00.000Z';

const STAGES: InterviewSubstage[] = [
  { id: 'sub-a', name: 'HR Screen', position: 0 },
  { id: 'sub-b', name: 'Technical Test', position: 1 },
  { id: 'sub-c', name: 'Panel Round', position: 2 },
];

function entry(id: string, application: Partial<Application> = {}): TrackerEntry {
  const job: Job = {
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
    description: null,
    url: null,
    posted_date: null,
    created_at: STAMP,
  };
  return {
    job,
    application: {
      id,
      job_id: job.id,
      status: 'interviewing',
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: STAMP,
      interview_substage_id: null,
      ...application,
    },
  };
}

async function renderBoard(
  entries: readonly TrackerEntry[],
  stages: readonly InterviewSubstage[] = STAGES,
) {
  const port = createFakeTrackerPort(entries, { substages: stages });
  render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId('tracker-column-interviewing');
  return port;
}

function dragCardTo(applicationId: string, status: string): void {
  const dataTransfer = {
    types: [CARD_DRAG_TYPE],
    getData: (type: string) => (type === CARD_DRAG_TYPE ? applicationId : ''),
    setData: () => {},
    dropEffect: 'move',
    effectAllowed: 'move',
  };
  const column = screen.getByTestId(`tracker-column-${status}`);
  fireEvent.dragOver(column, { dataTransfer });
  fireEvent.drop(column, { dataTransfer });
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('tracker-edit-substages'));
  return screen.findByTestId('substage-editor');
}

afterEach(cleanup);

describe('the card', () => {
  it('shows the sub-stage a card is in, and nothing for a card with none', async () => {
    await renderBoard([
      entry('one', { interview_substage_id: 'sub-b' }),
      entry('two', { interview_substage_id: null }),
    ]);
    expect(screen.getByTestId('tracker-card-substage-one').textContent).toBe('Technical Test');
    expect(screen.queryByTestId('tracker-card-substage-two')).toBeNull();
    // Said in words for a screen reader too, not only drawn.
    expect(screen.getByTestId('tracker-card-one').getAttribute('aria-label')).toContain(
      'Stage: Technical Test',
    );
  });

  it('shows nothing for a card pointing at a sub-stage that no longer exists', async () => {
    await renderBoard([entry('one', { interview_substage_id: 'ghost' })]);
    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();
    expect(screen.getByTestId('tracker-card-one')).toBeTruthy();
  });
});

describe('choosing a sub-stage from the detail pane', () => {
  it('lists "No stage" and every sub-stage in order, and saves the choice', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);

    await user.click(screen.getByTestId('tracker-card-one'));
    const select = (await screen.findByTestId('detail-substage')) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'No stage',
      'HR Screen',
      'Technical Test',
      'Panel Round',
    ]);

    await user.selectOptions(select, 'Panel Round');

    await waitFor(() => expect(port.entries()[0]?.application.interview_substage_id).toBe('sub-c'));
    expect(screen.getByTestId('tracker-card-substage-one').textContent).toBe('Panel Round');
  });

  it('can set a card back to no stage', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one', { interview_substage_id: 'sub-a' })]);

    await user.click(screen.getByTestId('tracker-card-one'));
    await user.selectOptions(await screen.findByTestId('detail-substage'), 'No stage');

    await waitFor(() =>
      expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull(),
    );
  });

  it('is not offered for a card that is not Interviewing', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('one'), entry('two', { status: 'applied' })]);

    await user.click(screen.getByTestId('tracker-card-two'));
    await screen.findByTestId('detail-status');
    expect(screen.queryByTestId('detail-substage')).toBeNull();
  });

  it('puts the card back and says so when the save fails', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    await user.click(screen.getByTestId('tracker-card-one'));
    const select = await screen.findByTestId('detail-substage');

    port.failNext('saveApplication');
    await user.selectOptions(select, 'HR Screen');

    expect((await screen.findByTestId('tracker-error')).textContent).toContain(
      'could not be saved',
    );
    expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull();
    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();
  });
});

describe('a card leaving Interviewing', () => {
  it('drops its sub-stage when dragged to another column, and saves that', async () => {
    const port = await renderBoard([entry('one', { interview_substage_id: 'sub-b' })]);

    dragCardTo('one', 'offer');

    await waitFor(() => expect(port.entries()[0]?.application.status).toBe('offer'));
    expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull();
    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();
  });

  it('drops it when moved with the keyboard route, the status select', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one', { interview_substage_id: 'sub-b' })]);

    await user.click(screen.getByTestId('tracker-card-one'));
    await user.selectOptions(await screen.findByTestId('detail-status'), 'rejected');

    await waitFor(() => expect(port.entries()[0]?.application.status).toBe('rejected'));
    expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull();
  });
});

describe('the sub-stage editor', () => {
  it('opens from the Interviewing column header and lists the sub-stages', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('one')]);

    const editor = await openEditor(user);
    const inputs = within(editor).getAllByRole('textbox', { name: /^Name of / });
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'HR Screen',
      'Technical Test',
      'Panel Round',
    ]);
  });

  it('adds a sub-stage with the keyboard alone: type, press Enter', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    await user.type(within(editor).getByLabelText('New interview stage'), 'Final{Enter}');

    await waitFor(() => expect(port.substageList().map((s) => s.name)).toContain('Final'));
    expect(port.substageList().at(-1)).toMatchObject({ name: 'Final', position: 3 });
    expect((within(editor).getByLabelText('New interview stage') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('rejects an empty name with a message, and writes nothing', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    await user.type(within(editor).getByLabelText('New interview stage'), '   {Enter}');

    expect((await screen.findByTestId('substage-error')).textContent).toMatch(/name/i);
    expect(port.calls.saveSubstages).toBe(0);
  });

  it('rejects a duplicate name', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    await user.type(within(editor).getByLabelText('New interview stage'), 'hr screen{Enter}');

    expect((await screen.findByTestId('substage-error')).textContent).toMatch(/already/i);
    expect(port.calls.saveSubstages).toBe(0);
    expect(port.substageList()).toHaveLength(3);
  });

  it('boundary: at the maximum, Add is disabled and the reason is on screen', async () => {
    const user = userEvent.setup();
    const full = Array.from({ length: INTERVIEW_SUBSTAGES_MAX }, (_, index) => ({
      id: `s-${index}`,
      name: `Stage ${index}`,
      position: index,
    }));
    const port = await renderBoard([entry('one')], full);
    const editor = await openEditor(user);

    await user.type(within(editor).getByLabelText('New interview stage'), 'One more{Enter}');

    expect((within(editor).getByTestId('substage-add') as HTMLButtonElement).disabled).toBe(true);
    expect(within(editor).getByTestId('substage-limit').textContent).toContain(
      String(INTERVIEW_SUBSTAGES_MAX),
    );
    expect(port.substageList()).toHaveLength(INTERVIEW_SUBSTAGES_MAX);
  });

  it('renames one, and a card using it shows the new name', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one', { interview_substage_id: 'sub-b' })]);
    const editor = await openEditor(user);

    const input = within(editor).getByRole('textbox', { name: 'Name of Technical Test' });
    await user.clear(input);
    await user.type(input, 'Coding Exercise{Enter}');

    await waitFor(() => expect(port.substageList()[1]?.name).toBe('Coding Exercise'));
    expect(screen.getByTestId('tracker-card-substage-one').textContent).toBe('Coding Exercise');
  });

  it('refuses an empty rename, keeps the draft with the reason on its row, and Escape reverts', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    const input = within(editor).getByRole('textbox', { name: 'Name of HR Screen' });
    await user.clear(input);
    await user.keyboard('{Enter}');

    const reason = await screen.findByTestId('substage-row-error-sub-a');
    expect(reason.textContent).toMatch(/name/i);
    expect(port.substageList()[0]?.name).toBe('HR Screen');
    // The draft is kept, wired to its message for assistive technology.
    expect((input as HTMLInputElement).value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(reason.id);

    await user.keyboard('{Escape}');
    expect((input as HTMLInputElement).value).toBe('HR Screen');
    expect(screen.queryByTestId('substage-row-error-sub-a')).toBeNull();
  });

  it('reorders with real buttons, and the first cannot go up nor the last down', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    expect(
      (within(editor).getByRole('button', { name: 'Move HR Screen up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(editor).getByRole('button', { name: 'Move Panel Round down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.click(within(editor).getByRole('button', { name: 'Move Panel Round up' }));

    await waitFor(() =>
      expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-c', 'sub-b']),
    );
    expect(port.substageList().map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('removing one in use leaves the card on the board, in Interviewing, with no stage', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([
      entry('one', { interview_substage_id: 'sub-b', notes: 'Went well.' }),
      entry('two', { interview_substage_id: 'sub-a' }),
    ]);
    const editor = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));
    await user.click(await screen.findByTestId('substage-confirm-remove'));

    await waitFor(() => expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-c']));
    // The card is still there, still Interviewing, notes intact, label gone.
    const stored = port.entries().find((e) => e.application.id === 'one')?.application;
    expect(stored).toMatchObject({ status: 'interviewing', notes: 'Went well.' });
    expect(stored?.interview_substage_id ?? null).toBeNull();
    expect(screen.getByTestId('tracker-card-one')).toBeTruthy();
    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();
    // The other card, on another sub-stage, is untouched.
    expect(screen.getByTestId('tracker-card-substage-two').textContent).toBe('HR Screen');
  });

  it('puts the list back and says so when a save fails', async () => {
    const user = userEvent.setup();
    const port = await renderBoard([entry('one')]);
    const editor = await openEditor(user);

    port.failNext('saveSubstages');
    await user.click(within(editor).getByRole('button', { name: 'Remove HR Screen' }));

    expect((await screen.findByTestId('substage-error')).textContent).toContain(
      'could not be saved',
    );
    expect(port.substageList()).toHaveLength(3);
    expect(within(editor).getByRole('textbox', { name: 'Name of HR Screen' })).toBeTruthy();
  });
});

describe('a board with no sub-stages at all', () => {
  it('works exactly as before: cards show no stage and the detail pane offers only "No stage"', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('one')], []);

    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();
    await user.click(screen.getByTestId('tracker-card-one'));
    const select = (await screen.findByTestId('detail-substage')) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['No stage']);
  });

  it('still opens the board when the sub-stage list cannot be read', async () => {
    const port = createFakeTrackerPort([entry('one')]);
    port.failNext('substages');
    render(<Tracker port={port} now={NOW} />);

    expect(await screen.findByTestId('tracker-card-one')).toBeTruthy();
  });
});
