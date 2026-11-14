// @vitest-environment jsdom
/**
 * Richer Tracker cards (L-393).
 *
 *   - The job title may take up to three lines, and company · location two,
 *     instead of being cut to one with "…".
 *   - A next action with no date shows the user's own words as one muted line.
 *   - An overdue next action adds one small red dot in the card's top-right
 *     corner, out of the title's flow (L-409). The red "2 days overdue" words
 *     stay; the dot is a second telling, so it is hidden from screen readers.
 *   - A dated next action is two lines (L-409): the user's words on one,
 *     clipped with "…", and how close it is on the next, never clipped.
 *
 * jsdom does no layout, so how many lines a title takes is measured in the
 * real browser (`e2e/contrast-webkit.spec.ts`). Here the classes are the pin.
 */
import { type Application, type Job } from '@cviper/core-types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TrackerCard } from './TrackerCard';
import { type TrackerEntry } from './model';

const NOW = new Date(2026, 10, 12, 9, 0, 0);
const TODAY = '2026-11-12';

interface CardOptions {
  readonly title?: string;
  readonly nextAction?: string | null;
  readonly nextActionDate?: string | null;
}

function entry({
  title = 'Customer Insight Analyst',
  nextAction = null,
  nextActionDate = null,
}: CardOptions): TrackerEntry {
  const application: Application = {
    id: 'a',
    job_id: 'job-a',
    status: 'applied',
    applied_date: null,
    notes: null,
    next_action: nextAction,
    next_action_date: nextActionDate,
    updated_at: NOW.toISOString(),
  };
  const job: Job = {
    id: 'job-a',
    source: 'manual',
    external_id: null,
    title,
    company: 'Harbour & Vale Insurance',
    agency: null,
    location: 'Manchester',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: NOW.toISOString(),
  };
  return { job, application };
}

function renderCard(options: CardOptions = {}) {
  render(
    <TrackerCard
      entry={entry(options)}
      today={TODAY}
      now={NOW}
      selected={false}
      settling={false}
      onSelect={() => {}}
    />,
  );
  const card = screen.getByTestId('tracker-card-a');
  return {
    card,
    label: card.getAttribute('aria-label') ?? '',
    note: screen.queryByTestId('tracker-card-next-a'),
    due: screen.queryByTestId('tracker-card-due-a'),
    dots: card.querySelectorAll('.bg-danger'),
  };
}

afterEach(cleanup);

