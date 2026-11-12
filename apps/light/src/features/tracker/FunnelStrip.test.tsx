// @vitest-environment jsdom
/**
 * The funnel strip, rendered from a board (L-159).
 *
 * The arithmetic is `funnel.ts`'s and is tested there at every boundary. What
 * this file pins is the strip's PROMISE to the user: five figures in pipeline
 * order, two rates, and a dash — not "0%" and not "NaN%" — until enough has
 * been applied for a rate to mean something (L-317).
 */
import { type Application, type ApplicationStatus, type Job } from '@cviper/core-types';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FunnelStrip } from './FunnelStrip';
import { type TrackerEntry } from './model';

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
    created_at: '2026-08-19T12:00:00.000Z',
  };
  const application: Application = {
    id,
    job_id: job.id,
    status,
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: '2026-08-19T12:00:00.000Z',
  };
  return { application, job };
}

function board(...statuses: ApplicationStatus[]): TrackerEntry[] {
  return statuses.map((status, index) => entry(`a${index}`, status));
}

afterEach(cleanup);

describe('FunnelStrip', () => {
  it('renders the five figures, labelled, in pipeline order', () => {
    render(<FunnelStrip entries={board('saved', 'saved', 'applied', 'interviewing', 'offer')} />);

    const strip = screen.getByTestId('tracker-funnel');
    const figures = within(strip).getAllByTestId(/^tracker-funnel-count-/);
    expect(figures.map((figure) => figure.dataset['testid'])).toEqual([
      'tracker-funnel-count-saved',
      'tracker-funnel-count-sent',
      'tracker-funnel-count-interviewing',
      'tracker-funnel-count-offers',
      'tracker-funnel-count-rejected',
    ]);

    expect(within(strip).getByTestId('tracker-funnel-count-saved').textContent).toBe('2');
    expect(within(strip).getByTestId('tracker-funnel-count-sent').textContent).toBe('3');
    expect(within(strip).getByTestId('tracker-funnel-count-interviewing').textContent).toBe('2');
    expect(within(strip).getByTestId('tracker-funnel-count-offers').textContent).toBe('1');
    expect(within(strip).getByTestId('tracker-funnel-count-rejected').textContent).toBe('0');

    // Flow words, not the column words (L-175): "Interviewing 2" above a column
    // holding one card read as a contradiction.
    for (const label of ['Saved', 'Applied', 'Interviewed', 'Offers', 'Rejected']) {
      expect(within(strip).getByText(label)).toBeTruthy();
    }
  });

  it('renders both rates as whole percentages', () => {
    render(
      <FunnelStrip
        entries={board('applied', 'applied', 'applied', 'interviewing', 'interviewing', 'offer')}
      />,
    );

    expect(screen.getByTestId('tracker-funnel-interview-rate').textContent).toBe(
      'Interview rate 50%',
    );
    expect(screen.getByTestId('tracker-funnel-offer-rate').textContent).toBe('Offer rate 17%');
  });

  it('negative: renders a dash for a rate with no data, never 0% or NaN', () => {
    render(<FunnelStrip entries={board('saved', 'saved')} />);

    const interview = screen.getByTestId('tracker-funnel-interview-rate');
    const offer = screen.getByTestId('tracker-funnel-offer-rate');
    expect(interview.textContent).toBe('Interview rate — after 5 applied');
    expect(offer.textContent).toBe('Offer rate — after 5 applied');
    expect(screen.getByTestId('tracker-funnel').textContent).not.toMatch(/NaN|0%/);
  });

  it('boundary: 4 applied is still a dash, with the words saying when a rate comes (L-317)', () => {
    render(<FunnelStrip entries={board('applied', 'applied', 'applied', 'interviewing')} />);

    const interview = screen.getByTestId('tracker-funnel-interview-rate');
    expect(interview.textContent).toBe('Interview rate — after 5 applied');
    expect(screen.getByTestId('tracker-funnel-offer-rate').textContent).toBe(
      'Offer rate — after 5 applied',
    );
    expect(within(interview).getByText('after 5 applied').className).toContain('text-ink-muted');
  });

  it('boundary: 5 applied with no interview is a real 0%, and the waiting words go', () => {
    render(<FunnelStrip entries={board('applied', 'applied', 'applied', 'applied', 'rejected')} />);

    expect(screen.getByTestId('tracker-funnel-interview-rate').textContent).toBe(
      'Interview rate 0%',
    );
    expect(screen.getByTestId('tracker-funnel').textContent).not.toContain('after 5 applied');
  });

  it('never colours a rate teal — teal reads as good news (L-317)', () => {
    const boards = [
      board('saved'),
      board('applied', 'applied', 'applied', 'applied'),
      board('applied', 'applied', 'applied', 'applied', 'applied'),
      board('applied', 'applied', 'applied', 'interviewing', 'interviewing', 'offer'),
    ];
    for (const entries of boards) {
      render(<FunnelStrip entries={entries} />);
      for (const testId of ['tracker-funnel-interview-rate', 'tracker-funnel-offer-rate']) {
        for (const span of screen.getByTestId(testId).querySelectorAll('span')) {
          expect(span.className, `${entries.length} cards, ${testId}`).not.toMatch(/teal/);
        }
      }
      cleanup();
    }
  });

  it('shows a real rate in plain ink and the dash in faint ink', () => {
    render(
      <FunnelStrip
        entries={board('applied', 'applied', 'applied', 'interviewing', 'interviewing', 'offer')}
      />,
    );

    const rate = within(screen.getByTestId('tracker-funnel-interview-rate')).getByText('50%');
    expect(rate.className.split(' ')).toContain('text-ink');

    cleanup();
    render(<FunnelStrip entries={board('saved')} />);

    const dash = within(screen.getByTestId('tracker-funnel-offer-rate')).getByText('—');
    expect(dash.className).toContain('text-ink-faint');
  });
});

describe('the strip says it counts flow, not columns (L-175)', () => {
  it('explains that each figure counts everything that got that far', () => {
    render(<FunnelStrip entries={board('applied', 'offer')} />);

    expect(screen.getByTestId('tracker-funnel').getAttribute('title')).toBe(
      'Every application that got this far, including the ones that moved on',
    );
  });

  it('negative: does not use the column word for a cumulative figure', () => {
    render(<FunnelStrip entries={board('interviewing', 'offer')} />);

    const strip = screen.getByTestId('tracker-funnel');
    expect(within(strip).queryByText('Interviewing')).toBeNull();
    expect(within(strip).queryByText('Sent')).toBeNull();
  });
});
