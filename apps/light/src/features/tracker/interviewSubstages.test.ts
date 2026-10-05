import {
  INTERVIEW_SUBSTAGE_NAME_MAX,
  INTERVIEW_SUBSTAGES_MAX,
  type Application,
  type InterviewSubstage,
} from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import {
  addSubstage,
  clearSubstageFromApplications,
  moveSubstage,
  removeSubstage,
  renameSubstage,
  substageName,
} from './interviewSubstages';
import { withStatus, withSubstage } from './model';

const NOW = '2026-10-05T09:00:00.000Z';
const LATER = '2026-10-06T09:00:00.000Z';

const STAGES: InterviewSubstage[] = [
  { id: 'a', name: 'HR Screen', position: 0 },
  { id: 'b', name: 'Technical Test', position: 1 },
  { id: 'c', name: 'Panel Round', position: 2 },
];

function app(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    job_id: 'job-1',
    status: 'interviewing',
    applied_date: '2026-09-01',
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW,
    interview_substage_id: 'b',
    ...overrides,
  };
}

describe('addSubstage', () => {
  it('appends at the end with the next position, trimming the name', () => {
    const added = addSubstage(STAGES, '  Final  ', 'd');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.at(-1)).toEqual({ id: 'd', name: 'Final', position: 3 });
    expect(added.value).toHaveLength(4);
  });

  it('rejects an empty or whitespace-only name, and says what to do', () => {
    for (const name of ['', '   ', '\t\n']) {
      const added = addSubstage(STAGES, name, 'd');
      expect(added.ok).toBe(false);
      if (!added.ok) expect(added.error).toMatch(/name/i);
    }
  });

  it('rejects a duplicate name, ignoring case and surrounding space', () => {
    const added = addSubstage(STAGES, '  hr screen ', 'd');
    expect(added.ok).toBe(false);
    if (!added.ok) expect(added.error).toMatch(/already/i);
  });

  it('boundary: accepts a name of exactly the maximum length, rejects one more', () => {
    expect(addSubstage([], 'x'.repeat(INTERVIEW_SUBSTAGE_NAME_MAX), 'd').ok).toBe(true);
    const over = addSubstage([], 'x'.repeat(INTERVIEW_SUBSTAGE_NAME_MAX + 1), 'd');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(String(INTERVIEW_SUBSTAGE_NAME_MAX));
  });

  it('boundary: allows exactly the maximum number of sub-stages, refuses the next', () => {
    let list: InterviewSubstage[] = [];
    for (let index = 0; index < INTERVIEW_SUBSTAGES_MAX; index += 1) {
      const next = addSubstage(list, `Stage ${index}`, `id-${index}`);
      expect(next.ok).toBe(true);
      if (next.ok) list = next.value;
    }
    expect(list).toHaveLength(INTERVIEW_SUBSTAGES_MAX);
    expect(list.map((s) => s.position)).toEqual(list.map((_, index) => index));

    const over = addSubstage(list, 'One too many', 'id-over');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(String(INTERVIEW_SUBSTAGES_MAX));
  });

  it('does not change the list it was given', () => {
    const copy = structuredClone(STAGES);
    addSubstage(STAGES, 'Final', 'd');
    expect(STAGES).toEqual(copy);
  });
});

describe('renameSubstage', () => {
  it('renames in place, keeping id and position', () => {
    const renamed = renameSubstage(STAGES, 'b', 'Coding Exercise');
    expect(renamed.ok && renamed.value[1]).toEqual({
      id: 'b',
      name: 'Coding Exercise',
      position: 1,
    });
  });

  it('allows "renaming" a sub-stage to its own name with different case', () => {
    expect(renameSubstage(STAGES, 'b', 'technical test').ok).toBe(true);
  });

  it('rejects an empty name and a name another sub-stage has', () => {
    expect(renameSubstage(STAGES, 'b', '  ').ok).toBe(false);
    const clash = renameSubstage(STAGES, 'b', 'Panel Round');
    expect(clash.ok).toBe(false);
  });

  it('rejects an id that does not exist', () => {
    expect(renameSubstage(STAGES, 'zzz', 'Whatever').ok).toBe(false);
  });
});

