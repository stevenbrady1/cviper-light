// @vitest-environment jsdom
/**
 * The board, driven the way a user drives it.
 *
 * Every test here goes through the real components: real clicks, real drags,
 * real typing, and a side effect asserted afterwards. Nothing asserts that a
 * component rendered — a render-only test would pass just as happily on a board
 * where nothing worked.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOSAVE_DELAY_MS } from './ApplicationDetail';
import { CARD_DRAG_TYPE } from './TrackerCard';
import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { type TrackerEntry } from './model';

/** A fixed clock, so every age and due date on the board is deterministic. */
const NOW = new Date(2026, 7, 19, 9, 0, 0);

function daysAgo(days: number): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function entry(
  id: string,
  application: Partial<Application> = {},
  job: Partial<Job> = {},
): TrackerEntry {
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
      created_at: daysAgo(0),
      ...job,
    },
    application: {
      id,
      job_id: `job-${id}`,
      status: 'saved',
      applied_date: null,
      notes: null,
      next_action: null,
      next_action_date: null,
      updated_at: daysAgo(0),
      ...application,
    },
  };
}

async function renderBoard(entries: readonly TrackerEntry[] = []) {
  const port = createFakeTrackerPort(entries);
  const view = render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId(entries.length === 0 ? 'tracker-empty' : 'tracker-column-saved');
  return { port, view };
}

/** Drag a card onto a column, the way the browser would. */
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the empty board', () => {
  it('shows a retry on load failure, without inviting new work', async () => {
    const port = createFakeTrackerPort([entry('stored')]);
    port.failNext('load');

    render(<Tracker port={port} now={NOW} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('database is locked');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByTestId('tracker-empty')).toBeNull();
    expect(screen.queryByTestId('tracker-empty-add')).toBeNull();
    expect(screen.queryByTestId('tracker-add')).toBeNull();
    expect(screen.queryByTestId('tracker-paste')).toBeNull();
  });

  it('retries the read and shows the returned cards without writing', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort([entry('stored')]);
    port.failNext('load');

    render(<Tracker port={port} now={NOW} />);

    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('tracker-column-saved')).toBeTruthy();
    expect(screen.getByTestId('tracker-card-stored')).toBeTruthy();
    expect(port.calls.load).toBe(2);
    expect(port.calls.create).toBe(0);
    expect(port.calls.saveApplication).toBe(0);
    expect(port.calls.remove).toBe(0);
    expect(port.calls.saveDocument).toBe(0);
  });

  it('disables retry while its read is in flight', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort([entry('stored')]);
    port.failNext('load');

    render(<Tracker port={port} now={NOW} />);

    await screen.findByRole('alert');
    let finishLoad!: (result: Awaited<ReturnType<typeof port.load>>) => void;
    const load = vi.spyOn(port, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    const retry = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    await user.click(retry);
    expect(load).toHaveBeenCalledTimes(1);

    finishLoad(await createFakeTrackerPort([entry('stored')]).load());
    expect(await screen.findByTestId('tracker-card-stored')).toBeTruthy();
  });

  it('keeps retry available after a retry failure and does not write', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort([entry('stored')]);
    port.failNext('load');

    render(<Tracker port={port} now={NOW} />);

    await screen.findByRole('alert');
    port.failNext('load');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('database is locked');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByTestId('tracker-empty')).toBeNull();
    expect(port.calls.load).toBe(2);
    expect(port.calls.create).toBe(0);
    expect(port.calls.saveApplication).toBe(0);
    expect(port.calls.remove).toBe(0);
    expect(port.calls.saveDocument).toBe(0);
  });

  it('invites the user to act instead of apologising', async () => {
    await renderBoard();

    const empty = screen.getByTestId('tracker-empty');
    expect(empty.textContent).toContain('Start with the last job you applied to');
    // Not "no applications found", and no mention of anything being wrong.
    expect(empty.textContent).not.toMatch(/no applications|nothing (found|here)|sorry/i);
  });

  it('says the board needs no account and no key', async () => {
    await renderBoard();

    expect(screen.getByTestId('tracker-empty').textContent).toContain('no API key');
  });

  it('opens the form from the empty state', async () => {
    const user = userEvent.setup();
    await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));

    expect(screen.getByTestId('new-application-form')).toBeTruthy();
  });
});

