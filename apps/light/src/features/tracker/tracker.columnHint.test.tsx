// @vitest-environment jsdom
/**
 * An empty column says, in one quiet line, what goes there (L-441).
 *
 * The hint is for a board that has started: the big empty-board screen speaks
 * for a board with nothing on it. And while the board's search has text in
 * it, an empty column means "no match", so a hint saying what belongs there
 * would be wrong; none is drawn.
 */
import { type Application, type ApplicationStatus, type Job } from '@cviper/core-types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARD_DRAG_TYPE } from './TrackerCard';
import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { TRACKER_COLUMNS, type TrackerEntry } from './model';

const NOW = new Date(2026, 10, 20, 9, 0, 0);
const STAMP = '2026-11-20T08:00:00.000Z';

/** The owner's words (decision 13), one per column, exactly. */
const HINTS: Record<ApplicationStatus, string> = {
  saved: 'Jobs you might apply for.',
  applied: 'Move a job here once you apply.',
  interviewing: 'Move a job here when you get an interview.',
  offer: 'Move a job here when you get an offer.',
  rejected: 'Jobs that did not work out go here.',
};

function entry(id: string, status: ApplicationStatus): TrackerEntry {
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
    status,
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: STAMP,
  };
  return { job, application };
}

async function renderBoard(entries: readonly TrackerEntry[]) {
  const port = createFakeTrackerPort(entries);
  render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId(entries.length === 0 ? 'tracker-empty' : 'tracker-column-saved');
  return { port };
}

function hint(status: ApplicationStatus): HTMLElement | null {
  return screen.queryByTestId(`tracker-hint-${status}`);
}

function dragCardTo(applicationId: string, status: ApplicationStatus): void {
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

afterEach(cleanup);

describe('an empty column says what goes there (L-441)', () => {
  it('happy: an empty Applied column shows its line, inside that column, small and faint', async () => {
    await renderBoard([entry('a', 'saved')]);

    const line = hint('applied');
    expect(line?.textContent).toBe(HINTS.applied);
    const column = screen.getByTestId('tracker-column-applied');
    expect(within(column).getByTestId('tracker-hint-applied')).toBe(line);
    expect(line?.className.split(' ')).toEqual(
      expect.arrayContaining(['text-xs', 'text-ink-faint']),
    );
  });

  it('every empty column carries the owner’s words, word for word', async () => {
    // One card in Saved: the other four are empty.
    await renderBoard([entry('a', 'saved')]);

    for (const status of TRACKER_COLUMNS.filter((s) => s !== 'saved')) {
      expect(hint(status)?.textContent).toBe(HINTS[status]);
    }
  });

  it('the Interviewing line sits under "Interview stages", before the cards’ list', async () => {
    await renderBoard([entry('a', 'saved')]);

    const column = screen.getByTestId('tracker-column-interviewing');
    const stages = await within(column).findByTestId('tracker-edit-substages');
    const line = within(column).getByTestId('tracker-hint-interviewing');
    const list = column.querySelector('ul');
    if (list === null) throw new Error('no card list in the Interviewing column');

    expect(stages.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('negative: a column with a card shows no hint', async () => {
    await renderBoard([entry('a', 'saved'), entry('b', 'applied')]);

    expect(hint('saved')).toBeNull();
    expect(hint('applied')).toBeNull();
    expect(hint('offer')).not.toBeNull();
  });

  it('negative: an empty board shows the big empty screen and no column hints', async () => {
    await renderBoard([]);

    expect(screen.getByTestId('tracker-empty')).toBeTruthy();
    for (const status of TRACKER_COLUMNS) expect(hint(status)).toBeNull();
  });

  it('negative: a typed board search shows no hints, and clearing it brings them back', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a', 'saved')]);
    const search = screen.getByRole('searchbox', { name: 'Search applications' });

    await user.type(search, 'Role a');
    for (const status of TRACKER_COLUMNS) expect(hint(status)).toBeNull();

    await user.clear(search);
    expect(hint('applied')?.textContent).toBe(HINTS.applied);
  });

  it('negative: nothing inside the board but the five columns has a test id starting `tracker-column-`', async () => {
    // Real-browser checks count columns by that prefix (L-401's `paneLayout`).
    // A hint named `tracker-column-hint-…` once made them count seven.
    await renderBoard([entry('a', 'saved')]);
    expect(hint('offer')).not.toBeNull();

    const board = screen.getByTestId('tracker-board');
    const prefixed = [...board.querySelectorAll('[data-testid^="tracker-column-"]')].map(
      (element) => element.getAttribute('data-testid'),
    );
    expect(prefixed).toEqual(TRACKER_COLUMNS.map((status) => `tracker-column-${status}`));
  });

  it('boundary: spaces alone are not a search, so the hints stay', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a', 'saved')]);

    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), '   ');

    expect(hint('applied')?.textContent).toBe(HINTS.applied);
  });

  it('boundary: a card moved into an empty column removes its hint; the last card leaving brings it back', async () => {
    const { port } = await renderBoard([entry('a', 'saved'), entry('b', 'saved')]);
    expect(hint('offer')).not.toBeNull();
    expect(hint('saved')).toBeNull();

    dragCardTo('a', 'offer');
    await vi.waitFor(() => {
      expect(port.entries().find((e) => e.application.id === 'a')?.application.status).toBe(
        'offer',
      );
    });
    expect(hint('offer')).toBeNull();

    dragCardTo('a', 'applied');
    await vi.waitFor(() => {
      expect(hint('offer')?.textContent).toBe(HINTS.offer);
    });
    expect(hint('applied')).toBeNull();
    // Saved still holds b, so it stays quiet throughout.
    expect(hint('saved')).toBeNull();
  });
});
