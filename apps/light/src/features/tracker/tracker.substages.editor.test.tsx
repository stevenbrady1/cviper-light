// @vitest-environment jsdom
/**
 * The sub-stage editor's behaviour for people (L-205 review: C1 editor half,
 * D1-D9): removal that says what it will do, focus that goes where a keyboard
 * user expects, errors tied to the box they are about, spoken confirmations.
 */
import { type Application, type InterviewSubstage, type Job } from '@cviper/core-types';
import { INTERVIEW_SUBSTAGE_NAME_MAX, INTERVIEW_SUBSTAGES_MAX } from '@cviper/core-types';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

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

function entry(id: string, substage: string | null = null): TrackerEntry {
  const job: Job = {
    id: `job-${id}`,
    source: 'manual',
    external_id: null,
    title: `Role ${id}`,
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
    id,
    job_id: job.id,
    status: 'interviewing',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: STAMP,
    interview_substage_id: substage,
  };
  return { job, application };
}

async function board(
  entries: TrackerEntry[],
  stages: readonly InterviewSubstage[] = STAGES,
  prepare: (port: ReturnType<typeof createFakeTrackerPort>) => void = () => {},
) {
  const user = userEvent.setup();
  const port = createFakeTrackerPort(entries, { substages: stages });
  prepare(port);
  render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId('tracker-column-interviewing');
  return { user, port };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  const opener = await screen.findByTestId('tracker-edit-substages');
  await user.click(opener);
  return { opener, editor: await screen.findByTestId('substage-editor') };
}

function names(editor: HTMLElement): string[] {
  return within(editor)
    .getAllByRole('textbox', { name: /^Name of / })
    .map((input) => (input as HTMLInputElement).value);
}

afterEach(cleanup);

describe('C1 (editor half): more than 20 stages after a merge import', () => {
  const many: InterviewSubstage[] = Array.from(
    { length: INTERVIEW_SUBSTAGES_MAX + 5 },
    (_, index) => ({ id: `s-${index}`, name: `Stage ${index}`, position: index }),
  );

  it('renders every stage, disables Add with the reason, and still lets one be removed', async () => {
    const { user, port } = await board([entry('one')], many);
    const { editor } = await openEditor(user);

    expect(names(editor)).toHaveLength(INTERVIEW_SUBSTAGES_MAX + 5);
    expect((within(editor).getByTestId('substage-add') as HTMLButtonElement).disabled).toBe(true);
    expect(within(editor).getByTestId('substage-limit').textContent).toContain(
      String(INTERVIEW_SUBSTAGES_MAX),
    );

    await user.click(within(editor).getByRole('button', { name: 'Remove Stage 3' }));
    await waitFor(() => expect(port.substageList()).toHaveLength(INTERVIEW_SUBSTAGES_MAX + 4));
  });

  it('boundary: Add is enabled at 19 and disabled at exactly 20', async () => {
    const { user } = await board([entry('one')], many.slice(0, INTERVIEW_SUBSTAGES_MAX - 1));
    const { editor } = await openEditor(user);
    expect((within(editor).getByTestId('substage-add') as HTMLButtonElement).disabled).toBe(false);
    cleanup();

    const twenty = await board([entry('one')], many.slice(0, INTERVIEW_SUBSTAGES_MAX));
    const second = await openEditor(twenty.user);
    expect((within(second.editor).getByTestId('substage-add') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('copes with duplicate names a merge created: renaming one to a unique name works', async () => {
    const dupes: InterviewSubstage[] = [
      { id: 'x1', name: 'Final', position: 0 },
      { id: 'x2', name: 'final', position: 1 },
    ];
    const { user, port } = await board([entry('one')], dupes);
    const { editor } = await openEditor(user);
    expect(names(editor)).toEqual(['Final', 'final']);

    const second = within(editor).getAllByRole('textbox', { name: /^Name of / })[1]!;
    await user.clear(second);
    await user.type(second, 'Final round{Enter}');

    await waitFor(() => expect(port.substageList()[1]?.name).toBe('Final round'));
  });
});

describe('D1: removing a stage that cards use asks first', () => {
  it('names the count, and Keep leaves everything alone', async () => {
    const { user, port } = await board([entry('one', 'sub-b'), entry('two', 'sub-b')]);
    const { editor } = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));

    expect(within(editor).getByTestId('substage-confirm').textContent).toContain(
      'Remove Technical Test? 2 cards will go back to No stage.',
    );
    await user.click(within(editor).getByRole('button', { name: 'Keep' }));

    expect(within(editor).queryByTestId('substage-confirm')).toBeNull();
    expect(port.calls.saveSubstages).toBe(0);
    expect(port.substageList()).toHaveLength(3);
  });

  it('uses the singular for one card, and Remove then goes ahead', async () => {
    const { user, port } = await board([entry('one', 'sub-b')]);
    const { editor } = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));
    expect(within(editor).getByTestId('substage-confirm').textContent).toContain(
      '1 card will go back to No stage.',
    );
    await user.click(within(editor).getByTestId('substage-confirm-remove'));

    await waitFor(() => expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-c']));
    expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull();
  });

  it('removes straight away when no card uses it', async () => {
    const { user, port } = await board([entry('one', 'sub-a')]);
    const { editor } = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Panel Round' }));

    expect(within(editor).queryByTestId('substage-confirm')).toBeNull();
    await waitFor(() => expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-b']));
  });

  it('Escape cancels the question without closing the pane', async () => {
    const { user, port } = await board([entry('one', 'sub-b')]);
    const { editor } = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));
    await user.keyboard('{Escape}');

    expect(within(editor).queryByTestId('substage-confirm')).toBeNull();
    expect(screen.getByTestId('substage-editor')).toBeTruthy();
    expect(port.calls.saveSubstages).toBe(0);
  });
});

