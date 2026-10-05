// @vitest-environment jsdom
/**
 * Sub-stage saves are serial, and a failed one re-reads the database instead of
 * restoring a snapshot (L-205, review items C2 and C3).
 *
 * The bug this guards: two overlapping saves, the first failing and the second
 * succeeding. A snapshot rollback then showed a stale list, and the NEXT edit's
 * `DELETE ... NOT IN` removed real stages (and cleared them from cards).
 */
import { err, type Application, type InterviewSubstage, type Job } from '@cviper/core-types';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function entry(id: string, substage: string | null): TrackerEntry {
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

const FAILURE = { code: 'QUERY_FAILED' as const, message: 'database is locked', table: null };

async function openEditor(port: ReturnType<typeof createFakeTrackerPort>) {
  const user = userEvent.setup();
  render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId('tracker-column-interviewing');
  await waitFor(() => expect(screen.getByTestId('tracker-edit-substages')).toBeTruthy());
  await user.click(screen.getByTestId('tracker-edit-substages'));
  return { user, editor: await screen.findByTestId('substage-editor') };
}

afterEach(cleanup);

describe('C2: one sub-stage save at a time', () => {
  it('disables the editor while a save is pending, and a failed save re-reads the truth', async () => {
    const port = createFakeTrackerPort([entry('one', 'sub-c')], { substages: STAGES });
    let fail!: () => void;
    vi.spyOn(port, 'saveSubstages').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = () => resolve(err(FAILURE));
        }),
    );
    const { user, editor } = await openEditor(port);
    const readsBefore = port.calls.substages;
    const loadsBefore = port.calls.load;

    // An unused stage, so no confirmation stands in the way.
    await user.click(within(editor).getByRole('button', { name: 'Remove HR Screen' }));

    // While it is in flight nothing else can be started.
    await waitFor(() => expect(editor.getAttribute('aria-busy')).toBe('true'));
    // Busy, not gone: aria-disabled keeps keyboard focus where it is.
    for (const name of ['Remove Technical Test', 'Move Panel Round up']) {
      expect(within(editor).getByRole('button', { name }).getAttribute('aria-disabled')).toBe(
        'true',
      );
    }

    fail();

    expect((await screen.findByTestId('substage-error')).textContent).toContain(
      'could not be saved',
    );
    await waitFor(() => expect(editor.getAttribute('aria-busy')).not.toBe('true'));
    // Re-read both the stages and the cards, rather than trusting a snapshot.
    expect(port.calls.substages).toBeGreaterThan(readsBefore);
    expect(port.calls.load).toBeGreaterThan(loadsBefore);
    expect(
      within(editor)
        .getAllByRole('textbox', { name: /^Name of / })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['HR Screen', 'Technical Test', 'Panel Round']);

    // The NEXT edit must not delete anything it was not asked to.
    await user.click(within(editor).getByRole('button', { name: 'Remove Technical Test' }));
    await waitFor(() => expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-c']));
    expect(port.entries()[0]?.application.interview_substage_id).toBe('sub-c');
  });

  it('shows what the database holds when the failed save had in fact half-landed', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const real = port.saveSubstages.bind(port);
    vi.spyOn(port, 'saveSubstages').mockImplementationOnce(async (next) => {
      // The write lands, then the answer is lost.
      await real(next);
      return err(FAILURE);
    });
    const { user, editor } = await openEditor(port);

    await user.click(within(editor).getByRole('button', { name: 'Remove HR Screen' }));

    await screen.findByTestId('substage-error');
    // The screen matches the database, not the pre-edit snapshot.
    await waitFor(() =>
      expect(
        within(editor)
          .getAllByRole('textbox', { name: /^Name of / })
          .map((input) => (input as HTMLInputElement).value),
      ).toEqual(port.substageList().map((s) => s.name)),
    );
  });
});

describe('C3: Enter then blur while the save is pending', () => {
  it('Enter then blur while the save is pending, and the save fails: one save, the draft survives', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    let fail!: () => void;
    const save = vi.spyOn(port, 'saveSubstages').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = () => resolve(err(FAILURE));
        }),
    );
    const { user, editor } = await openEditor(port);
    const input = within(editor).getByRole('textbox', { name: 'Name of HR Screen' });
    await user.clear(input);
    await user.type(input, 'Recruiter Call{Enter}');
    await user.tab(); // blur WHILE the save is pending
    fail();
    await waitFor(() => expect(editor.getAttribute('aria-busy')).not.toBe('true'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(
      (within(editor).getAllByRole('textbox', { name: /^Name of / })[0] as HTMLInputElement).value,
    ).toBe('Recruiter Call');
  });
});

