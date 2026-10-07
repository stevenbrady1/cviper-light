import {
  type FabricationFlag,
  type FabricationReport,
  type UserSuppliedMetric,
} from '@cviper/ai-providers';
import { type CoverLetter, type DraftReview, type TailoredCv } from '@cviper/core-types';

import { type HandedGaps } from '../flow/handoff';
import { EMPTY_METRIC_STATE, type MetricState } from './metricPrompts';

/**
 * The Tailor screen's work, one session per job, kept above the view switch
 * (L-199).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The shell mounts one view at a time, so Tailor's `useState` died every time
 * the user glanced at the tracker: the tailored CV, the review, the letter —
 * a minute of a local model, or a paid cloud call — gone. And there was only
 * ever ONE of each, so tailoring for a second job threw away the first.
 *
 * So the shell owns one of these for the life of the app — the L-187 pattern
 * from `analysis/session.ts`, grown a key — and Tailor reads it through
 * `useSyncExternalStore`. A remount picks up where the last one left off, and
 * each job keeps its own draft.
 *
 * ============================================================================
 * A LATE ANSWER LANDS ON ITS OWN JOB
 * ============================================================================
 * A run captures the job it was started for and writes its answer THERE with
 * `patch(jobId, …)` — never "into whatever is on screen". Switch to another
 * job mid-run and the answer waits on the first one; it can never appear
 * under an advert it was not written for.
 *
 * ============================================================================
 * MEMORY ONLY, FOR NOW
 * ============================================================================
 * Like the analysis session, nothing here touches disk: "Delete everything"
 * calls `reset()`, and a CV is never written anywhere the user did not ask.
 * Surviving a restart is the second half of L-199, and it writes through to
 * SQLite — the database the user already has — not to browser storage.
 */

/** Which of the three model calls is in flight for a job, if any. */
export type Phase = 'idle' | 'tailoring' | 'reviewing' | 'writing';

export interface TailorResult {
  readonly cv: TailoredCv;
  /** `renderTailoredCv` of `cv`, computed once. */
  readonly text: string;
  readonly report: FabricationReport;
  readonly provider: string;
  readonly model: string;
  readonly retried: boolean;
  /**
   * The approved achievements this draft was written with (L-205). The letter
   * and the review use THESE, not whatever the boxes say now: the numbers are
   * already in the draft.
   */
  readonly userMetrics: readonly UserSuppliedMetric[];
}

export interface LetterResult {
  readonly letter: CoverLetter;
  readonly text: string;
  readonly words: number;
  readonly claims: readonly FabricationFlag[];
}

/** Everything Tailor holds for one job. */
export interface TailorJobState {
  /** The CV picked for this job, or `null` for the screen's default. */
  readonly cvId: string | null;
  /** The model option picked for this job, or `null` for the screen's default. */
  readonly optionKey: string | null;
  /** The advert in the box — the job's own text, or the user's edit of it. */
  readonly advert: string;
  /** The Analysis result's keyword gaps, as handed over (L-202). */
  readonly handedGaps: HandedGaps | null;
  /** What the user typed against each gap, and whether they approved it (L-205). */
  readonly metricState: MetricState;
  readonly result: TailorResult | null;
  readonly review: DraftReview | null;
  readonly letter: LetterResult | null;
  readonly phase: Phase;
  /** Why the last run for THIS job failed, or `null`. */
  readonly error: string | null;
}

export const EMPTY_TAILOR_JOB: TailorJobState = {
  cvId: null,
  optionKey: null,
  advert: '',
  handedGaps: null,
  metricState: EMPTY_METRIC_STATE,
  result: null,
  review: null,
  letter: null,
  phase: 'idle',
  error: null,
};

export interface JobSessionsState {
  /** The tracked job Tailor is showing, or `null` for a pasted advert. */
  readonly activeJobId: string | null;
  /** Keyed by job id; the pasted advert's session is under `PASTE_KEY`. */
  readonly sessions: ReadonlyMap<string, TailorJobState>;
}

/** A pasted advert is a job of its own. Job ids are UUIDs, never empty. */
const PASTE_KEY = '';

function keyOf(jobId: string | null): string {
  return jobId ?? PASTE_KEY;
}

/** The tracked jobs that have a session — every key but the pasted advert's. */
export function trackedJobIds(state: JobSessionsState): string[] {
  return [...state.sessions.keys()].filter((key) => key !== PASTE_KEY);
}

/** One job's session in a snapshot, or the empty one — for a render reading `get()`. */
export function sessionIn(state: JobSessionsState, jobId: string | null): TailorJobState {
  return state.sessions.get(keyOf(jobId)) ?? EMPTY_TAILOR_JOB;
}

type Patch = Partial<TailorJobState> | ((current: TailorJobState) => Partial<TailorJobState>);

export interface JobSessions {
  /** The current snapshot — the SAME object until something changes. */
  readonly get: () => JobSessionsState;
  /** Call `listener` on every change; returns the function that stops it. */
  readonly watch: (listener: () => void) => () => void;
  /** One job's session, or the empty one if it has none yet. */
  readonly session: (jobId: string | null) => TailorJobState;
  /** The active job's session. */
  readonly active: () => TailorJobState;
  /** Whether this job (or, for `null`, the pasted advert) has a session yet. */
  readonly has: (jobId: string | null) => boolean;
  /**
   * Show this job. A job with no session yet gets one from `seed`; a job that
   * has one keeps it, untouched — coming back is not starting again.
   */
  readonly open: (jobId: string | null, seed: () => Partial<TailorJobState>) => void;
  /**
   * Give a job a session if it has none, seeded once, WITHOUT showing it —
   * for another screen recording a choice for the job (L-200).
   */
  readonly ensure: (jobId: string, seed: () => Partial<TailorJobState>) => void;
  /** Change ONE job's session, whichever job is showing. */
  readonly patch: (jobId: string | null, patch: Patch) => void;
  /** Forget every job ("Delete everything"). */
  readonly reset: () => void;
}

const EMPTY_STATE: JobSessionsState = { activeJobId: null, sessions: new Map() };

export function createJobSessions(): JobSessions {
  let state = EMPTY_STATE;
  const listeners = new Set<() => void>();

  function publish(next: JobSessionsState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function session(jobId: string | null): TailorJobState {
    return sessionIn(state, jobId);
  }

  function withSession(jobId: string | null, value: TailorJobState): JobSessionsState {
    const sessions = new Map(state.sessions);
    sessions.set(keyOf(jobId), value);
    return { ...state, sessions };
  }

  return {
    get: () => state,
    watch(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    session,
    active: () => session(state.activeJobId),
    has: (jobId) => state.sessions.has(keyOf(jobId)),
    open(jobId, seed) {
      const existing = state.sessions.get(keyOf(jobId));
      const base =
        existing === undefined ? withSession(jobId, { ...EMPTY_TAILOR_JOB, ...seed() }) : state;
      publish({ ...base, activeJobId: jobId });
    },
    ensure(jobId, seed) {
      if (state.sessions.has(keyOf(jobId))) return;
      publish(withSession(jobId, { ...EMPTY_TAILOR_JOB, ...seed() }));
    },
    patch(jobId, patch) {
      const current = session(jobId);
      const changes = typeof patch === 'function' ? patch(current) : patch;
      publish(withSession(jobId, { ...current, ...changes }));
    },
    reset() {
      publish(EMPTY_STATE);
    },
  };
}