describe('D2: focus', () => {
  it('moves into the pane when the editor opens', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    expect(editor.contains(document.activeElement)).toBe(true);
  });

  it('after Remove, goes to the next row, else the previous, else the new-stage box', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);

    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(editor).getByRole('textbox', { name: 'Name of Panel Round' }),
      ),
    );

    // Last row now: the previous one gets focus.
    await user.click(within(editor).getByRole('button', { name: 'Remove Panel Round' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(editor).getByRole('textbox', { name: 'Name of HR Screen' }),
      ),
    );

    // Only row: the new-stage box.
    await user.click(within(editor).getByRole('button', { name: 'Remove HR Screen' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(within(editor).getByLabelText('New interview stage')),
    );
  });

  it('returns to the Edit stages button that opened it when the pane closes', async () => {
    const { user } = await board([entry('one')]);
    const { opener } = await openEditor(user);

    await user.click(screen.getByTestId('detail-pane-close'));

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('falls back to the column button when the opener was the detail pane (now gone)', async () => {
    const { user } = await board([entry('one')]);
    await user.click(screen.getByTestId('tracker-card-one'));
    await user.click(await screen.findByTestId('detail-edit-substages'));
    await screen.findByTestId('substage-editor');

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('tracker-edit-substages')),
    );
  });
});

describe('D3: errors belong to their box', () => {
  it('a refused add wires aria-invalid and aria-describedby on the new-stage box', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    const box = within(editor).getByLabelText('New interview stage');

    await user.type(box, 'hr screen{Enter}');

    const message = await screen.findByTestId('substage-error');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toContain(message.id);
    // The refused text stays to be corrected.
    expect((box as HTMLInputElement).value).toBe('hr screen');
  });

  it('shows a live count against the name limit', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    const counter = within(editor).getByTestId('substage-count');
    expect(counter.textContent).toBe(`0 / ${INTERVIEW_SUBSTAGE_NAME_MAX}`);

    await user.type(within(editor).getByLabelText('New interview stage'), 'Final');

    expect(counter.textContent).toBe(`5 / ${INTERVIEW_SUBSTAGE_NAME_MAX}`);
  });

  it('a rename the database refuses keeps the draft and says why on that row', async () => {
    const { user, port } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    port.failNext('saveSubstages');

    const input = within(editor).getByRole('textbox', { name: 'Name of HR Screen' });
    await user.clear(input);
    await user.type(input, 'Recruiter Call{Enter}');

    expect((await screen.findByTestId('substage-row-error-sub-a')).textContent).toContain(
      'could not be saved',
    );
    expect((input as HTMLInputElement).value).toBe('Recruiter Call');
  });
});

