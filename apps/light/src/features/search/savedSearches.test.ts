// @vitest-environment jsdom
/**
 * L-309 — saved searches: the model and its storage.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LOCAL_STORAGE_PREFIX } from '../settings/erase/port';

import { EMPTY_FORM, type SearchForm } from './model';
import {
  MAX_SAVED_NAME_CHARS,
  MAX_SAVED_SEARCHES,
  SAVED_SEARCHES_STORAGE_KEY,
  deleteSavedSearch,
  parseSavedSearches,
  readSavedSearches,
  saveSearch,
  suggestedName,
  savedNameProblem,
  type SavedSearch,
} from './savedSearches';

const TESTER: SearchForm = {
  ...EMPTY_FORM,
  keywords: 'Tester',
  location: 'London',
  salaryMin: '60000',
  contractType: 'Permanent',
};

let counter = 0;
const nextId = (): string => `id-${(counter += 1)}`;

beforeEach(() => {
  counter = 0;
  localStorage.clear();
});
afterEach(() => localStorage.clear());

function many(count: number): SavedSearch[] {
  let list: SavedSearch[] = [];
  for (let index = 0; index < count; index += 1) {
    const saved = saveSearch(list, `Search ${index}`, TESTER, [], nextId);
    if (!saved.ok) throw new Error(saved.problem);
    list = saved.list;
  }
  return list;
}

describe('saving a search', () => {
  it('keeps the name, the whole form and the ticked boards, newest first, and remembers them', () => {
    const first = saveSearch([], 'London testing', TESTER, ['linkedin', 'reed'], nextId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = saveSearch(first.list, 'Remote', { ...EMPTY_FORM, keywords: 'QA' }, [], nextId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.list.map((entry) => entry.name)).toEqual(['Remote', 'London testing']);
    expect(second.list[1]).toEqual({
      id: 'id-1',
      name: 'London testing',
      form: TESTER,
      boards: ['linkedin', 'reed'],
    });
    expect(readSavedSearches()).toEqual(second.list);
  });

  it('trims the name it keeps', () => {
    const saved = saveSearch([], '  London testing  ', TESTER, [], nextId);
    expect(saved.ok && saved.list[0]?.name).toBe('London testing');
  });

  it('a name already used, in any case, updates that search in place rather than adding a second', () => {
    const first = saveSearch([], 'London testing', TESTER, ['linkedin'], nextId);
    if (!first.ok) throw new Error(first.problem);
    const other = saveSearch(first.list, 'Other', EMPTY_FORM, [], nextId);
    if (!other.ok) throw new Error(other.problem);

    const changed = { ...TESTER, salaryMin: '70000' };
    const again = saveSearch(other.list, 'LONDON TESTING', changed, ['reed'], nextId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.list).toHaveLength(2);
    expect(again.list.map((entry) => entry.id)).toEqual(['id-2', 'id-1']);
    expect(again.list[1]).toEqual({
      id: 'id-1',
      name: 'LONDON TESTING',
      form: changed,
      boards: ['reed'],
    });
    expect(again.replaced).toBe(true);
  });

  it('negative: an empty or blank name is refused, and nothing is stored', () => {
    for (const name of ['', '   ', '\t\n']) {
      const saved = saveSearch([], name, TESTER, [], nextId);
      expect(saved.ok).toBe(false);
      expect(!saved.ok && saved.problem).toBe('Give this search a name.');
    }
    expect(readSavedSearches()).toEqual([]);
  });

  it(`boundary: a name of exactly ${MAX_SAVED_NAME_CHARS} characters is kept; one more is refused`, () => {
    const longest = 'a'.repeat(MAX_SAVED_NAME_CHARS);
    expect(savedNameProblem(longest)).toBeNull();
    expect(saveSearch([], longest, TESTER, [], nextId).ok).toBe(true);

    const tooLong = saveSearch([], `${longest}a`, TESTER, [], nextId);
    expect(tooLong.ok).toBe(false);
    expect(!tooLong.ok && tooLong.problem).toBe(
      `Keep the name to ${MAX_SAVED_NAME_CHARS} characters or fewer.`,
    );
  });

  it(`boundary: the ${MAX_SAVED_SEARCHES}th search is kept; a new one after that is refused, an update is not`, () => {
    const full = many(MAX_SAVED_SEARCHES);
    expect(full).toHaveLength(MAX_SAVED_SEARCHES);

    const extra = saveSearch(full, 'One too many', TESTER, [], nextId);
    expect(extra.ok).toBe(false);
    expect(!extra.ok && extra.problem).toBe(
      `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one to save another.`,
    );
    expect(readSavedSearches()).toHaveLength(MAX_SAVED_SEARCHES);

    // Updating one that exists adds nothing, so a full list still takes it.
    expect(saveSearch(full, 'Search 3', EMPTY_FORM, [], nextId).ok).toBe(true);
  });
});

describe('deleting a saved search', () => {
  it('removes that one only, and remembers it', () => {
    const list = many(3);
    const after = deleteSavedSearch(list, 'id-2');
    expect(after.map((entry) => entry.id)).toEqual(['id-3', 'id-1']);
    expect(readSavedSearches()).toEqual(after);
  });

  it('negative: an id that is not there changes nothing', () => {
    const list = many(2);
    expect(deleteSavedSearch(list, 'nope')).toEqual(list);
  });
});

describe('reading them back', () => {
  it('lives under the erase prefix, so "Delete everything" clears it', () => {
    expect(SAVED_SEARCHES_STORAGE_KEY.startsWith(LOCAL_STORAGE_PREFIX)).toBe(true);
  });

  it('negative: nothing stored, nonsense, or the wrong shape reads as no saved searches', () => {
    expect(readSavedSearches()).toEqual([]);
    for (const raw of ['not json', '{}', '"text"', 'null', '42']) {
      localStorage.setItem(SAVED_SEARCHES_STORAGE_KEY, raw);
      expect(readSavedSearches()).toEqual([]);
    }
  });

  it('one bad entry loses that entry, never the list around it', () => {
    const good = { id: 'a', name: 'Good', form: TESTER, boards: ['reed', 7] };
    expect(
      parseSavedSearches([
        good,
        { id: 'b', name: '', form: TESTER, boards: [] },
        { id: 'c', name: 'No form', boards: [] },
        { id: 4, name: 'Bad id', form: TESTER, boards: [] },
        'junk',
      ]),
    ).toEqual([{ id: 'a', name: 'Good', form: TESTER, boards: ['reed'] }]);
  });

  it(`boundary: a stored list longer than ${MAX_SAVED_SEARCHES} is cut to ${MAX_SAVED_SEARCHES}`, () => {
    const stored = Array.from({ length: MAX_SAVED_SEARCHES + 3 }, (_, index) => ({
      id: `s${index}`,
      name: `S${index}`,
      form: TESTER,
      boards: [],
    }));
    expect(parseSavedSearches(stored)).toHaveLength(MAX_SAVED_SEARCHES);
  });
});

describe('the suggested name', () => {
  it('is what and where, the way recent searches read', () => {
    expect(suggestedName(TESTER)).toBe('Tester · London');
    expect(suggestedName({ ...EMPTY_FORM, location: 'Leeds' })).toBe('Leeds');
  });

  it(`boundary: an empty form suggests nothing, and a long one is cut to ${MAX_SAVED_NAME_CHARS}`, () => {
    expect(suggestedName(EMPTY_FORM)).toBe('');
    const long = suggestedName({ ...EMPTY_FORM, keywords: 'x'.repeat(200) });
    expect(long).toHaveLength(MAX_SAVED_NAME_CHARS);
    expect(savedNameProblem(long)).toBeNull();
  });
});
