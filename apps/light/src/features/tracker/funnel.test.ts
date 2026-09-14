import { type Application, type ApplicationStatus, type Job } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { formatRate, funnelFrom } from './funnel';
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

describe('funnelFrom — the counts', () => {
  it('boundary: an empty board is all zeros and NO rates', () => {
    expect(funnelFrom([])).toEqual({
      saved: 0,
      sent: 0,
      interviewing: 0,
      offers: 0,
      rejected: 0,
      interviewRate: null,
      offerRate: null,
    });
  });

  it('boundary: a board of only saved cards has sent nothing, so the rates stay null', () => {
    // Zero of zero is not 0%. A user who has saved three adverts and applied
    // to none has no interview rate, and telling them it is 0% is the app
    // inventing bad news.
    const funnel = funnelFrom(board('saved', 'saved', 'saved'));

    expect(funnel.saved).toBe(3);
    expect(funnel.sent).toBe(0);
    expect(funnel.interviewRate).toBeNull();
    expect(funnel.offerRate).toBeNull();
  });

  it('boundary: the first sent application turns the rates on, at 0%', () => {
    const funnel = funnelFrom(board('saved', 'applied'));

    expect(funnel.sent).toBe(1);
    expect(funnel.interviewRate).toBe(0);
    expect(funnel.offerRate).toBe(0);
  });

  it('counts sent as everything that has left "saved"', () => {
    const funnel = funnelFrom(board('saved', 'applied', 'interviewing', 'offer', 'rejected'));

    expect(funnel.saved).toBe(1);
    expect(funnel.sent).toBe(4);
  });

  it('counts an offer as an interview too — an offer implies one happened', () => {
    const funnel = funnelFrom(board('interviewing', 'offer'));

    expect(funnel.interviewing).toBe(2);
    expect(funnel.offers).toBe(1);
  });

  it('counts rejected on its own, and never as interviewing', () => {
    const funnel = funnelFrom(board('rejected', 'rejected', 'applied'));

    expect(funnel.rejected).toBe(2);
    expect(funnel.interviewing).toBe(0);
    expect(funnel.offers).toBe(0);
  });

  it('computes both rates against sent, not against the whole board', () => {
    // Six cards, two still saved: the denominator is the four that went out.
    const funnel = funnelFrom(
      board('saved', 'saved', 'applied', 'interviewing', 'offer', 'rejected'),
    );

    expect(funnel.sent).toBe(4);
    expect(funnel.interviewRate).toBeCloseTo(2 / 4);
    expect(funnel.offerRate).toBeCloseTo(1 / 4);
  });

  it('never produces NaN', () => {
    const funnel = funnelFrom([]);

    expect(Number.isNaN(funnel.interviewRate)).toBe(false);
    expect(Number.isNaN(funnel.offerRate)).toBe(false);
  });

  it('does not mutate the entries it is given', () => {
    const entries = board('applied', 'offer');
    const snapshot = JSON.stringify(entries);

    funnelFrom(entries);

    expect(JSON.stringify(entries)).toBe(snapshot);
  });
});

describe('formatRate — a whole percentage or a dash', () => {
  it('renders null as a dash, never as 0%', () => {
    expect(formatRate(null)).toBe('—');
  });

  it('boundary: 0 is "0%" — a real zero, not missing data', () => {
    expect(formatRate(0)).toBe('0%');
  });

  it('boundary: 1 is "100%"', () => {
    expect(formatRate(1)).toBe('100%');
  });

  it('rounds a third down and two thirds up', () => {
    expect(formatRate(1 / 3)).toBe('33%');
    expect(formatRate(2 / 3)).toBe('67%');
  });

  it('boundary: rounds a half up', () => {
    // 1/8 is exactly 12.5% — the one place "half up" and "half to even"
    // disagree, and the user expects 13.
    expect(formatRate(1 / 8)).toBe('13%');
  });

  it('boundary: just under a half rounds down', () => {
    expect(formatRate(0.1249)).toBe('12%');
  });

  it('boundary: a rate too small to show a whole point is "0%", not "-"', () => {
    expect(formatRate(1 / 1000)).toBe('0%');
  });
});
