// @vitest-environment jsdom
/**
 * The tracker's way into the rest of the flow (L-190): "Analyse this job" and
 * "Tailor my CV" on an application's detail pane.
 *
 * The board does not navigate — the shell owns which view is showing — so each
 * button hands the whole entry back through a prop. These tests press them and
 * assert exactly which entry arrived, and that the buttons do not turn the
 * board into a screen with two blue buttons.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 8, 29, 9, 0, 0);

function entry(id: string, job: Partial<Job> = {}): TrackerEntry {
  const application: Application = {
    id,
    job_id: `job-${id}`,
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW.toISOString(),
  };
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
      description: 'The pasted advert.',
      url: null,
      posted_date: null,
      created_at: NOW.toISOString(),
      ...job,
    },
    application,
  };
}

afterEach(() => {
  cleanup();
});

async function renderBoard(props: {
  onAnalyse?: (entry: TrackerEntry) => void;
  onTailor?: (entry: TrackerEntry) => void;
}) {
  const user = userEvent.setup();
  const entries = [entry('a'), entry('b', { title: 'Credit Risk Analyst' })];
  render(<Tracker port={createFakeTrackerPort(entries)} now={NOW} {...props} />);
  await screen.findByTestId('tracker-column-saved');
  return { user, entries };
}

describe('from an application to the rest of the flow', () => {
  it('"Analyse this job" hands back the entry that is open', async () => {
    const onAnalyse = vi.fn<(entry: TrackerEntry) => void>();
    const { user } = await renderBoard({ onAnalyse, onTailor: vi.fn() });

    await user.click(screen.getByTestId('tracker-card-b'));
    await user.click(await screen.findByTestId('detail-analyse'));

    expect(onAnalyse).toHaveBeenCalledTimes(1);
    expect(onAnalyse.mock.calls[0]?.[0].application.id).toBe('b');
    expect(onAnalyse.mock.calls[0]?.[0].job.title).toBe('Credit Risk Analyst');
  });

  it('"Tailor my CV" hands back the entry that is open', async () => {
    const onTailor = vi.fn<(entry: TrackerEntry) => void>();
    const { user } = await renderBoard({ onAnalyse: vi.fn(), onTailor });

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(await screen.findByTestId('detail-tailor'));

    expect(onTailor).toHaveBeenCalledTimes(1);
    expect(onTailor.mock.calls[0]?.[0].job.id).toBe('job-a');
  });

  it('switching cards hands back the NEW card, not the one opened first', async () => {
    const onAnalyse = vi.fn<(entry: TrackerEntry) => void>();
    const { user } = await renderBoard({ onAnalyse, onTailor: vi.fn() });

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('tracker-card-b'));
    await user.click(await screen.findByTestId('detail-analyse'));

    expect(onAnalyse.mock.calls[0]?.[0].application.id).toBe('b');
  });

  it('adds no primary button: the board keeps exactly one', async () => {
    const { user } = await renderBoard({ onAnalyse: vi.fn(), onTailor: vi.fn() });

    await user.click(screen.getByTestId('tracker-card-a'));
    await screen.findByTestId('detail-analyse');

    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(1);
  });

  it('negative: with nowhere to go, neither button is drawn', async () => {
    const { user } = await renderBoard({});

    await user.click(screen.getByTestId('tracker-card-a'));
    await screen.findByTestId('detail-status');

    expect(screen.queryByTestId('detail-analyse')).toBeNull();
    expect(screen.queryByTestId('detail-tailor')).toBeNull();
  });
});