describe('focus is never dropped by a busy control (WCAG 2.4.3)', () => {
  function hold(port: ReturnType<typeof createFakeTrackerPort>) {
    const real = port.saveSubstages.bind(port);
    let release!: () => void;
    const spy = vi.spyOn(port, 'saveSubstages').mockImplementationOnce(
      (next) =>
        new Promise((resolve) => {
          release = () => resolve(real(next));
        }),
    );
    return { release: () => release(), spy };
  }

  it('Enter on a move arrow keeps focus on it while saving, then on the same arrow', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { release } = hold(port);
    const { user, editor } = await openEditor(port);

    const down = within(editor).getByRole('button', { name: 'Move HR Screen down' });
    down.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(editor.getAttribute('aria-busy')).toBe('true'));
    expect(document.activeElement).toBe(down);
    expect(down.getAttribute('aria-disabled')).toBe('true');

    release();
    await waitFor(() => expect(editor.getAttribute('aria-busy')).not.toBe('true'));
    expect(document.activeElement).toBe(
      within(editor).getByRole('button', { name: 'Move HR Screen down' }),
    );
    expect(port.substageList().map((s) => s.id)).toEqual(['sub-b', 'sub-a', 'sub-c']);
  });

  it('a busy arrow ignores a second Enter instead of starting another save', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { release, spy } = hold(port);
    const { user, editor } = await openEditor(port);

    const down = within(editor).getByRole('button', { name: 'Move HR Screen down' });
    down.focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');

    expect(spy).toHaveBeenCalledTimes(1);
    release();
  });

  it("when the move leaves the arrow at an end, focus goes to that row's name box", async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { user, editor } = await openEditor(port);

    const down = within(editor).getByRole('button', { name: 'Move Technical Test down' });
    down.focus();
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(port.substageList().map((s) => s.id)).toEqual(['sub-a', 'sub-c', 'sub-b']),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(editor).getByRole('textbox', { name: 'Name of Technical Test' }),
      ),
    );
  });

  it('Enter on Remove keeps focus on it while the save is pending', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { release } = hold(port);
    const { user, editor } = await openEditor(port);

    const remove = within(editor).getByRole('button', { name: 'Remove HR Screen' });
    remove.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(editor.getAttribute('aria-busy')).toBe('true'));
    expect(document.activeElement).not.toBe(document.body);
    release();
    await waitFor(() => expect(editor.getAttribute('aria-busy')).not.toBe('true'));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('a failed save whose re-read also fails (double failure)', () => {
  it('blocks editing until Retry succeeds, instead of trusting an old list', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    vi.spyOn(port, 'saveSubstages').mockImplementationOnce(async () => {
      // The re-read that follows this failure fails too.
      port.failNext('substages');
      return err(FAILURE);
    });
    const { user, editor } = await openEditor(port);

    await user.click(within(editor).getByRole('button', { name: 'Remove HR Screen' }));

    const banner = await screen.findByTestId('tracker-substages-error');
    expect(screen.queryByTestId('substage-editor')).toBeNull();
    expect(screen.getByTestId('substage-blocked')).toBeTruthy();
    expect(screen.queryByTestId('tracker-edit-substages')).toBeNull();

    await user.click(within(banner).getByRole('button', { name: 'Retry' }));

    const back = await screen.findByTestId('substage-editor');
    expect(
      within(back)
        .getAllByRole('textbox', { name: /^Name of / })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['HR Screen', 'Technical Test', 'Panel Round']);
  });
});

describe('small things', () => {
  it('rename boxes stop at the name limit', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { editor } = await openEditor(port);
    for (const input of within(editor).getAllByRole('textbox', { name: /^Name of / })) {
      expect(input.getAttribute('maxlength')).toBe('40');
    }
  });

  it('an identical announcement twice in a row is a fresh one', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { user, editor } = await openEditor(port);
    const region = within(editor).getByRole('status');

    await user.click(within(editor).getByRole('button', { name: 'Move HR Screen down' }));
    await waitFor(() => expect(region.textContent).toBe('Moved HR Screen down'));
    const first = within(region).getByTestId('substage-status-text');

    await user.click(within(editor).getByRole('button', { name: 'Move HR Screen down' }));
    await waitFor(() =>
      expect(port.substageList().map((s) => s.id)).toEqual(['sub-b', 'sub-c', 'sub-a']),
    );
    expect(region.textContent).toBe('Moved HR Screen down');
    // A new node, so a screen reader announces it again.
    expect(within(region).getByTestId('substage-status-text')).not.toBe(first);
  });

  it('the Enter/Escape hint is attached to the first row only', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { editor } = await openEditor(port);
    const inputs = within(editor).getAllByRole('textbox', { name: /^Name of / });
    expect(inputs[0]?.getAttribute('aria-describedby')).toContain('substage-hint');
    expect(inputs[1]?.getAttribute('aria-describedby')).toBeNull();
    expect(inputs[2]?.getAttribute('aria-describedby')).toBeNull();
  });
});
