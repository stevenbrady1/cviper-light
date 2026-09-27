import { describe, expect, it } from 'vitest';

import {
  NEXT_ACTION_TONES,
  nextActionDescription,
  nextActionLine,
  nextActionUrgency,
  nextActionWhen,
} from './nextAction';

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

describe('nextActionWhen — the due date as a card can say it (L-175)', () => {
  it('says today and tomorrow in words', () => {
    expect(nextActionWhen('2026-08-19', TODAY)).toBe('due today');
    expect(nextActionWhen('2026-08-20', TODAY)).toBe('due tomorrow');
  });

  it('counts the days ahead', () => {
    expect(nextActionWhen('2026-08-21', TODAY)).toBe('due in 2 days');
    expect(nextActionWhen('2026-09-30', TODAY)).toBe('due in 42 days');
  });

  it('boundary: one day late is singular, more is plural', () => {
    expect(nextActionWhen('2026-08-18', TODAY)).toBe('1 day overdue');
    expect(nextActionWhen('2026-08-16', TODAY)).toBe('3 days overdue');
  });

  it('negative: no date, or one that cannot be read, says nothing', () => {
    expect(nextActionWhen(null, TODAY)).toBeNull();
    for (const junk of ['tomorrow', '', '19/08/2026', '2026-13-45']) {
      expect(nextActionWhen(junk, TODAY), junk).toBeNull();
    }
  });
});

describe('nextActionLine — what the card footer reads (L-175)', () => {
  it('puts the action first and the due after it', () => {
    expect(nextActionLine('Reply by Friday', '2026-08-21', TODAY)).toEqual({
      action: 'Reply by Friday',
      when: 'due in 2 days',
    });
  });

  it('with no action text, the due stands alone, capitalised', () => {
    expect(nextActionLine(null, '2026-08-19', TODAY)).toEqual({ action: null, when: 'Due today' });
  });

  it('boundary: whitespace-only action text counts as none', () => {
    expect(nextActionLine('   ', '2026-08-18', TODAY)).toEqual({
      action: null,
      when: '1 day overdue',
    });
  });

  it('negative: no readable date means no line at all, even with action text', () => {
    // An action with no date is a note, not a deadline; the card's job is the
    // deadline. The note is still in the detail pane.
    expect(nextActionLine('Chase recruiter', null, TODAY)).toBeNull();
    expect(nextActionLine('Chase recruiter', 'soon', TODAY)).toBeNull();
  });
});
