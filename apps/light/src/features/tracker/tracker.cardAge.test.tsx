// @vitest-environment jsdom
/**
 * Every Tracker card says, in words, how long since its last change (L-318).
 *
 * The age used to live only in the coloured left edge and the screen-reader
 * label, so a sighted user had a 2px stripe to decode. The words now sit on the
 * card as one small line, and they are the same words the label reads out.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerCard } from './TrackerCard';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 10, 12, 9, 0, 0);

function daysAgo(days: number): string {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function entry(id: string, updatedAt: string): TrackerEntry {
  const application: Application = {
    id,
    job_id: `job-${id}`,
    status: 'applied',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: updatedAt,
  };
  const job: Job = {
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
    created_at: daysAgo(60),
  };
  return { job, application };
}

function renderCard(updatedAt: string) {
  render(
    <TrackerCard
      entry={entry('a', updatedAt)}
      today="2026-11-12"
      now={NOW}
      selected={false}
      settling={false}
      onSelect={() => {}}
    />,
  );
  return {
    card: screen.getByTestId('tracker-card-a'),
    age: screen.getByTestId('tracker-card-age-a'),
  };
}

afterEach(cleanup);

describe('the age line on a Tracker card (L-318)', () => {
  it('shows how many days since the last change, in words', () => {
    const { age } = renderCard(daysAgo(12));

    expect(age.textContent).toBe('12 days since last change');
  });

  it('the visible words are the same words the screen reader hears', () => {
    const { card, age } = renderCard(daysAgo(12));
    const words = age.textContent ?? '';

    // An empty line is "contained" in any label, so it must say something first.
    expect(words).not.toBe('');
    expect(card.getAttribute('aria-label')).toContain(words);
  });

  it('negative: a last change in the future says "Changed today", never a minus', () => {
    const { card, age } = renderCard(daysAgo(-3));

    expect(age.textContent).toBe('Changed today');
    expect(age.textContent).not.toContain('-');
    expect(card.getAttribute('aria-label')).toContain('Changed today');
  });

  it('boundary: a date that cannot be read says "Last change unknown"', () => {
    const { age } = renderCard('not a date');

    expect(age.textContent).toBe('Last change unknown');
  });
});
