// @vitest-environment jsdom
/**
 * A job's status as five choices side by side (L-412), driven the way a person
 * drives it: a click or an arrow key, and the STORED status asserted afterwards.
 *
 * It replaced a drop-down. The change handler behind it is the same one, so
 * what follows from a status change (the interview-stage box, the card's
 * column) is tested here only where the control could get it wrong.
 */
import {
  type Application,
  type ApplicationStatus,
  type InterviewSubstage,
  type Job,
} from '@cviper/core-types';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 9, 5, 9, 0, 0);
const STAMP = '2026-10-05T08:00:00.000Z';

/** Typed out on purpose: a test that read the app's own list would agree with it. */
const BOARD_ORDER: readonly ApplicationStatus[] = [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'rejected',
];
const WORDS = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Rejected'];

const STAGES: InterviewSubstage[] = [{ id: 'sub-a', name: 'HR Screen', position: 0 }];

function entry(status: ApplicationStatus, application: Partial<Application> = {}): TrackerEntry {
  const job: Job = {
    id: 'job-a',
    source: 'manual',
    external_id: null,
    title: 'Role a',
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
      id: 'a',
      job_id: job.id,
      status,
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

async function openCard(status: ApplicationStatus, application: Partial<Application> = {}) {
  const user = userEvent.setup();
  const port = createFakeTrackerPort([entry(status, application)], { substages: STAGES });
  render(<Tracker port={port} now={NOW} />);
  await user.click(await screen.findByTestId('tracker-card-a'));
  await screen.findByTestId('detail-status');
  return { user, port };
}

function choice(status: ApplicationStatus): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>(`detail-status-${status}`);
}

function chosen(): string[] {
  return BOARD_ORDER.filter((status) => choice(status).checked);
}

function stored(port: { entries: () => readonly TrackerEntry[] }): ApplicationStatus | undefined {
  return port.entries()[0]?.application.status;
}

afterEach(cleanup);

describe('a job’s status is five choices side by side (L-412)', () => {
  it('is one group named "Status" holding exactly the five statuses, in board order', async () => {
    await openCard('applied');

    const group = screen.getByRole('radiogroup', { name: 'Status' });
    expect(group.getAttribute('data-testid')).toBe('detail-status');
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.getAttribute('data-testid'))).toEqual(
      BOARD_ORDER.map((status) => `detail-status-${status}`),
    );
    expect(radios.map((radio) => radio.value)).toEqual([...BOARD_ORDER]);
    // Each is named by its visible word, the same word the columns use.
    expect(WORDS.map((word) => within(group).getByRole('radio', { name: word }))).toEqual(radios);
    // One group to the browser too: one Tab stop, and the arrow keys move in it.
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    expect(radios[0]?.name).not.toBe('');
  });

  it('is not a drop-down any more', async () => {
    await openCard('applied');

    expect(screen.getByTestId('detail-status').tagName).not.toBe('SELECT');
    expect(screen.getByTestId('detail-pane').querySelector('select')).toBeNull();
  });

  it.each(BOARD_ORDER)('marks the stored status, %s, as the one chosen', async (status) => {
    await openCard(status);

    expect(chosen()).toEqual([status]);
  });

  it('disabled, never hidden: all five are drawn and enabled whatever the status is', async () => {
    await openCard('rejected');

    for (const status of BOARD_ORDER) {
      expect(choice(status).disabled).toBe(false);
      expect(choice(status).hidden).toBe(false);
    }
  });

  it('happy: clicking Offer changes the stored status to offer and marks it chosen', async () => {
    const { user, port } = await openCard('applied');

    await user.click(choice('offer'));

    await waitFor(() => expect(stored(port)).toBe('offer'));
    expect(chosen()).toEqual(['offer']);
    expect(port.calls.saveApplication).toBe(1);
    // The card moved with it, on the board and not only in storage.
    expect(
      within(screen.getByTestId('tracker-column-offer')).getByTestId('tracker-card-a'),
    ).toBeTruthy();
  });

  it('happy: clicking the word, not only the dot, chooses it', async () => {
    const { user, port } = await openCard('saved');

    await user.click(within(screen.getByTestId('detail-status')).getByText('Applied'));

    await waitFor(() => expect(stored(port)).toBe('applied'));
    expect(chosen()).toEqual(['applied']);
  });

  it('keyboard: Right arrow from Applied chooses Interviewing, and saves it', async () => {
    const { user, port } = await openCard('applied');

    choice('applied').focus();
    await user.keyboard('{ArrowRight}');

    await waitFor(() => expect(stored(port)).toBe('interviewing'));
    expect(chosen()).toEqual(['interviewing']);
    expect(document.activeElement).toBe(choice('interviewing'));
  });

  it('keyboard: Left arrow from Applied chooses Saved', async () => {
    const { user, port } = await openCard('applied');

    choice('applied').focus();
    await user.keyboard('{ArrowLeft}');

    await waitFor(() => expect(stored(port)).toBe('saved'));
    expect(chosen()).toEqual(['saved']);
  });

  it('boundary: the first and the last can both be chosen', async () => {
    const { user, port } = await openCard('interviewing');

    await user.click(choice('saved'));
    await waitFor(() => expect(stored(port)).toBe('saved'));

    await user.click(choice('rejected'));
    await waitFor(() => expect(stored(port)).toBe('rejected'));
    expect(chosen()).toEqual(['rejected']);
  });

  it('boundary: Right arrow from Rejected goes round to Saved, and Left from Saved back to Rejected', async () => {
    const { user, port } = await openCard('rejected');

    choice('rejected').focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(stored(port)).toBe('saved'));

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(stored(port)).toBe('rejected'));
    expect(chosen()).toEqual(['rejected']);
  });

  it('negative: clicking the choice that is already chosen changes nothing and saves nothing', async () => {
    // A save would reset the "days since last change" clock for no change.
    const { user, port } = await openCard('applied');

    await user.click(choice('applied'));

    expect(port.calls.saveApplication).toBe(0);
    expect(stored(port)).toBe('applied');
    expect(port.entries()[0]?.application.updated_at).toBe(STAMP);
    expect(chosen()).toEqual(['applied']);
  });

  it('negative: when the save fails, the error shows and the choice goes back to what is stored', async () => {
    const { user, port } = await openCard('applied');

    port.failNext('saveApplication');
    await user.click(choice('offer'));

    expect((await screen.findByTestId('tracker-error')).textContent).toContain(
      'could not be saved',
    );
    expect(stored(port)).toBe('applied');
    await waitFor(() => expect(chosen()).toEqual(['applied']));
    expect(
      within(screen.getByTestId('tracker-column-applied')).getByTestId('tracker-card-a'),
    ).toBeTruthy();
  });

  it('edge: choosing Interviewing shows the interview-stage box, and leaving it hides the box and drops the stage', async () => {
    const { user, port } = await openCard('applied');
    expect(screen.queryByTestId('detail-substage')).toBeNull();

    await user.click(choice('interviewing'));
    const stage = await screen.findByTestId('detail-substage');
    await user.selectOptions(stage, 'HR Screen');
    await waitFor(() => expect(port.entries()[0]?.application.interview_substage_id).toBe('sub-a'));

    await user.click(choice('offer'));
    await waitFor(() => expect(stored(port)).toBe('offer'));
    expect(port.entries()[0]?.application.interview_substage_id ?? null).toBeNull();
    expect(screen.queryByTestId('detail-substage')).toBeNull();
  });
});
