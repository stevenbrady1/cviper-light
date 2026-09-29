import { type CvAnalysis } from '@cviper/core-types';

/**
 * The last analysis the user was working on, kept above the view switch.
 *
 * ============================================================================
 * WHY THIS IS NOT COMPONENT STATE (L-187)
 * ============================================================================
 * The shell mounts one view at a time, so clicking Tracker UNMOUNTS the
 * analysis view. Everything it held in `useState` — the CV picked, the advert
 * pasted, the option chosen, the result being read — went with it, and coming
 * back showed an empty box and "Nothing checked yet". A result that took thirty
 * seconds of a local model, or a paid cloud call, gone because the user glanced
 * at another screen.
 *
 * So the shell owns one of these for the life of the app and hands it down;
 * the view reads and writes it through `useSyncExternalStore`, and a remount
 * picks up exactly where the last one left off.
 *
 * ============================================================================
 * MEMORY ONLY — NEVER `localStorage`
 * ============================================================================
 * A CV is personal data and the advert beside it says where the user is
 * applying. Nothing here is written to disk: the session lasts until the app
 * closes, which is what "come back to it" means, and nobody finds their CV in
 * a browser-storage file they never asked to be created. "Delete everything"
 * calls `reset()` as well, so the screen does not outlive the database.
 *
 * ============================================================================
 * A LATE ANSWER LANDS — UNLESS SOMETHING NEWER HAS HAPPENED
 * ============================================================================
 * A run keeps going when the user leaves, and its answer is written HERE, not
 * into a component that no longer exists — so it is waiting when they return.
 * Each run takes a ticket from `beginRun()` and presents it with its answer;
 * picking another CV, loading a new one or deleting everything `supersede`s
 * it, and a stale ticket's answer is dropped rather than put on screen under
 * input it was never computed from.
 */

/** One finished run, as the result card shows it. */
export interface RunResult {
  readonly analysis: CvAnalysis;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
}

export interface AnalysisSessionState {
  readonly selectedCvId: string | null;
  readonly jobText: string;
  /**
   * The option the user PICKED, or `null` until they pick one.
   *
   * Not "the option on screen": that is derived in the view from what this
   * machine offers right now, so a remembered model that has since been removed
   * falls back to the default instead of naming something that is not there.
   */
  readonly optionKey: string | null;
  readonly result: RunResult | null;
  /**
   * The advert the LAST run was scored against, for the gates (L-156).
   *
   * Not `jobText`: the user can edit the box after a run, and the gates must
   * quote the advert the result on screen was computed from. Only read while
   * `result` is non-null, so it is never cleared separately.
   */
  readonly checkedAdvert: string | null;
  /**
   * Why the last run failed, or `null`. Kept here rather than in the view's
   * error banner state because a run can fail while the user is on another
   * view, and coming back to a silent "Nothing checked yet" is a dead end.
   */
  readonly runError: string | null;
  /** The partial-read warnings for the selected CV — they qualify the result. */
  readonly warnings: readonly string[];
  readonly running: boolean;
}

export const EMPTY_ANALYSIS_SESSION: AnalysisSessionState = {
  selectedCvId: null,
  jobText: '',
  optionKey: null,
  result: null,
  checkedAdvert: null,
  runError: null,
  warnings: [],
  running: false,
};

type Patch =
  | Partial<AnalysisSessionState>
  | ((current: AnalysisSessionState) => Partial<AnalysisSessionState>);

export interface AnalysisSession {
  /** The current snapshot — the SAME object until something changes. */
  readonly get: () => AnalysisSessionState;
  /**
   * Call `listener` on every change; returns the function that stops it.
   * `useSyncExternalStore`'s first argument. Not named after that hook's own
   * parameter: `no-paywall.contract.test.ts` rejects that word in shipped
   * source, and it is right to read it as billing copy everywhere else.
   */
  readonly watch: (listener: () => void) => () => void;
  readonly update: (patch: Patch) => void;
  /** Start a run: marks it running and returns the ticket its answer must present. */
  readonly beginRun: () => number;
  /** Whether nothing has superseded the run holding this ticket. */
  readonly isCurrent: (ticket: number) => boolean;
  /** Drop any run in flight and stop showing the wait. The inputs stay. */
  readonly supersede: () => void;
  /** Forget everything, including any run in flight. */
  readonly reset: () => void;
}

export function createAnalysisSession(): AnalysisSession {
  let state = EMPTY_ANALYSIS_SESSION;
  let ticket = 0;
  const listeners = new Set<() => void>();

  function update(patch: Patch): void {
    const changes = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  return {
    get: () => state,
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    beginRun() {
      ticket += 1;
      update({ running: true, runError: null });
      return ticket;
    },
    isCurrent: (candidate) => candidate === ticket,
    supersede() {
      ticket += 1;
      update({ running: false });
    },
    reset() {
      ticket += 1;
      update(EMPTY_ANALYSIS_SESSION);
    },
  };
}
