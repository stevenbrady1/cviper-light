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
    expect(
      (within(editor).getByRole('button', { name: 'Remove Technical Test' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(editor).getByRole('button', { name: 'Move Panel Round up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

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

describe('C3: Enter then blur commits a rename once', () => {
  it('saves once, not twice', async () => {
    const port = createFakeTrackerPort([entry('one', null)], { substages: STAGES });
    const { user, editor } = await openEditor(port);
    const save = vi.spyOn(port, 'saveSubstages');

    const input = within(editor).getByRole('textbox', { name: 'Name of HR Screen' });
    await user.clear(input);
    await user.type(input, 'Recruiter Call{Enter}');
    await user.tab();

    await waitFor(() => expect(port.substageList()[0]?.name).toBe('Recruiter Call'));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
