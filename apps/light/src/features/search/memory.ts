/**
 * Where the search box remembers what you typed.
 *
 * ============================================================================
 * TWO THINGS, AND NEITHER OF THEM IS A SEARCH
 * ============================================================================
 * The DRAFT is whatever is in the boxes right now, written a moment after
 * typing stops, so closing the app mid-thought does not lose it. The RECENT
 * list is the handful of searches that were actually submitted, so re-running
 * yesterday's search is one click rather than one retyping.
 *
 * Nothing here ever CAUSES a search. Restoring a draft fills the boxes and
 * stops; the recent list fills the boxes and stops. Reed's free tier is 100
 * requests a day, and an app that searched on startup because it remembered
 * something would spend one of them before the user had looked at the screen.
 *
 * ============================================================================
 * `localStorage`, AND ONLY A FORM
 * ============================================================================
 * Same decision as `status/requestLog.ts` and `jobs/quotaStore.ts`: this is not
 * the user's data, it is the state of a text box. Putting it in SQLite would
 * mean a migration, a table, and a row in the export file for something that is
 * meaningless on another machine.
 *
 * What is stored is a form and NOTHING else — no results, no advert text, no
 * timestamps, nothing that identifies anyone. This app tells the user nothing
 * leaves their machine, and the safest way to keep that honest is to make sure
 * there is nothing worth leaking in the first place.
 *
 * Every function no-ops or falls back when there is no `localStorage` — a
 * Vitest run in the `node` environment, or any non-browser host. Losing the
 * draft is a small annoyance; a text box that throws is a broken screen.
 */
import { CONTRACT_CHOICES, EMPTY_FORM, type ContractChoice, type SearchForm } from './model';

/** Exported so tests assert against the real key rather than a copy of it. */
export const SEARCH_STORAGE_KEY = 'cviper.light.search';

/**
 * How many past searches to keep.
 *
 * Five, because the list is a shortcut rather than a history: it sits under the
 * form and has to be scannable at a glance. A list long enough to need reading
 * is slower than retyping.
 */
export const MAX_RECENT_SEARCHES = 5;

export interface SearchMemory {
  readonly draft: SearchForm;
  readonly recent: readonly SearchForm[];
}

const EMPTY: SearchMemory = { draft: EMPTY_FORM, recent: [] };

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the mere property access when storage is
    // disabled. An unavailable text box memory is not worth surfacing.
    return null;
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asContractChoice(value: unknown): ContractChoice {
  // Rebuilt against the real list rather than cast. A value from a future
  // version — or a hand-edited file — must not reach a `<select>` as the
  // selected option of an option that does not exist.
  return CONTRACT_CHOICES.some((choice) => choice.value === value)
    ? (value as ContractChoice)
    : 'any';
}

/**
 * Read one stored form back, or `null` if it is not one.
 *
 * A field that is absent falls back to the empty form's value rather than
 * arriving as `undefined`, because `undefined` in a controlled input is how
 * React ends up reporting that an input switched to uncontrolled — a warning
 * about a bug three layers away from the file that caused it.
 */
function parseForm(raw: unknown): SearchForm | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  return {
    keywords: asText(record['keywords']) ?? EMPTY_FORM.keywords,
    location: asText(record['location']) ?? EMPTY_FORM.location,
    distanceMiles: asText(record['distanceMiles']) ?? EMPTY_FORM.distanceMiles,
    salaryMin: asText(record['salaryMin']) ?? EMPTY_FORM.salaryMin,
    contractType: asContractChoice(record['contractType']),
  };
}

/**
 * Read the whole thing back, or `null` if it is not ours.
 *
 * Rebuilt field by field rather than returned as-is, so a key stored by a
 * future version is dropped here instead of travelling on inside our state.
 */
export function parseSearchMemory(raw: unknown): SearchMemory | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const draft = parseForm(record['draft']);
  if (draft === null) return null;

  const stored = record['recent'];
  if (!Array.isArray(stored)) return null;

  // One unreadable entry loses that entry, never the list around it.
  const recent = stored
    .map(parseForm)
    .filter((entry): entry is SearchForm => entry !== null)
    .slice(0, MAX_RECENT_SEARCHES);

  return { draft, recent };
}

export function readSearchMemory(): SearchMemory {
  const store = storage();
  if (store === null) return EMPTY;

  let parsed: unknown;
  try {
    // `getItem` itself throws in some embedders and in some private-browsing
    // modes — the guard in `storage()` only covers the property ACCESS.
    const raw = store.getItem(SEARCH_STORAGE_KEY);
    if (raw === null) return EMPTY;
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }

  return parseSearchMemory(parsed) ?? EMPTY;
}

/** Persist. Never throws: a full disk must not break the search box. */
function write(memory: SearchMemory): void {
  const store = storage();
  if (store === null) return;

  try {
    store.setItem(SEARCH_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Storage full, or private mode. The user loses a convenience, not a
    // search.
  }
}

/** Save what is in the boxes right now, keeping the recent list untouched. */
export function writeDraft(draft: SearchForm): void {
  write({ draft, recent: readSearchMemory().recent });
}

/** Is there anything in this form worth offering back? */
function isWorthKeeping(formValues: SearchForm): boolean {
  return formValues.keywords.trim() !== '' || formValues.location.trim() !== '';
}

/** Two searches that would send the same request. */
function sameSearch(left: SearchForm, right: SearchForm): boolean {
  return (
    left.keywords.trim() === right.keywords.trim() &&
    left.location.trim() === right.location.trim() &&
    left.distanceMiles.trim() === right.distanceMiles.trim() &&
    left.salaryMin.trim() === right.salaryMin.trim() &&
    left.contractType === right.contractType
  );
}

/**
 * Record a search that was actually submitted, and return the new memory.
 *
 * Called from the submit handler and from nowhere else. Deduplicated because
 * re-running yesterday's search is the commonest thing anybody does here, and
 * five identical rows is not a list.
 */
export function rememberSearch(formValues: SearchForm): SearchMemory {
  const current = readSearchMemory();
  if (!isWorthKeeping(formValues)) return current;

  const recent = [
    formValues,
    ...current.recent.filter((entry) => !sameSearch(entry, formValues)),
  ].slice(0, MAX_RECENT_SEARCHES);

  const next: SearchMemory = { draft: formValues, recent };
  write(next);
  return next;
}
