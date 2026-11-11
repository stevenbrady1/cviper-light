// @vitest-environment jsdom
/**
 * Adding and deleting a card change the board AND the side pane in the same
 * instant (L-358).
 *
 * `onCreate` puts the new card on the board and opens its detail pane; `onDelete`
 * takes the card off and closes the pane. Each makes two state updates, and the
 * screen is only right if React draws them together. Drawn apart, adding a card
 * shows it on the board while the "New application" form is still open beside
 * it, and a delete that closed the pane first would show the card with nothing
 * selected for a frame.
 *
 * jsdom has no frames, so this records the page at EVERY commit, through a
 * `Profiler` around the board (React calls `onRender` once per commit, after the
 * DOM has changed), and asserts that no commit ever shows the card without its
 * pane or the pane without its card. Proved by breaking it on purpose: drawing
 * the new card on its own (`flushSync` around its update) turns the adding test
 * red, and closing the pane on its own before the card leaves turns the
 * deleting test red.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 10, 11, 9, 0, 0);

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
      description: null,
      url: null,
      posted_date: null,
      created_at: NOW.toISOString(),
      ...job,
    },
    application,
  };
}

/** What one commit put on the page. */
interface Frame {
  /** A card with this title is in one of the five columns. */
  readonly cardOnBoard: boolean;
  /** The open card's own pane (its notes field) is showing. */
  readonly cardPaneOpen: boolean;
  /** The "New application" form is showing. */
  readonly newFormOpen: boolean;
}

function frameFor(title: string): Frame {
  const cards = document.querySelectorAll(
    '[data-testid^="tracker-column-"] [data-testid^="tracker-card-"]',
  );
  return {
    cardOnBoard: [...cards].some((card) => card.textContent?.includes(title) ?? false),
    cardPaneOpen: document.querySelector('[data-testid="detail-notes"]') !== null,
    newFormOpen: document.querySelector('[data-testid="new-application-form"]') !== null,
  };
}

/** Renders the board and records a frame for `title` at every commit from now on. */
async function renderRecording(entries: readonly TrackerEntry[], title: string) {
  const user = userEvent.setup();
  const frames: Frame[] = [];
  let recording = false;
  const port = createFakeTrackerPort(entries);
  render(
    <Profiler
      id="tracker"
      onRender={() => {
        if (recording) frames.push(frameFor(title));
      }}
    >
      <Tracker port={port} now={NOW} />
    </Profiler>,
  );
  await screen.findByTestId(entries.length === 0 ? 'tracker-empty' : 'tracker-column-saved');
  return {
    user,
    port,
    frames,
    startRecording: () => {
      recording = true;
    },
  };
}

afterEach(() => {
  cleanup();
});

describe('a card and its pane change in the same instant (L-358)', () => {
  it('adding: the new card never shows on the board while the form is still open', async () => {
    const { user, port, frames, startRecording } = await renderRecording([], 'Quant Developer');

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Quant Developer');
    await user.type(screen.getByLabelText('Company'), 'Jane Street');
    startRecording();
    await user.click(screen.getByRole('button', { name: 'Save application' }));
    await screen.findByTestId('detail-notes');

    expect(port.entries()).toHaveLength(1);
    // Not vacuous: the save was seen to happen, from the form to the open card.
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)).toEqual({ cardOnBoard: true, cardPaneOpen: true, newFormOpen: false });
    for (const frame of frames) {
      expect(frame.cardOnBoard).toBe(frame.cardPaneOpen);
      if (frame.cardOnBoard) expect(frame.newFormOpen).toBe(false);
    }
  });

  it('deleting: the pane never closes while the card is still on the board, nor outlives it', async () => {
    const { user, port, frames, startRecording } = await renderRecording(
      [entry('a', { title: 'Quant Developer' }), entry('b')],
      'Quant Developer',
    );

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    startRecording();
    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await screen.findByTestId('tracker-card-b');

    expect(port.entries().map((kept) => kept.application.id)).toEqual(['b']);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.at(-1)).toEqual({ cardOnBoard: false, cardPaneOpen: false, newFormOpen: false });
    for (const frame of frames) {
      expect(frame.cardOnBoard).toBe(frame.cardPaneOpen);
    }
  });

  it('negative: a failed delete changes neither, so the card and its pane both stay', async () => {
    const { user, port, frames, startRecording } = await renderRecording(
      [entry('a', { title: 'Quant Developer' })],
      'Quant Developer',
    );
    port.failNext('remove');

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    startRecording();
    await user.click(screen.getByTestId('confirm-delete-confirm'));
    await screen.findByRole('alert');

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toEqual({ cardOnBoard: true, cardPaneOpen: true, newFormOpen: false });
    }
  });
});
