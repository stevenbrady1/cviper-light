// @vitest-environment jsdom
/**
 * A column header reads its title, then its count, with nothing between
 * (L-332).
 *
 * "Edit stages" used to sit between the Interviewing title and its count. At
 * 1280px the header wrapped — "INTERVIEWING" on one line, "Edit stages  1" on
 * the next — so the count came away from its title and stopped lining up with
 * "SAVED  1", "APPLIED  1", "OFFER  0" next to it. The control now sits just
 * under the header. jsdom does no layout, so these tests pin the DOM ORDER that
 * the layout follows; `contrast-webkit.spec.ts` measures the width in a real
 * engine.
 */
import {
  type Application,
  type ApplicationStatus,
  type InterviewSubstage,
  type Job,
} from '@cviper/core-types';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';
import { STATUS_LABELS, TRACKER_COLUMNS, type TrackerEntry } from './model';

const NOW = new Date(2026, 9, 5, 9, 0, 0);
const STAMP = '2026-10-05T08:00:00.000Z';

const STAGES: InterviewSubstage[] = [{ id: 'sub-a', name: 'HR Screen', position: 0 }];

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
    interview_substage_id: null,
  };
  return { job, application };
}

async function board(entries: TrackerEntry[], stages: readonly InterviewSubstage[] = []) {
  const user = userEvent.setup();
  const port = createFakeTrackerPort(entries, { substages: stages });
  render(<Tracker port={port} now={NOW} />);
  await screen.findByTestId('tracker-column-interviewing');
  return { user };
}

function headerOf(status: ApplicationStatus): HTMLElement {
  const header = screen.getByTestId(`tracker-column-${status}`).querySelector('header');
  if (header === null) throw new Error(`no header in the ${status} column`);
  return header;
}

/** The header's leaf content in DOM order: the title, the count, anything else. */
function headerParts(status: ApplicationStatus): string[] {
  const header = headerOf(status);
  return [...header.querySelectorAll('h2, [data-testid], button, a, input, [tabindex]')].map(
    (node) => node.getAttribute('data-testid') ?? node.tagName.toLowerCase(),
  );
}

afterEach(cleanup);

describe('every column header is title, then count, and nothing else (L-332)', () => {
  it('the Interviewing header holds its title then its count, with no control between', async () => {
    await board([entry('a', 'interviewing')]);
    expect(headerParts('interviewing')).toEqual(['h2', 'tracker-count-interviewing']);
    expect(within(headerOf('interviewing')).queryByRole('button')).toBeNull();
  });

  it('the Interviewing header matches every other header, column for column', async () => {
    await board([entry('a', 'saved'), entry('b', 'interviewing')]);
    for (const status of TRACKER_COLUMNS) {
      expect(headerParts(status), status).toEqual(['h2', `tracker-count-${status}`]);
      expect(within(headerOf(status)).getByRole('heading').textContent).toBe(STATUS_LABELS[status]);
    }
  });

  it('Edit stages sits after the header and before the first card, so focus goes header, button, cards', async () => {
    await board([entry('a', 'interviewing')]);
    const column = screen.getByTestId('tracker-column-interviewing');
    const button = within(column).getByTestId('tracker-edit-substages');
    const card = within(column).getByTestId('tracker-card-a');
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(headerOf('interviewing'), button)).toBe(true);
    expect(headerOf('interviewing').contains(button)).toBe(false);
    expect(follows(button, card)).toBe(true);
  });

  it('the moved control still opens the same stages editor', async () => {
    const { user } = await board([entry('a', 'interviewing')]);
    const button = screen.getByTestId('tracker-edit-substages');
    expect(button.textContent).toBe('Edit stages');
    await user.click(button);
    expect(await screen.findByTestId('substage-editor')).toBeTruthy();
  });

  it('with stages saved, the compact "Stages" control is also outside the header and opens the editor', async () => {
    const { user } = await board([entry('a', 'interviewing')], STAGES);
    const button = screen.getByTestId('tracker-edit-substages');
    expect(button.textContent).toBe('Stages');
    expect(headerOf('interviewing').contains(button)).toBe(false);
    await user.click(button);
    expect(await screen.findByTestId('substage-editor')).toBeTruthy();
  });

  it('negative: no other column draws an Edit stages control', async () => {
    await board([entry('a', 'saved'), entry('b', 'applied'), entry('c', 'offer')]);
    expect(screen.getAllByTestId('tracker-edit-substages')).toHaveLength(1);
    for (const status of TRACKER_COLUMNS) {
      if (status === 'interviewing') continue;
      const column = screen.getByTestId(`tracker-column-${status}`);
      expect(within(column).queryByTestId('tracker-edit-substages'), status).toBeNull();
      expect(within(column).queryByRole('button', { name: /stages/i }), status).toBeNull();
    }
  });

  it('boundary: an empty Interviewing column still reads title then 0', async () => {
    await board([entry('a', 'saved')]);
    expect(headerParts('interviewing')).toEqual(['h2', 'tracker-count-interviewing']);
    expect(screen.getByTestId('tracker-count-interviewing').textContent).toBe('0');
    expect(screen.getByTestId('tracker-edit-substages')).toBeTruthy();
  });

  it('boundary: an Interviewing column with several cards still reads title then the count', async () => {
    await board([
      entry('a', 'interviewing'),
      entry('b', 'interviewing'),
      entry('c', 'interviewing'),
    ]);
    expect(headerParts('interviewing')).toEqual(['h2', 'tracker-count-interviewing']);
    expect(screen.getByTestId('tracker-count-interviewing').textContent).toBe('3');
  });
});
