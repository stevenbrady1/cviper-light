import { describe, expect, it } from 'vitest';

import { NEXT_ACTION_TONES, nextActionDescription, nextActionUrgency } from './nextAction';

const TODAY = '2026-08-19';

describe('nextActionUrgency', () => {
  it('is none when no next action has a date', () => {
    // Not every application needs a next action. An empty date is a legitimate
    // answer, not a missing one, and must not be dressed up as a warning.
    expect(nextActionUrgency(null, TODAY)).toBe('none');
  });

  it('boundary: due today is soon, not overdue', () => {
    // The single most annoying off-by-one in any task tracker. Something due
    // today has not been missed.
    expect(nextActionUrgency('2026-08-19', TODAY)).toBe('soon');
  });

  it('boundary: yesterday is overdue', () => {
    expect(nextActionUrgency('2026-08-18', TODAY)).toBe('overdue');
  });

  it('boundary: three days out is still soon, four days out is later', () => {
    expect(nextActionUrgency('2026-08-22', TODAY)).toBe('soon');
    expect(nextActionUrgency('2026-08-23', TODAY)).toBe('later');
  });

  it('is later when it is comfortably ahead', () => {
    expect(nextActionUrgency('2026-09-30', TODAY)).toBe('later');
  });

  it('is overdue however far past it is', () => {
    expect(nextActionUrgency('2025-01-01', TODAY)).toBe('overdue');
  });

  it('negative: a date that cannot be read is none, never overdue', () => {
    // Guessing "overdue" from an unreadable date would put a red chip on a card
    // for a deadline that may not exist.
    for (const junk of ['tomorrow', '', '19/08/2026', '2026-13-45']) {
      expect(nextActionUrgency(junk, TODAY), junk).toBe('none');
    }
  });

  it('negative: an unreadable today is none rather than a wrong answer', () => {
    expect(nextActionUrgency('2026-08-19', 'not a date')).toBe('none');
  });
});

describe('the tones', () => {
  it('uses gold for soon and red for overdue, and nothing loud for later', () => {
    // The colour grammar: gold is attention, red is the only genuinely bad
    // state on a card. `later` is just a fact and gets no colour at all.
    expect(NEXT_ACTION_TONES.soon).toContain('gold');
    expect(NEXT_ACTION_TONES.overdue).toContain('danger');
    expect(NEXT_ACTION_TONES.later).not.toContain('gold');
    expect(NEXT_ACTION_TONES.later).not.toContain('danger');
  });

  it('renders dates in the mono face so a column of them lines up', () => {
    for (const tone of Object.values(NEXT_ACTION_TONES)) {
      expect(tone).toContain('font-mono');
      expect(tone).toContain('tabular-nums');
    }
  });
});

describe('nextActionDescription — the chip is never the only telling', () => {
  it('says what is due and when, in words', () => {
    expect(nextActionDescription('Chase the recruiter', '2026-08-18', TODAY)).toContain('overdue');
    expect(nextActionDescription('Chase the recruiter', '2026-08-18', TODAY)).toContain(
      'Chase the recruiter',
    );
  });

  it('says due today rather than "in 0 days"', () => {
    expect(nextActionDescription(null, '2026-08-19', TODAY)).toContain('today');
  });

  it('boundary: says nothing at all when there is nothing to say', () => {
    expect(nextActionDescription(null, null, TODAY)).toBeNull();
  });
});