describe('one blue button', () => {
  it('shows exactly one primary button when the board is empty', async () => {
    await renderBoard();

    expect(screen.queryAllByTestId('tracker-add')).toEqual([]);
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('shows exactly one primary button when the board has cards', async () => {
    await renderBoard([entry('a')]);

    expect(screen.queryAllByTestId('tracker-empty-add')).toEqual([]);
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('never leaves two primary buttons ENABLED at once, even mid-flow', async () => {
    // Opening the add form introduces a second primary (the form's Save), so
    // the one that opened it goes disabled. Two enabled blue buttons on one
    // screen is the thing that stops blue meaning anything.
    const user = userEvent.setup();
    await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-add'));

    const enabled = [...document.querySelectorAll('[data-primary="true"]')].filter(
      (button) => !(button as HTMLButtonElement).disabled,
    );
    expect(enabled).toHaveLength(1);
    expect((screen.getByTestId('tracker-add') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('adding an application', () => {
  it('writes it, puts it on the board and selects it', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Quant Developer');
    await user.type(screen.getByLabelText('Company'), 'Jane Street');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    await screen.findByTestId('tracker-column-saved');
    expect(port.entries()).toHaveLength(1);
    expect(port.entries()[0]?.job.title).toBe('Quant Developer');

    // Straight into the detail pane, because the next thing a user wants is to
    // note what happens next while it is still in their head.
    expect(await screen.findByTestId('detail-notes')).toBeTruthy();
  });

  it('lands the card in the column the user chose', async () => {
    const user = userEvent.setup();
    await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Risk Analyst');
    await user.type(screen.getByLabelText('Company'), 'Barclays');
    await user.selectOptions(screen.getByLabelText('Status'), 'interviewing');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    const column = await screen.findByTestId('tracker-column-interviewing');
    expect(within(column).getByText('Risk Analyst')).toBeTruthy();
  });

  it('negative: refuses an empty title and writes nothing', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Company'), 'Jane Street');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    expect(screen.getByText(/Add a job title/)).toBeTruthy();
    expect(port.calls.create).toBe(0);
    expect(screen.getByTestId('new-application-form')).toBeTruthy();
  });

  it('negative: says nothing about errors before the user has tried', async () => {
    // Telling somebody their title is empty while they are still typing it is
    // both true and useless.
    const user = userEvent.setup();
    await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Q');

    expect(screen.queryByText(/Add a job title/)).toBeNull();
    expect(screen.queryByText(/Add the company/)).toBeNull();
  });

  it('boundary: accepts a title at the length limit', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard();
    const longest = 'x'.repeat(200);

    await user.click(screen.getByTestId('tracker-empty-add'));
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: longest } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    expect(port.entries()).toHaveLength(1);
  });

  it('boundary: refuses a title one character past the limit', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard();

    await user.click(screen.getByTestId('tracker-empty-add'));
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'x'.repeat(201) } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'Acme' } });
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    expect(screen.getByText(/too long/)).toBeTruthy();
    expect(port.calls.create).toBe(0);
  });

  it('negative: says so, and keeps the form, when the write fails', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard();
    port.failNext('create');

    await user.click(screen.getByTestId('tracker-empty-add'));
    await user.type(screen.getByLabelText('Job title'), 'Quant Developer');
    await user.type(screen.getByLabelText('Company'), 'Jane Street');
    await user.click(screen.getByRole('button', { name: 'Save application' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
    // What happened, and what to do about it.
    expect(alert.textContent).toContain('Try again');
    expect(port.entries()).toHaveLength(0);
  });
});

describe('the staleness edge', () => {
  it('bands every card by how long it has sat still', async () => {
    await renderBoard([
      entry('fresh', { updated_at: daysAgo(2) }),
      entry('steady', { updated_at: daysAgo(14) }),
      entry('quiet', { updated_at: daysAgo(30) }),
      entry('cold', { updated_at: daysAgo(90) }),
    ]);

    expect(screen.getByTestId('tracker-card-fresh').dataset['staleness']).toBe('moving');
    expect(screen.getByTestId('tracker-card-steady').dataset['staleness']).toBe('neutral');
    expect(screen.getByTestId('tracker-card-quiet').dataset['staleness']).toBe('quiet');
    expect(screen.getByTestId('tracker-card-cold').dataset['staleness']).toBe('cold');
  });

  it('boundary: 6 days is still moving and 7 has gone neutral, on the real card', async () => {
    // The pure function has its own boundary tests. This one proves the card is
    // actually wired to it — a correct function nobody calls is worth nothing.
    await renderBoard([
      entry('six', { updated_at: daysAgo(6) }),
      entry('seven', { updated_at: daysAgo(7) }),
    ]);

    expect(screen.getByTestId('tracker-card-six').dataset['staleness']).toBe('moving');
    expect(screen.getByTestId('tracker-card-seven').dataset['staleness']).toBe('neutral');
  });

  it('says the age in words too, so the colour is never the only telling', async () => {
    await renderBoard([entry('a', { updated_at: daysAgo(30) })]);

    expect(screen.getByTestId('tracker-card-a').getAttribute('aria-label')).toContain(
      'Last changed 30 days ago',
    );
  });

  it('shows the named agency as recruiter context without replacing the company', async () => {
    await renderBoard([
      entry('agency', {}, { company: 'Lloyds Banking Group', agency: 'Harrington Search' }),
    ]);

    const card = screen.getByTestId('tracker-card-agency');
    expect(card.textContent).toContain('Lloyds Banking Group');
    expect(card.textContent).toContain('via Harrington Search');
    expect(card.textContent).toContain('London');
  });
});

describe('the next action chip', () => {
  it('turns gold within three days and red once it is overdue', async () => {
    await renderBoard([
      entry('soon', { next_action_date: '2026-08-21' }),
      entry('late', { next_action_date: '2026-08-18' }),
      entry('later', { next_action_date: '2026-09-30' }),
    ]);

    expect(screen.getByTestId('tracker-card-due-soon').dataset['urgency']).toBe('soon');
    expect(screen.getByTestId('tracker-card-due-late').dataset['urgency']).toBe('overdue');
    expect(screen.getByTestId('tracker-card-due-later').dataset['urgency']).toBe('later');
  });

  it('boundary: due today is soon, not overdue', async () => {
    await renderBoard([entry('today', { next_action_date: '2026-08-19' })]);

    expect(screen.getByTestId('tracker-card-due-today').dataset['urgency']).toBe('soon');
  });

  it('reads as words: the action, then when it is due — never a bare ISO date (L-175)', async () => {
    await renderBoard([
      entry('soon', { next_action: 'Reply by Friday', next_action_date: '2026-08-21' }),
      entry('bare', { next_action: null, next_action_date: '2026-08-18' }),
    ]);

    expect(screen.getByTestId('tracker-card-due-soon').textContent).toBe(
      'Reply by Friday · due in 2 days',
    );
    expect(screen.getByTestId('tracker-card-due-bare').textContent).toBe('1 day overdue');
    for (const id of ['soon', 'bare']) {
      expect(screen.getByTestId(`tracker-card-${id}`).textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it('boundary: a long action is the part that clips — the due never does', async () => {
    await renderBoard([
      entry('long', {
        next_action: 'Send the portfolio link and the two references they asked for',
        next_action_date: '2026-08-19',
      }),
    ]);

    // jsdom cannot measure, so pin the classes. The first cut clipped the whole
    // line, and on a real card "due today" — the part that matters — was the
    // bit that vanished. Now only the action shrinks; the due holds its width.
    const line = screen.getByTestId('tracker-card-due-long');
    expect(line.className).toContain('min-w-0');
    const action = within(line).getByTestId('tracker-card-due-action-long');
    const when = within(line).getByTestId('tracker-card-due-when-long');
    expect(action.className).toContain('truncate');
    expect(when.className).toContain('shrink-0');
    expect(when.className).not.toContain('truncate');
    expect(when.textContent).toBe('due today');
  });

  it('shows no chip at all when there is no next action', async () => {
    await renderBoard([entry('a')]);

    expect(screen.queryByTestId('tracker-card-due-a')).toBeNull();
  });
});

describe('the column headers', () => {
  it('count what is in them, in the mono face', async () => {
    await renderBoard([
      entry('a', { status: 'applied' }),
      entry('b', { status: 'applied' }),
      entry('c', { status: 'offer' }),
    ]);

    expect(screen.getByTestId('tracker-count-applied').textContent).toBe('2');
    expect(screen.getByTestId('tracker-count-offer').textContent).toBe('1');
    expect(screen.getByTestId('tracker-count-saved').textContent).toBe('0');
    expect(screen.getByTestId('tracker-count-applied').className).toContain('font-mono');
    expect(screen.getByTestId('tracker-count-applied').className).toContain('tabular-nums');
  });

  it('shows all five columns even when four are empty', async () => {
    await renderBoard([entry('a')]);

    for (const status of ['saved', 'applied', 'interviewing', 'offer', 'rejected']) {
      expect(screen.getByTestId(`tracker-column-${status}`)).toBeTruthy();
    }
  });
});

describe('quick search', () => {
  it('matches the job title, company, agency, and location', async () => {
    const user = userEvent.setup();
    await renderBoard([
      entry('title', {}, { title: 'Platform Engineer', company: 'Aster' }),
      entry('company', {}, { title: 'Product Designer', company: 'Northstar' }),
      entry('agency', {}, { title: 'Data Analyst', company: 'Harbor', agency: 'BrightHire' }),
      entry('location', {}, { title: 'Researcher', company: 'Elm', location: 'Manchester' }),
    ]);
    const search = screen.getByRole('searchbox', { name: 'Search applications' });

    for (const [query, match] of [
      ['Platform', 'title'],
      ['Northstar', 'company'],
      ['BrightHire', 'agency'],
      ['Manchester', 'location'],
    ] as const) {
      await user.clear(search);
      await user.type(search, query);
      expect(screen.getByTestId(`tracker-card-${match}`)).toBeTruthy();
      for (const id of ['title', 'company', 'agency', 'location']) {
        if (id !== match) expect(screen.queryByTestId(`tracker-card-${id}`)).toBeNull();
      }
    }
  });

  it('ignores query letter case and trims leading and trailing spaces', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('match', {}, { company: 'Northstar' }), entry('other')]);

    await user.type(
      screen.getByRole('searchbox', { name: 'Search applications' }),
      '  NORTHSTAR  ',
    );

    expect(screen.getByTestId('tracker-card-match')).toBeTruthy();
    expect(screen.queryByTestId('tracker-card-other')).toBeNull();
  });

  it('shows no results while retaining all five empty columns', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a')]);

    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'not found');

    expect(screen.getByTestId('tracker-search-no-results').textContent).toContain(
      'No applications match',
    );
    for (const status of ['saved', 'applied', 'interviewing', 'offer', 'rejected']) {
      expect(screen.getByTestId(`tracker-column-${status}`)).toBeTruthy();
      expect(screen.getByTestId(`tracker-count-${status}`).textContent).toBe('0');
    }
    expect(screen.queryByTestId('tracker-card-a')).toBeNull();
  });

  it('clears the query, restores cards, and does not write to storage', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([
      entry('match', {}, { title: 'Platform Engineer' }),
      entry('other', {}, { title: 'Product Designer' }),
    ]);
    const search = screen.getByRole('searchbox', { name: 'Search applications' });
    await user.type(search, 'Platform');
    expect(screen.queryByTestId('tracker-card-other')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('tracker-card-match')).toBeTruthy();
    expect(screen.getByTestId('tracker-card-other')).toBeTruthy();
    expect(port.calls.create).toBe(0);
    expect(port.calls.saveApplication).toBe(0);
    expect(port.calls.remove).toBe(0);
  });
});

describe('moving a card by dragging it', () => {
  it('moves it to the new column and saves it', async () => {
    const { port } = await renderBoard([entry('a')]);

    dragCardTo('a', 'interviewing');

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.status).toBe('interviewing');
    });
    const column = screen.getByTestId('tracker-column-interviewing');
    expect(within(column).getByTestId('tracker-card-a')).toBeTruthy();
  });

  it('counts the move as movement, so the card reads as fresh again', async () => {
    // The staleness edge measures the last change. A move that left the
    // timestamp alone would show a card as cold seconds after it was dragged.
    const { port } = await renderBoard([entry('a', { updated_at: daysAgo(90) })]);
    expect(screen.getByTestId('tracker-card-a').dataset['staleness']).toBe('cold');

    dragCardTo('a', 'applied');

    await vi.waitFor(() => {
      expect(screen.getByTestId('tracker-card-a').dataset['staleness']).toBe('moving');
    });
    expect(port.entries()[0]?.application.applied_date).not.toBeNull();
  });

  it('plays the one motion moment on the card that moved, and on nothing else', async () => {
    await renderBoard([entry('a'), entry('b')]);

    dragCardTo('a', 'offer');

    await vi.waitFor(() => {
      expect(screen.getByTestId('tracker-card-a').className).toContain('cviper-card-settle');
    });
    expect(screen.getByTestId('tracker-card-b').className).not.toContain('cviper-card-settle');
  });

  it('negative: a drop back into the same column writes nothing', async () => {
    const { port } = await renderBoard([entry('a', { status: 'applied' })]);

    dragCardTo('a', 'applied');

    expect(port.calls.saveApplication).toBe(0);
  });

  it('negative: puts the card back and says so when the write fails', async () => {
    // The board is optimistic, which is right — but an optimistic update that
    // never admits it failed is just a lie with a nice animation.
    const { port } = await renderBoard([entry('a')]);
    port.failNext('saveApplication');

    dragCardTo('a', 'offer');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('could not be saved');
    await vi.waitFor(() => {
      const column = screen.getByTestId('tracker-column-saved');
      expect(within(column).getByTestId('tracker-card-a')).toBeTruthy();
    });
  });

  it('negative: ignores a drag carrying something that is not one of our cards', async () => {
    const { port } = await renderBoard([entry('a')]);

    const column = screen.getByTestId('tracker-column-offer');
    fireEvent.drop(column, {
      dataTransfer: { types: ['text/plain'], getData: () => '', setData: () => {} },
    });

    expect(port.calls.saveApplication).toBe(0);
  });
});

