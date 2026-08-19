/**
 * How many provider requests have gone out today.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 * The status strip in the rail answers "what is set up" permanently, and one
 * third of that answer is "how much am I using". Every provider this app can
 * reach costs the user something — Adzuna's free tier is metered by the day,
 * and the cloud AI providers bill per call — so a number that only appears
 * after they hit a limit is a number that arrived too late.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE
 * ============================================================================
 * A COUNT AND A DATE. Nothing else. No provider name, no model, no prompt, no
 * URL, no timestamp per call. This app tells the user nothing leaves their
 * machine, and the safest way to keep a diagnostic honest is to make sure there
 * is nothing in it worth leaking in the first place. `recordRequest` takes no
 * arguments describing the request for exactly that reason.
 *
 * There is also NO CAP, and the strip shows a bare count rather than "12 / 250".
 * A cap would have to be a guess: Adzuna publishes a free-tier limit that
 * depends on the plan the user signed up for, Reed publishes none, and the AI
 * providers meter money rather than calls. Inventing a denominator would put a
 * confident wrong number on screen for ever, which is worse than no
 * denominator at all.
 *
 * ============================================================================
 * STORAGE
 * ============================================================================
 * `localStorage`, not the database. This is a disposable diagnostic that resets
 * every midnight; putting it in SQLite would mean a migration, a table and a
 * row in the user's export file, all for a number that is meaningless tomorrow.
 *
 * Everything here no-ops when there is no `localStorage` — a Vitest run in the
 * `node` environment, or any other non-browser host. A counter that throws
 * would take down the transport it is counting.
 */
import { todayIsoDate } from '../lib/dates';

/** Exported so tests assert against the real key rather than a copy of it. */
export const REQUEST_LOG_STORAGE_KEY = 'cviper.light.requests';

interface DayCount {
  readonly date: string;
  readonly count: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some embedders throw on the mere property access when storage is
    // disabled. An unavailable counter is not an error worth surfacing.
    return null;
  }
}

/**
 * Read the stored day, or `null` if there is nothing usable there.
 *
 * Every field is checked. `localStorage` is a string bucket that survives app
 * upgrades and can be edited by hand, so a `count` of `"lots"` or `-5` is a
 * real possibility, and `Number("lots")` would put `NaN` on the screen.
 */
function readDayCount(): DayCount | null {
  const store = storage();
  if (store === null) return null;

  const raw = store.getItem(REQUEST_LOG_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const { date, count } = parsed as Record<string, unknown>;
  if (typeof date !== 'string') return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null;

  return { date, count };
}

/** How many provider requests have gone out on `now`'s calendar day. */
export function requestsToday(now: Date = new Date()): number {
  const stored = readDayCount();
  if (stored === null) return 0;

  // A stored day that is not today is not "today's count", whether it is
  // yesterday's or — after a clock change or a flight — tomorrow's.
  return stored.date === todayIsoDate(now) ? stored.count : 0;
}

/**
 * Count one provider request.
 *
 * Called from the transport, which is the only thing in the app that knows a
 * request has left the process. Never throws: a failure to count must not fail
 * the request.
 */
export function recordRequest(now: Date = new Date()): void {
  const store = storage();
  if (store === null) return;

  const today = todayIsoDate(now);
  const next: DayCount = { date: today, count: requestsToday(now) + 1 };

  try {
    store.setItem(REQUEST_LOG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full, or private mode. The user loses a diagnostic number, not
    // their request.
  }
}