describe('richer Tracker cards (L-393)', () => {
  describe('happy path', () => {
    it('the title is not cut to one line: up to three, breaking a long word', () => {
      renderCard();
      const title = screen.getByText('Customer Insight Analyst');
      const classes = title.className.split(' ');

      expect(classes).not.toContain('truncate');
      expect(classes).toContain('line-clamp-3');
      expect(classes).toContain('break-words');
    });

    it('company · location may take two lines', () => {
      renderCard();
      const where = screen.getByText('Harbour & Vale Insurance · Manchester');
      const classes = where.className.split(' ');

      expect(classes).not.toContain('truncate');
      expect(classes).toContain('line-clamp-2');
      expect(classes).toContain('break-words');
    });

    it('an undated next action shows its words, muted, on one line', () => {
      const { note, due, dots } = renderCard({ nextAction: 'Chase the recruiter' });

      expect(note?.textContent).toBe('Chase the recruiter');
      expect(note?.className).toContain('text-ink-muted');
      expect(note?.className).toContain('truncate');
      // No colour and no dot: a note is not a deadline.
      expect(note?.className).not.toMatch(/text-(danger|gold|teal|blue)/);
      expect(due).toBeNull();
      expect(dots).toHaveLength(0);
    });

    it('an overdue next action draws exactly one red dot', () => {
      const { dots, due } = renderCard({
        nextAction: 'Chase the recruiter',
        nextActionDate: '2026-11-10',
      });

      expect(dots).toHaveLength(1);
      expect(due?.getAttribute('data-urgency')).toBe('overdue');
      expect(screen.getByTestId('tracker-card-due-when-a').textContent).toBe('2 days overdue');
    });
  });

  describe('negative', () => {
    it('due today draws no dot', () => {
      const { dots, due } = renderCard({ nextAction: 'Call back', nextActionDate: TODAY });

      expect(due?.getAttribute('data-urgency')).toBe('soon');
      expect(dots).toHaveLength(0);
    });

    it('a soon (gold) or later action draws no dot', () => {
      for (const date of ['2026-11-14', '2026-12-20']) {
        const { dots } = renderCard({ nextAction: 'Reply by Friday', nextActionDate: date });
        expect(dots).toHaveLength(0);
        cleanup();
      }
    });

    it('no next action: no line and no dot', () => {
      const { note, due, dots } = renderCard();

      expect(note).toBeNull();
      expect(due).toBeNull();
      expect(dots).toHaveLength(0);
    });

    it('whitespace-only words with no date: no line', () => {
      const { note, label } = renderCard({ nextAction: '   ' });

      expect(note).toBeNull();
      expect(label).not.toContain('Next action');
    });

    it('a dated action keeps its two lines and draws no undated line beside it', () => {
      const { note, due } = renderCard({
        nextAction: 'Reply by Friday',
        nextActionDate: '2026-11-14',
      });

      expect(note).toBeNull();
      expect(screen.getByTestId('tracker-card-due-action-a').textContent).toBe('Reply by Friday');
      expect(screen.getByTestId('tracker-card-due-when-a').textContent).toBe('due in 2 days');
      expect(due?.textContent).not.toContain('·');
    });
  });

  describe('boundary', () => {
    it('1 day overdue draws the dot', () => {
      const { dots } = renderCard({ nextAction: 'Chase', nextActionDate: '2026-11-11' });
      expect(dots).toHaveLength(1);
    });

    it('0 days overdue (due today) does not', () => {
      const { dots } = renderCard({ nextAction: 'Chase', nextActionDate: '2026-11-12' });
      expect(dots).toHaveLength(0);
    });
  });

  describe('edge', () => {
    it('an unreadable date with words shows the words, no dot, never "NaN"', () => {
      const { card, note, due, dots, label } = renderCard({
        nextAction: 'Chase the recruiter',
        nextActionDate: 'not a date',
      });

      expect(note?.textContent).toBe('Chase the recruiter');
      expect(due).toBeNull();
      expect(dots).toHaveLength(0);
      expect(card.textContent).not.toContain('NaN');
      expect(label).not.toContain('NaN');
    });

    it('the dot is hidden from screen readers, and the label says the action words', () => {
      const { dots, label } = renderCard({
        nextAction: 'Chase the recruiter',
        nextActionDate: '2026-11-10',
      });

      expect(dots[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(dots[0]?.textContent).toBe('');
      expect(label).toContain('Next action: Chase the recruiter — overdue by 2 days');
    });

    it('the label carries an undated action as "Next action: <words>"', () => {
      const { label } = renderCard({ nextAction: '  Chase the recruiter  ' });

      expect(label).toContain('Next action: Chase the recruiter');
      expect(label.endsWith('Next action: Chase the recruiter')).toBe(true);
    });

    it('a 200-character title keeps the whole title in the label', () => {
      const title = 'Senior Principal Data Analyst '.repeat(7).slice(0, 200);
      const { label } = renderCard({ title });

      expect(title).toHaveLength(200);
      expect(label.startsWith(`${title}. `)).toBe(true);
    });
  });
});

describe('words on one line, due on the next (L-409)', () => {
  const classesOf = (testId: string) => screen.getByTestId(testId).className.split(' ');

  it('happy: a dated action draws the words (block, truncate) and the due (block, never truncate or nowrap), and the card\'s text has no "·"', () => {
    const { card, due } = renderCard({
      nextAction: 'Reply by Friday',
      nextActionDate: '2026-11-14',
    });

    const words = classesOf('tracker-card-due-action-a');
    expect(words).toContain('block');
    expect(words).toContain('truncate');
    expect(words).toContain('text-ink-muted');

    const when = classesOf('tracker-card-due-when-a');
    expect(when).toContain('block');
    expect(when).not.toContain('truncate');
    expect(when).not.toContain('whitespace-nowrap');
    // The same face, size and tone as before.
    expect(when).toContain('font-mono');
    expect(when).toContain('text-gold-ink');
    expect(due?.className.split(' ')).toContain('text-[11px]');
    expect(due?.getAttribute('data-urgency')).toBe('soon');

    // The one "·" left on the card is company · location's; the due line types none.
    expect(due?.textContent).toBe('Reply by Fridaydue in 2 days');
    expect(card.textContent?.split('·')).toHaveLength(2);
  });

  it('boundary: a date with no words shows only the due line', () => {
    const { due } = renderCard({ nextActionDate: '2026-11-10' });

    expect(due?.children).toHaveLength(1);
    expect(screen.queryByTestId('tracker-card-due-action-a')).toBeNull();
    expect(due?.textContent).toBe('2 days overdue');
    expect(classesOf('tracker-card-due-when-a')).toContain('block');
  });

  it("edge: the overdue dot is out of the title's flow: the dot is absolute, the card is relative, the title has no flex-1", () => {
    const { card, dots } = renderCard({
      nextAction: 'Chase the recruiter',
      nextActionDate: '2026-11-10',
    });
    const dot = screen.getByTestId('tracker-card-overdue-a');
    const title = screen.getByText('Customer Insight Analyst');

    expect(dots).toHaveLength(1);
    expect(dot.className.split(' ')).toContain('absolute');
    expect(dot.parentElement).toBe(card);
    expect(card.className.split(' ')).toContain('relative');
    expect(title.parentElement).toBe(card);
    expect(title.className.split(' ')).not.toContain('flex-1');
    expect(title.className.split(' ')).toContain('line-clamp-3');
    expect(title.className.split(' ')).toContain('break-words');
  });

  it('negative: an undated action is drawn exactly as before', () => {
    const { note, due, dots } = renderCard({ nextAction: 'Chase the recruiter' });

    expect(note?.className).toBe('mt-2 truncate text-[11px] text-ink-muted');
    expect(note?.textContent).toBe('Chase the recruiter');
    expect(due).toBeNull();
    expect(dots).toHaveLength(0);
  });

  it('edge: a 60-character action still has its full words in the screen-reader label', () => {
    const words = 'Chase the recruiter about the salary band and the start date';
    const { label } = renderCard({ nextAction: words, nextActionDate: '2026-11-10' });

    expect(words).toHaveLength(60);
    expect(label).toContain(`Next action: ${words} — overdue by 2 days`);
  });
});