describe('the detail pane', () => {
  it('opens on the card that was clicked and shows its details', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a', {}, { title: 'Quant Developer', company: 'Jane Street' })]);

    await user.click(screen.getByTestId('tracker-card-a'));

    const pane = screen.getByTestId('detail-pane');
    expect(within(pane).getByRole('heading', { name: 'Quant Developer' })).toBeTruthy();
    expect(pane.textContent).toContain('Jane Street');
  });

  it('swaps its contents when another card is selected, without closing', async () => {
    // The whole reason it is a pane and not a modal.
    const user = userEvent.setup();
    await renderBoard([entry('a', {}, { title: 'Role A' }), entry('b', {}, { title: 'Role B' })]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('tracker-card-b'));

    expect(
      within(screen.getByTestId('detail-pane')).getByRole('heading', { name: 'Role B' }),
    ).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    expect(screen.getByTestId('detail-pane')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });

  it('changes status from the keyboard, without any dragging', async () => {
    // Drag-and-drop is faster with a mouse and impossible without one.
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.selectOptions(screen.getByTestId('detail-status'), 'rejected');

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.status).toBe('rejected');
    });
  });

  it('sets a next action and a due date', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    fireEvent.change(screen.getByTestId('detail-next-action-date'), {
      target: { value: '2026-08-18' },
    });

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.next_action_date).toBe('2026-08-18');
    });
    // Overdue, and it says what to do about it rather than only colouring it.
    expect(await screen.findByTestId('detail-overdue')).toBeTruthy();
  });

  it('boundary: clearing the due date is a real edit, not a no-op', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a', { next_action_date: '2026-09-01' })]);

    await user.click(screen.getByTestId('tracker-card-a'));
    fireEvent.change(screen.getByTestId('detail-next-action-date'), { target: { value: '' } });

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.next_action_date).toBeNull();
    });
  });
});

