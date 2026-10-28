/**
 * Saved searches (L-309, part of L-219): the form and the ticked job boards,
 * kept under a name, run again in one click.
 *
 * ============================================================================
 * BROWSER STORAGE, LIKE THE REST OF SEARCH'S CONVENIENCES (owner, 28 Oct 2026)
 * ============================================================================
 * Next to the recent searches (`memory.ts`) and the ticked boards
 * (`boardChoice.ts`), under the app prefix, so "Delete everything" clears it
 * (`erase/localStorageKeys.contract.test.ts`). Backups do not carry it: a
 * saved search is a shortcut, and losing one costs a minute of typing.
 *
 * Every read is forgiving and every write is best-effort, the same as its
 * neighbours: storage that cannot be read, or holds nonsense, reads as no
 * saved searches, and one bad entry loses that entry only.
 */
import { parseForm } from './memory';
import { type SearchForm } from './model';

export const SAVED_SEARCHES_STORAGE_KEY = 'cviper.light.savedSearches';

/** A shortcut list, not an archive: enough for a few regular searches, short enough to scan. */
export const MAX_SAVED_SEARCHES = 10;

/** Long enough for "Senior tester, London, permanent"; short enough for a chip. */
export const MAX_SAVED_NAME_CHARS = 60;

export interface SavedSearch {
  readonly id: string;
  readonly name: string;
  readonly form: SearchForm;
  /** Ids of the job boards ticked when it was saved. */
  readonly boards: readonly string[];
}

export type SaveOutcome =
  | { readonly ok: true; readonly list: SavedSearch[]; readonly replaced: boolean }
  | { readonly ok: false; readonly problem: string };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** What is wrong with this name, or `null` when it can be used. */
export function savedNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give this search a name.';
  if (trimmed.length > MAX_SAVED_NAME_CHARS) {
    return `Keep the name to ${MAX_SAVED_NAME_CHARS} characters or fewer.`;
  }
  return null;
}

/** The name offered in the box: what and where, the way a recent search reads. */
export function suggestedName(form: SearchForm): string {
  return [form.keywords.trim(), form.location.trim()]
    .filter((part) => part !== '')
    .join(' · ')
    .slice(0, MAX_SAVED_NAME_CHARS);
}

function parseOne(raw: unknown): SavedSearch | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const id = record['id'];
  const name = record['name'];
  if (typeof id !== 'string' || id === '') return null;
  if (typeof name !== 'string' || savedNameProblem(name) !== null) return null;

  const form = parseForm(record['form']);
  if (form === null) return null;

  const boards = Array.isArray(record['boards'])
    ? record['boards'].filter((board): board is string => typeof board === 'string')
    : [];

  return { id, name: name.trim(), form, boards };
}

/** Rebuilt entry by entry, so a key stored by a future version is dropped here. */
export function parseSavedSearches(raw: unknown): SavedSearch[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseOne)
    .filter((entry): entry is SavedSearch => entry !== null)
    .slice(0, MAX_SAVED_SEARCHES);
}

/** The saved searches, newest first, or none. Never throws. */
export function readSavedSearches(): SavedSearch[] {
  try {
    const raw = storage()?.getItem(SAVED_SEARCHES_STORAGE_KEY) ?? null;
    if (raw === null) return [];
    return parseSavedSearches(JSON.parse(raw));
  } catch {
    return [];
  }
}

function write(list: readonly SavedSearch[]): void {
  try {
    storage()?.setItem(SAVED_SEARCHES_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Not remembered this time; the chips on screen still work until the
    // screen closes.
  }
}

/**
 * Save the form and ticked boards under `name`, and remember the list.
 *
 * A name already in the list, in any case, UPDATES that search where it is —
 * pressing Save twice should never leave two chips with the same name. A new
 * name goes first. The list's limit refuses a new search, never an update.
 */
export function saveSearch(
  list: readonly SavedSearch[],
  name: string,
  form: SearchForm,
  boards: readonly string[],
  newId: () => string,
): SaveOutcome {
  const problem = savedNameProblem(name);
  if (problem !== null) return { ok: false, problem };

  const trimmed = name.trim();
  const key = trimmed.toLocaleLowerCase();
  const existing = list.findIndex((entry) => entry.name.toLocaleLowerCase() === key);

  if (existing !== -1) {
    const next = list.map((entry, index) =>
      index === existing ? { id: entry.id, name: trimmed, form, boards: [...boards] } : entry,
    );
    write(next);
    return { ok: true, list: next, replaced: true };
  }

  if (list.length >= MAX_SAVED_SEARCHES) {
    return {
      ok: false,
      problem: `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one to save another.`,
    };
  }

  const next = [{ id: newId(), name: trimmed, form, boards: [...boards] }, ...list];
  write(next);
  return { ok: true, list: next, replaced: false };
}

/** Forget one saved search, and remember the list. An unknown id changes nothing. */
export function deleteSavedSearch(list: readonly SavedSearch[], id: string): SavedSearch[] {
  if (!list.some((entry) => entry.id === id)) return [...list];
  const next = list.filter((entry) => entry.id !== id);
  write(next);
  return next;
}
