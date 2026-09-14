// @vitest-environment jsdom
/**
 * The funnel strip, rendered from a board (L-159).
 *
 * The arithmetic is `funnel.ts`'s and is tested there at every boundary. What
 * this file pins is the strip's PROMISE to the user: five figures in pipeline
 * order, two rates, and a dash — not "0%" and not "NaN%" — where there is no
 * rate to show.
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

    for (const label of ['Saved', 'Sent', 'Interviewing', 'Offers', 'Rejected']) {
      expect(within(strip).getByText(label)).toBeTruthy();
    }
  });

  it('renders both rates as whole percentages', () => {
    render(<FunnelStrip entries={board('applied', 'interviewing', 'offer')} />);

    expect(screen.getByTestId('tracker-funnel-interview-rate').textContent).toBe(
      'Interview rate 67%',
    );
    expect(screen.getByTestId('tracker-funnel-offer-rate').textContent).toBe('Offer rate 33%');
  });

  it('boundary: renders a dash for a rate with no data, never 0% or NaN', () => {
    render(<FunnelStrip entries={board('saved', 'saved')} />);

    const interview = screen.getByTestId('tracker-funnel-interview-rate');
    const offer = screen.getByTestId('tracker-funnel-offer-rate');
    expect(interview.textContent).toBe('Interview rate —');
    expect(offer.textContent).toBe('Offer rate —');
    expect(screen.getByTestId('tracker-funnel').textContent).not.toMatch(/NaN|0%/);
  });

  it('boundary: one sent application with no interview is a real 0%, not a dash', () => {
    render(<FunnelStrip entries={board('applied')} />);

    expect(screen.getByTestId('tracker-funnel-interview-rate').textContent).toBe(
      'Interview rate 0%',
    );
  });

  it('colours a rate teal when it exists and faint when it does not', () => {
    render(<FunnelStrip entries={board('applied', 'interviewing')} />);

    const interview = screen.getByTestId('tracker-funnel-interview-rate');
    const offer = screen.getByTestId('tracker-funnel-offer-rate');
    // 1/2 interviewed: a figure. 0/2 offers: still a figure (0%), so teal.
    expect(within(interview).getByText('50%').className).toContain('text-teal');
    expect(within(offer).getByText('0%').className).toContain('text-teal');

    cleanup();
    render(<FunnelStrip entries={board('saved')} />);

    const dash = within(screen.getByTestId('tracker-funnel-offer-rate')).getByText('—');
    expect(dash.className).toContain('text-ink-faint');
    expect(dash.className).not.toContain('text-teal');
  });
});