describe('notes autosave', () => {
  it('saves shortly after the user stops typing', async () => {
    vi.useFakeTimers();
    const port = createFakeTrackerPort([entry('a')]);
    render(<Tracker port={port} now={NOW} />);
    await vi.waitFor(() => expect(screen.getByTestId('tracker-card-a')).toBeTruthy());

    fireEvent.click(screen.getByTestId('tracker-card-a'));
    fireEvent.change(screen.getByTestId('detail-notes'), { target: { value: 'Called Priya' } });

    // Nothing yet — this is a debounce, not a keystroke-per-write.
    expect(port.calls.saveApplication).toBe(0);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(port.entries()[0]?.application.notes).toBe('Called Priya');
  });

  it('saves the last thing typed when the user clicks straight onto another card', async () => {
    // The bug every debounced field has: React clears the pending timer on
    // unmount and the last thing typed is silently gone.
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a'), entry('b')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    fireEvent.change(screen.getByTestId('detail-notes'), { target: { value: 'Do not lose me' } });
    await user.click(screen.getByTestId('tracker-card-b'));

    await vi.waitFor(() => {
      const saved = port.entries().find((candidate) => candidate.application.id === 'a');
      expect(saved?.application.notes).toBe('Do not lose me');
    });
  });

  it('boundary: emptying the notes stores null, not an empty string', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a', { notes: 'something' })]);

    await user.click(screen.getByTestId('tracker-card-a'));
    fireEvent.change(screen.getByTestId('detail-notes'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByTestId('detail-notes'));

    await vi.waitFor(() => {
      expect(port.entries()[0]?.application.notes).toBeNull();
    });
  });

  it('negative: does not write on every keystroke', async () => {
    vi.useFakeTimers();
    const port = createFakeTrackerPort([entry('a')]);
    render(<Tracker port={port} now={NOW} />);
    await vi.waitFor(() => expect(screen.getByTestId('tracker-card-a')).toBeTruthy());

    fireEvent.click(screen.getByTestId('tracker-card-a'));
    for (const text of ['C', 'Ca', 'Cal', 'Call']) {
      fireEvent.change(screen.getByTestId('detail-notes'), { target: { value: text } });
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);

    expect(port.calls.saveApplication).toBe(1);
    expect(port.entries()[0]?.application.notes).toBe('Call');
  });
});