describe('D4: spoken confirmations, hint, and acting on the right row', () => {
  it('says what happened, politely', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    const status = within(editor).getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    await user.type(within(editor).getByLabelText('New interview stage'), 'Final{Enter}');
    await waitFor(() => expect(status.textContent).toBe('Added Final'));

    await user.click(within(editor).getByRole('button', { name: 'Move Final up' }));
    await waitFor(() => expect(status.textContent).toBe('Moved Final up'));

    const input = within(editor).getByRole('textbox', { name: 'Name of HR Screen' });
    await user.clear(input);
    await user.type(input, 'Recruiter Call{Enter}');
    await waitFor(() => expect(status.textContent).toBe('Renamed to Recruiter Call'));

    await user.click(within(editor).getByRole('button', { name: 'Remove Recruiter Call' }));
    await waitFor(() => expect(status.textContent).toBe('Removed Recruiter Call'));
  });

  it('tells people how to commit and cancel', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    expect(editor.textContent).toContain('Press Enter to save, Escape to cancel.');
  });

  it('clicking Move with an unsaved rename saves it AND moves the row you clicked', async () => {
    const { user, port } = await board([entry('one')]);
    const { editor } = await openEditor(user);

    const input = within(editor).getByRole('textbox', { name: 'Name of Technical Test' });
    await user.clear(input);
    await user.type(input, 'Coding Exercise');
    await user.click(within(editor).getByRole('button', { name: 'Move Technical Test up' }));

    await waitFor(() =>
      expect(port.substageList().map((s) => [s.id, s.name])).toEqual([
        ['sub-b', 'Coding Exercise'],
        ['sub-a', 'HR Screen'],
        ['sub-c', 'Panel Round'],
      ]),
    );
  });
});

describe('D5: touch targets', () => {
  it('gives the arrows a 44px width and lets the row wrap rather than squash the name', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);

    for (const label of ['Move HR Screen up', 'Move HR Screen down']) {
      expect(within(editor).getByRole('button', { name: label }).className).toContain('min-w-11');
    }
    const row = within(editor).getByRole('textbox', { name: 'Name of HR Screen' }).parentElement!;
    expect(row.className).toContain('flex-wrap');
  });
});

describe('D6: the column header button', () => {
  it('says "Edit stages" until there is a stage, then a compact "Stages"', async () => {
    await board([entry('one')], []);
    const empty = await screen.findByTestId('tracker-edit-substages');
    expect(empty.textContent).toBe('Edit stages');
    cleanup();

    await board([entry('one')]);
    const compact = await screen.findByTestId('tracker-edit-substages');
    expect(compact.textContent).toBe('Stages');
    expect(compact.getAttribute('aria-label')).toBe('Edit interview stages');
  });
});

describe('D7: card chip', () => {
  it('is muted, not blue: blue means "act on this"', async () => {
    await board([entry('one', 'sub-a')]);
    const chip = screen.getByTestId('tracker-card-substage-one');
    expect(chip.className).toContain('text-ink-muted');
    expect(chip.className).not.toContain('text-blue');
  });

  it('placeholders are muted ink', async () => {
    const { user } = await board([entry('one')]);
    const { editor } = await openEditor(user);
    expect(within(editor).getByLabelText('New interview stage').className).toContain(
      'placeholder:text-ink-muted',
    );
  });
});

describe('D8: a failed read can be retried', () => {
  it('shows a Retry in the banner, and Retry brings the stages back', async () => {
    const { user, port } = await board([entry('one', 'sub-a')], STAGES, (p) =>
      p.failNext('substages'),
    );

    const banner = await screen.findByTestId('tracker-substages-error');
    expect(banner.textContent).toContain('could not be read');
    expect(screen.queryByTestId('tracker-card-substage-one')).toBeNull();

    await user.click(within(banner).getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.getByTestId('tracker-card-substage-one').textContent).toBe('HR Screen'),
    );
    expect(screen.queryByTestId('tracker-substages-error')).toBeNull();
    expect(port.calls.substages).toBe(2);
  });

  it('the detail pane of an Interviewing card says so, with its own Retry, instead of hiding', async () => {
    const { user } = await board([entry('one')], STAGES, (p) => p.failNext('substages'));
    await screen.findByTestId('tracker-substages-error');

    await user.click(screen.getByTestId('tracker-card-one'));
    const note = await screen.findByTestId('detail-substages-failed');
    expect(note.textContent).toContain("Interview stages couldn't load.");

    await user.click(within(note).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('detail-substage')).toBeTruthy();
  });

  it('a Retry that fails again keeps the banner', async () => {
    const { user, port } = await board([entry('one')], STAGES, (p) => p.failNext('substages'));
    const banner = await screen.findByTestId('tracker-substages-error');
    port.failNext('substages');

    await user.click(within(banner).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(port.calls.substages).toBe(2));
    expect(screen.getByTestId('tracker-substages-error')).toBeTruthy();
  });
});

describe('D9: one word, "stage"', () => {
  it('the editor and its empty state never say "step"', async () => {
    const { user } = await board([entry('one')], []);
    const { editor } = await openEditor(user);

    expect(editor.textContent ?? '').not.toMatch(/\bsteps?\b/i);
    expect(within(editor).getByTestId('substage-empty').textContent).toBe(
      'Add the stages your interviews usually follow, for example “HR Screen”.',
    );
    expect(screen.getByTestId('detail-pane').textContent ?? '').not.toMatch(/\bsteps?\b/i);
  });
});