describe('moveSubstage', () => {
  it('moves one place and renumbers every position from 0', () => {
    const moved = moveSubstage(STAGES, 'c', 'up');
    expect(moved.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moved.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  it('boundary: moving the first up, or the last down, changes nothing', () => {
    expect(moveSubstage(STAGES, 'a', 'up')).toEqual(STAGES);
    expect(moveSubstage(STAGES, 'c', 'down')).toEqual(STAGES);
  });

  it('an unknown id changes nothing', () => {
    expect(moveSubstage(STAGES, 'zzz', 'up')).toEqual(STAGES);
  });
});

describe('removeSubstage', () => {
  it('drops it and closes the gap in the positions', () => {
    const removed = removeSubstage(STAGES, 'a');
    expect(removed.map((s) => s.id)).toEqual(['b', 'c']);
    expect(removed.map((s) => s.position)).toEqual([0, 1]);
  });

  it('removing the last remaining one leaves an empty list', () => {
    expect(removeSubstage([{ id: 'a', name: 'Only', position: 0 }], 'a')).toEqual([]);
  });
});

describe('clearSubstageFromApplications', () => {
  it('takes a removed sub-stage off every card that used it, and touches no other card', () => {
    const cards = [
      app({ id: '1', interview_substage_id: 'a' }),
      app({ id: '2', interview_substage_id: 'b' }),
      app({ id: '3', interview_substage_id: null }),
    ];
    const cleared = clearSubstageFromApplications(cards, 'b');
    expect(cleared.map((c) => c.interview_substage_id ?? null)).toEqual(['a', null, null]);
    // The card keeps everything else, status included: nothing is corrupted.
    expect(cleared[1]).toEqual({ ...cards[1], interview_substage_id: null });
    // A card that did not use it is the very same object, so no write is needed.
    expect(cleared[0]).toBe(cards[0]);
  });
});

describe('a card leaving Interviewing', () => {
  it('loses its sub-stage when it moves to any other column', () => {
    for (const status of ['saved', 'applied', 'offer', 'rejected'] as const) {
      const moved = withStatus(app(), status, LATER);
      expect(moved.status).toBe(status);
      expect(moved.interview_substage_id ?? null).toBeNull();
      expect(moved.updated_at).toBe(LATER);
    }
  });

  it('keeps its sub-stage when "moved" to the column it is already in', () => {
    expect(withStatus(app(), 'interviewing', LATER).interview_substage_id).toBe('b');
  });

  it('a card entering Interviewing starts with no sub-stage', () => {
    const entered = withStatus(
      app({ status: 'applied', interview_substage_id: null }),
      'interviewing',
      LATER,
    );
    expect(entered.interview_substage_id ?? null).toBeNull();
  });
});

describe('withSubstage', () => {
  it('sets a known sub-stage on an Interviewing card and stamps the move', () => {
    const next = withSubstage(app({ interview_substage_id: null }), 'c', STAGES, LATER);
    expect(next.interview_substage_id).toBe('c');
    expect(next.updated_at).toBe(LATER);
  });

  it('null clears it', () => {
    expect(withSubstage(app(), null, STAGES, LATER).interview_substage_id).toBeNull();
  });

  it('refuses an id that is not in the list, falling back to none', () => {
    expect(withSubstage(app(), 'ghost', STAGES, LATER).interview_substage_id ?? null).toBeNull();
  });

  it('refuses to put a sub-stage on a card that is not Interviewing', () => {
    const next = withSubstage(
      app({ status: 'applied', interview_substage_id: null }),
      'a',
      STAGES,
      LATER,
    );
    expect(next.interview_substage_id ?? null).toBeNull();
  });
});

describe('substageName', () => {
  it('names the sub-stage a card is in, or null when it has none or it is gone', () => {
    expect(substageName(STAGES, 'b')).toBe('Technical Test');
    expect(substageName(STAGES, null)).toBeNull();
    expect(substageName(STAGES, undefined)).toBeNull();
    expect(substageName(STAGES, 'ghost')).toBeNull();
  });
});