describe('deleting an application', () => {
  it('asks first, naming the card', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([
      entry('a', {}, { title: 'Quant Developer', company: 'Jane Street' }),
    ]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));

    const dialog = screen.getByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Quant Developer');
    expect(dialog.textContent).toContain('Jane Street');
    expect(port.calls.remove).toBe(0);
  });

  it('puts focus on the safe button, so a stray Enter deletes nothing', async () => {
    const user = userEvent.setup();
    await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));

    expect(document.activeElement).toBe(screen.getByTestId('confirm-delete-cancel'));
  });

  it('deletes it once confirmed, and closes the pane', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    await vi.waitFor(() => expect(port.entries()).toHaveLength(0));
    expect(screen.queryByTestId('detail-pane')).toBeNull();
  });

  it('negative: cancelling deletes nothing and leaves the pane open', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    await user.click(screen.getByTestId('confirm-delete-cancel'));

    expect(port.calls.remove).toBe(0);
    expect(screen.getByTestId('detail-pane')).toBeTruthy();
    expect(screen.queryByTestId('confirm-delete')).toBeNull();
  });

  it('negative: Escape cancels the dialog WITHOUT also closing the pane behind it', async () => {
    // One keypress must not do two things. Losing the selection as well would
    // make cancelling a delete feel like a punishment.
    const user = userEvent.setup();
    await renderBoard([entry('a')]);

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('confirm-delete')).toBeNull();
    expect(screen.getByTestId('detail-pane')).toBeTruthy();
  });

  it('negative: keeps the card and says so when the delete fails', async () => {
    const user = userEvent.setup();
    const { port } = await renderBoard([entry('a')]);
    port.failNext('remove');

    await user.click(screen.getByTestId('tracker-card-a'));
    await user.click(screen.getByTestId('detail-delete'));
    await user.click(screen.getByTestId('confirm-delete-confirm'));

    expect((await screen.findByRole('alert')).textContent).toContain('could not be deleted');
    expect(screen.getByTestId('tracker-card-a')).toBeTruthy();
  });
});

