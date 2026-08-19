// @vitest-environment jsdom
/**
 * jsdom, because this module's whole job is `localStorage` — and the thing
 * worth asserting about it is what happens when the stored value is not what we
 * wrote. It is a hand-editable string bucket that survives app upgrades.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_FORM, type SearchForm } from './model';
import {
  MAX_RECENT_SEARCHES,
  SEARCH_STORAGE_KEY,
  parseSearchMemory,
  readSearchMemory,
  rememberSearch,
  writeDraft,
} from './memory';

function form(overrides: Partial<SearchForm> = {}): SearchForm {
  return { ...EMPTY_FORM, keywords: 'credit risk analyst', location: 'London', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('reading', () => {
  it('starts empty when nothing has ever been stored', () => {
    expect(readSearchMemory()).toEqual({ draft: EMPTY_FORM, recent: [] });
  });

  it('reads back a draft that was written', () => {
    writeDraft(form({ salaryMin: '60000' }));

    expect(readSearchMemory().draft).toEqual(form({ salaryMin: '60000' }));
  });

  it('negative: anything unreadable reads as empty rather than throwing', () => {
    for (const raw of ['', 'not json', '[]', 'null', '{"draft":42}', '{"recent":"lots"}']) {
      localStorage.setItem(SEARCH_STORAGE_KEY, raw);
      expect(readSearchMemory(), raw).toEqual({ draft: EMPTY_FORM, recent: [] });
    }
  });

  it('negative: a draft missing a field falls back rather than rendering undefined', () => {
    localStorage.setItem(
      SEARCH_STORAGE_KEY,
      JSON.stringify({ draft: { keywords: 'analyst' }, recent: [] }),
    );

    // A half-shaped draft from an older version must not put `undefined` into a
    // controlled input, which React reports as a switch to an uncontrolled one.
    expect(readSearchMemory().draft).toEqual({ ...EMPTY_FORM, keywords: 'analyst' });
  });

  it('negative: an unknown contract type falls back to "any"', () => {
    localStorage.setItem(
      SEARCH_STORAGE_KEY,
      JSON.stringify({ draft: { ...EMPTY_FORM, contractType: 'Freelance' }, recent: [] }),
    );

    expect(readSearchMemory().draft.contractType).toBe('any');
  });

  it('negative: survives a store that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is disabled');
    });

    expect(readSearchMemory()).toEqual({ draft: EMPTY_FORM, recent: [] });
  });
});

describe('remembering a search that was actually run', () => {
  it('puts the newest first', () => {
    rememberSearch(form({ keywords: 'first' }));
    const memory = rememberSearch(form({ keywords: 'second' }));

    expect(memory.recent.map((entry) => entry.keywords)).toEqual(['second', 'first']);
  });

  it('does not keep the same search twice', () => {
    rememberSearch(form({ keywords: 'analyst' }));
    rememberSearch(form({ keywords: 'developer' }));
    const memory = rememberSearch(form({ keywords: 'analyst' }));

    // Re-running yesterday's search is the commonest thing a user does. A list
    // of five identical rows is not a list.
    expect(memory.recent.map((entry) => entry.keywords)).toEqual(['analyst', 'developer']);
  });

  it('boundary: keeps at most the cap, dropping the oldest', () => {
    for (let index = 0; index <= MAX_RECENT_SEARCHES; index += 1) {
      rememberSearch(form({ keywords: `search-${index}` }));
    }

    const { recent } = readSearchMemory();
    expect(recent).toHaveLength(MAX_RECENT_SEARCHES);
    expect(recent[0]?.keywords).toBe(`search-${MAX_RECENT_SEARCHES}`);
    expect(recent.map((entry) => entry.keywords)).not.toContain('search-0');
  });

  it('negative: never stores a completely empty search', () => {
    // Nothing was searched for, so there is nothing to offer back.
    expect(rememberSearch(EMPTY_FORM).recent).toEqual([]);
  });

  it('negative: never throws when the store is full', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => rememberSearch(form())).not.toThrow();
  });

  it('stores the search terms and nothing else', () => {
    // This is the one place the app writes what somebody typed to disk outside
    // the database. It holds a form and it holds nothing else — no results, no
    // timestamps, no advert text, nothing that identifies the user.
    rememberSearch(form({ salaryMin: '60000' }));

    const stored: unknown = JSON.parse(localStorage.getItem(SEARCH_STORAGE_KEY) ?? '{}');
    expect(Object.keys(stored as Record<string, unknown>).sort()).toEqual(['draft', 'recent']);
  });
});

describe('parsing', () => {
  it('rebuilds rather than trusting, so a future version’s keys are dropped', () => {
    const parsed = parseSearchMemory({
      draft: { ...form(), somethingNew: 'from a later version' },
      recent: [],
      alsoNew: true,
    });

    expect(parsed?.draft).toEqual(form());
    expect(Object.keys(parsed ?? {})).toEqual(['draft', 'recent']);
  });

  it('negative: refuses anything that is not an object', () => {
    for (const raw of [null, 42, 'text', [], undefined]) {
      expect(parseSearchMemory(raw)).toBeNull();
    }
  });

  it('negative: drops a recent entry that is not a form, keeping the rest', () => {
    const parsed = parseSearchMemory({ draft: EMPTY_FORM, recent: [form(), 'nonsense', null] });

    expect(parsed?.recent).toHaveLength(1);
  });
});
