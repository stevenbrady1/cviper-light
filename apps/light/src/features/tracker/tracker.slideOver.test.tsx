// @vitest-environment jsdom
/**
 * L-401: on a desktop the Tracker's detail pane floats over the right edge of
 * the board instead of taking 380px from it. The board keeps every class it
 * had with the pane shut; the pane keeps focus while it covers the board.
 * jsdom does no layout, so widths are measured in `e2e/contrast-webkit.spec.ts`.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { type TrackerEntry } from './model';
import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 10, 12, 9, 0, 0);
const STAMP = '2026-11-12T08:00:00.000Z';
const STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected'] as const;

function entry(id: string, status: Application['status']): TrackerEntry {
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
  return {
    job,
    application: {
      id,
      job_id: job.id,
      status,
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: STAMP,
    },
  };
}

const FIVE = STATUSES.map((status) => entry(status, status));

async function renderBoard(entries: readonly TrackerEntry[]) {
  const user = userEvent.setup();
  render(
    <Tracker
      port={createFakeTrackerPort(entries)}
      now={NOW}
      readAvailability={() =>
        Promise.resolve({
          ollamaRunning: false,
          ollamaModels: [],
          anthropicKey: false,
          openaiKey: false,
        })
      }
    />,
  );
  await screen.findByTestId(entries.length === 0 ? 'tracker-empty' : 'tracker-board');
  return user;
}

/** The board, its wrappers up to the view, and every column, as class lists. */
function boardClasses(): string[] {
  const board = screen.getByTestId('tracker-board');
  const view = screen.getByTestId('view-tracker');
  const chain: string[] = [];
  for (let node: HTMLElement | null = board; node !== null && node !== view;) {
    chain.push(node.className);
    node = node.parentElement;
  }
  return [
    ...chain,
    ...STATUSES.map((status) => screen.getByTestId(`tracker-column-${status}`).className),
  ];
}

function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe('the Tracker pane floats over the board (L-401)', () => {
  it('opening a card leaves the board’s classes and all five columns unchanged', async () => {
    const user = await renderBoard(FIVE);
    const closed = boardClasses();

    await user.click(screen.getByTestId('tracker-card-applied'));
    const pane = screen.getByTestId('detail-pane');

    // Only a selected card's own edge changes, and that is on the card.
    expect(boardClasses()).toEqual(closed);
    expect(classesOf(pane)).toEqual(expect.arrayContaining(['md:absolute', 'md:shadow-overlay']));
    // Positioned against the board's row, so it sits below the header and the
    // funnel strip, which are outside that row.
    const row = pane.parentElement;
    expect(row).not.toBeNull();
    expect(classesOf(row!)).toContain('relative');
    expect(row!.contains(screen.getByTestId('tracker-board'))).toBe(true);
    expect(row!.contains(screen.getByTestId('tracker-funnel'))).toBe(false);
    expect(row!.contains(screen.getByTestId('tracker-paste'))).toBe(false);
  });

  it('negative: on an empty board the new-application form sits beside, not over', async () => {
    const user = await renderBoard([]);

    await user.click(screen.getByTestId('tracker-empty-add'));
    const pane = screen.getByTestId('detail-pane');

    expect(screen.getByTestId('new-application-form')).toBeTruthy();
    expect(classesOf(pane)).toContain('md:static');
    expect(classesOf(pane)).not.toContain('md:absolute');
    // Beside: Tab may leave it, as before.
    screen.getByTestId('detail-pane-close').focus();
    await user.tab({ shift: true });
    expect(pane.contains(document.activeElement)).toBe(false);
  });

  it('edge: saving the first application switches the pane to over, and focus stays inside it', async () => {
    const user = await renderBoard([]);
    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(document.getElementById('new-title')!, 'Data Analyst');
    await user.type(document.getElementById('new-company')!, 'Acme');

    await user.click(screen.getByRole('button', { name: /^Save/ }));

    await screen.findByTestId('tracker-board');
    const pane = screen.getByTestId('detail-pane');
    await waitFor(() => expect(classesOf(pane)).toContain('md:absolute'));
    expect(screen.getByRole('heading', { name: 'Data Analyst' })).toBeTruthy();
    expect(pane.contains(document.activeElement)).toBe(true);

    // And it is held there: Tab from Close goes round the pane, never out.
    for (let press = 0; press < 30; press += 1) {
      await user.tab();
      expect(pane.contains(document.activeElement)).toBe(true);
    }
  });

  it('boundary: Escape closes it and focus goes back to the card', async () => {
    const user = await renderBoard(FIVE);
    const card = screen.getByTestId('tracker-card-interviewing');
    await user.click(card);
    expect(screen.getByTestId('detail-pane').contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('detail-pane')).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it('edge: card A, then card B, then Close — focus goes back to A, the card that opened the pane', async () => {
    // The pane stays mounted while its contents change, so the trap keeps the
    // element that had focus when the pane FIRST opened. Pinned as it is.
    const user = await renderBoard(FIVE);
    const first = screen.getByTestId('tracker-card-saved');
    const second = screen.getByTestId('tracker-card-applied');
    await user.click(first);
    await user.click(second);
    expect(screen.getByRole('heading', { name: 'Role applied' })).toBeTruthy();

    await user.click(screen.getByTestId('detail-pane-close'));

    expect(screen.queryByTestId('detail-pane')).toBeNull();
    expect(document.activeElement).toBe(first);
  });
});