describe('when the database will not open', () => {
  it('says what happened rather than showing an empty board', async () => {
    // A board that silently shows nothing when the database is locked is
    // indistinguishable from a board with nothing on it.
    const port = createFakeTrackerPort();
    port.failNext('load');
    render(<Tracker port={port} now={NOW} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('locked by another copy');
    expect(alert.textContent).toContain('still on this machine');
  });
});

describe('the funnel strip', () => {
  it('is absent on an empty board', async () => {
    // Five zeros and two dashes under "Start with the last job you applied
    // to" would be the app reporting on a campaign that has not begun.
    await renderBoard();

    expect(screen.queryByTestId('tracker-funnel')).toBeNull();
  });

  it('is present, and counts the board, once there are cards', async () => {
    await renderBoard([
      entry('a', { status: 'saved' }),
      entry('b', { status: 'applied' }),
      entry('c', { status: 'offer' }),
    ]);

    const strip = screen.getByTestId('tracker-funnel');
    expect(within(strip).getByTestId('tracker-funnel-count-sent').textContent).toBe('2');
    expect(screen.getByTestId('tracker-funnel-interview-rate').textContent).toBe(
      'Interview rate 50%',
    );
    expect(screen.getByTestId('tracker-funnel-offer-rate').textContent).toBe('Offer rate 50%');
  });
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('the card and the board at a narrow width (L-175)', () => {
  it('does not repeat the column name as a pill on every card', async () => {
    await renderBoard([entry('a', { status: 'saved' }), entry('b', { status: 'applied' })]);

    // The column header already says "Saved"; the card has better uses for
    // the space.
    expect(within(screen.getByTestId('tracker-card-a')).queryByText('Saved')).toBeNull();
    expect(within(screen.getByTestId('tracker-card-b')).queryByText('Applied')).toBeNull();
  });

  it('keeps columns a readable width and lets the board scroll rather than crush', async () => {
    await renderBoard([entry('a')]);

    // With the 380px detail pane open, five columns shared ~630px and titles
    // shrank to "Senior Pr…". A floor on the column plus sideways scroll on
    // desktop is the fix; jsdom cannot measure, so the classes are the pin.
    const column = screen.getByTestId('tracker-column-saved');
    expect(column.className).toContain('md:min-w-44');
    expect(column.className).not.toContain('md:min-w-0');
    expect(column.parentElement?.className).toContain('overflow-x-auto');
    expect(column.parentElement?.className).not.toContain('md:overflow-x-visible');
  });
});
