/**
 * A job's Tailor work, kept across a restart (L-199, part 2).
 *
 * ============================================================================
 * SQLITE STAYS THE SOURCE OF TRUTH; THE STORE IS WHAT THE SCREEN READS
 * ============================================================================
 * `jobSessions.ts` holds the work in memory, keyed by job. This file writes
 * each tracked job's session through to `job_workflow` a moment after it last
 * changed (`WRITE_DELAY_MS`), and reads them all back once at launch. Typing in
 * the advert box is one write when the user pauses, not one per keystroke.
 *
 * What is written: the advert, the CV and model chosen, and the unsaved draft
 * (tailored CV, review, letter, keyword gaps). What is NOT: whether a model was
 * running — that run died with the app — and the half-typed metric boxes.
 *
 * A pasted advert has no job, so it has no row: it lasts as long as the app.
 *
 * ============================================================================
 * THE LAST JOB IS AN ID, NOTHING MORE
 * ============================================================================
 * "Continue where you left off" needs to know which job. That id goes in its
 * own `tauri-plugin-store` file (`WORKFLOW_STORE_FILE`), which "Delete
 * everything" empties like the others; no CV or advert text is ever in it.
 *
 * ============================================================================
 * NOTHING IS WRITTEN BACK AFTER "DELETE EVERYTHING"
 * ============================================================================
 * The wipe resets the store. A write still waiting on its timer at that moment
 * would put the job's text straight back into the database the user just
 * emptied, so a reset cancels every pending write before it can fire.
 */
import {
  CoverLetterSchema,
  DraftReviewSchema,
  TailoredCvSchema,
  type Result,
} from '@cviper/core-types';

import { type DbError } from '../../db/errors';
import { type JobWorkflowRow } from '../../db/workflow';
import {
  EMPTY_TAILOR_JOB,
  trackedJobIds,
  type JobSessions,
  type LetterResult,
  type TailorJobState,
  type TailorResult,
} from './jobSessions';
import { type HandedGaps } from '../flow/handoff';

/** How long after the last change a job's work is written. */
export const WRITE_DELAY_MS = 500;

/** The only step this screen records today. L-200 adds the others. */
export const TAILOR_STEP = 'tailor';

/** The file the last job's id lives in. Erased by "Delete everything". */
export const WORKFLOW_STORE_FILE = 'workflow.json';
const LAST_JOB_KEY = 'lastJobId';

export interface WorkflowPort {
  /** Every job's work in progress. */
  load(): Promise<Result<JobWorkflowRow[], DbError>>;
  /** Write one job's work in progress. */
  save(row: JobWorkflowRow): Promise<Result<void, DbError>>;
  /** The job the user was last on, or `null`. Never throws. */
  readLastJob(): Promise<string | null>;
  /** Remember the job the user is on. Never throws. */
  writeLastJob(jobId: string | null): Promise<void>;
}

/** What `draft_json` holds. Every field optional: an older or partial row still reads. */
interface Draft {
  readonly result?: unknown;
  readonly review?: unknown;
  readonly letter?: unknown;
  readonly handedGaps?: unknown;
}

/** One job's session, as its `job_workflow` row. */
export function toRow(jobId: string, session: TailorJobState, now: string): JobWorkflowRow {
  const hasDraft =
    session.result !== null ||
    session.review !== null ||
    session.letter !== null ||
    session.handedGaps !== null;
  const draft: Draft = {
    result: session.result,
    review: session.review,
    letter: session.letter,
    handedGaps: session.handedGaps,
  };
  return {
    id: jobId,
    step: TAILOR_STEP,
    cv_id: session.cvId,
    ai_option: session.optionKey,
    advert: session.advert,
    draft_json: hasDraft ? JSON.stringify(draft) : null,
    updated_at: now,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The tailored CV, if what was stored is still a valid one. The fabrication
 * report and the rest were computed by this app and are carried as they were;
 * the CV is the part a schema change could leave unreadable.
 */
function resultFrom(value: unknown): TailorResult | null {
  if (!isRecord(value) || !TailoredCvSchema.safeParse(value['cv']).success) return null;
  if (typeof value['text'] !== 'string' || !isRecord(value['report'])) return null;
  return value as unknown as TailorResult;
}

function letterFrom(value: unknown): LetterResult | null {
  if (!isRecord(value) || !CoverLetterSchema.safeParse(value['letter']).success) return null;
  if (typeof value['text'] !== 'string') return null;
  return value as unknown as LetterResult;
}

function gapsFrom(value: unknown): HandedGaps | null {
  if (!isRecord(value) || !Array.isArray(value['gaps'])) return null;
  if (typeof value['cvId'] !== 'string' || typeof value['advert'] !== 'string') return null;
  return value as unknown as HandedGaps;
}

/**
 * A row, back into a session. A draft that cannot be read is DROPPED — the
 * advert and the choices are still the user's work and come back regardless.
 */
export function fromRow(row: JobWorkflowRow): TailorJobState {
  let draft: Draft = {};
  if (row.draft_json !== null) {
    try {
      const parsed: unknown = JSON.parse(row.draft_json);
      if (isRecord(parsed)) draft = parsed;
    } catch {
      // Unreadable: restore the job without its draft. Nothing to report —
      // the user sees the job as it was before they last tailored it.
      draft = {};
    }
  }
  const review = DraftReviewSchema.safeParse(draft.review);
  return {
    ...EMPTY_TAILOR_JOB,
    cvId: row.cv_id,
    optionKey: row.ai_option,
    advert: row.advert,
    result: resultFrom(draft.result),
    review: review.success ? review.data : null,
    letter: letterFrom(draft.letter),
    handedGaps: gapsFrom(draft.handedGaps),
  };
}

/**
 * Put every saved job back in the store, and reopen the last one. Returns the
 * job resumed, or `null`.
 *
 * Never overwrites: a job the user already opened while this was reading is
 * theirs, and so is their choice of what is on screen.
 */
export async function hydrateJobSessions(
  sessions: JobSessions,
  port: WorkflowPort,
): Promise<string | null> {
  const [rows, lastJob] = await Promise.all([port.load(), port.readLastJob()]);
  if (!rows.ok) return null;

  for (const row of rows.value) {
    if (!sessions.has(row.id)) sessions.patch(row.id, fromRow(row));
  }

  const untouched = sessions.get().activeJobId === null && !sessions.has(null);
  if (lastJob === null || !untouched) return null;
  if (!rows.value.some((row) => row.id === lastJob)) return null;
  sessions.open(lastJob, () => ({}));
  return lastJob;
}

/**
 * Write each tracked job's session through to SQLite after `WRITE_DELAY_MS`,
 * and the active job's id to the store file. Returns the function that stops
 * it (and drops anything pending).
 */
export function startWriteThrough(
  sessions: JobSessions,
  port: WorkflowPort,
  now: () => string = () => new Date().toISOString(),
  onError: (message: string) => void = () => undefined,
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let lastJobTimer: ReturnType<typeof setTimeout> | null = null;
  // What is already on disk (or was there at start), by reference.
  const seen = new Map<string, TailorJobState>();
  let seenActive = sessions.get().activeJobId;
  for (const jobId of trackedJobIds(sessions.get())) seen.set(jobId, sessions.session(jobId));

  function cancelAll(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    if (lastJobTimer !== null) clearTimeout(lastJobTimer);
    lastJobTimer = null;
  }

  function write(jobId: string): void {
    timers.delete(jobId);
    const session = sessions.session(jobId);
    seen.set(jobId, session);
    void port.save(toRow(jobId, session, now())).then((saved) => {
      if (saved.ok) return;
      // Forget it was written, so the next change tries again.
      seen.delete(jobId);
      onError(`Your work on this job could not be kept for next time: ${saved.error.message}`);
    });
  }

  const stopWatching = sessions.watch(() => {
    const state = sessions.get();

    // "Delete everything": nothing pending may land after the wipe.
    if (state.sessions.size === 0) {
      cancelAll();
      seen.clear();
      seenActive = state.activeJobId;
      return;
    }

    for (const jobId of trackedJobIds(state)) {
      if (seen.get(jobId) === sessions.session(jobId)) continue;
      const pending = timers.get(jobId);
      if (pending !== undefined) clearTimeout(pending);
      timers.set(
        jobId,
        setTimeout(() => write(jobId), WRITE_DELAY_MS),
      );
    }

    if (state.activeJobId !== seenActive) {
      seenActive = state.activeJobId;
      if (lastJobTimer !== null) clearTimeout(lastJobTimer);
      lastJobTimer = setTimeout(() => {
        lastJobTimer = null;
        void port.writeLastJob(sessions.get().activeJobId);
      }, WRITE_DELAY_MS);
    }
  });

  return () => {
    stopWatching();
    cancelAll();
  };
}

/** The real port: SQLite for the rows, `tauri-plugin-store` for the last job. */
export async function createTauriWorkflowPort(): Promise<WorkflowPort> {
  const { listJobWorkflows, upsertJobWorkflow } = await import('../../db/workflow');
  async function open() {
    // Imported inside the call, as `boards/port.ts` does: rendering a screen
    // should not pull a Tauri plugin into the module graph.
    const { load } = await import('@tauri-apps/plugin-store');
    return load(WORKFLOW_STORE_FILE, { autoSave: false });
  }
  return {
    load: listJobWorkflows,
    save: upsertJobWorkflow,
    async readLastJob() {
      try {
        const value: unknown = await (await open()).get(LAST_JOB_KEY);
        return typeof value === 'string' ? value : null;
      } catch {
        // No file yet, or unreadable: there is simply nothing to resume.
        return null;
      }
    },
    async writeLastJob(jobId) {
      try {
        const store = await open();
        await store.set(LAST_JOB_KEY, jobId);
        await store.save();
      } catch {
        // A convenience. Failing to remember the last job costs one click on
        // the next launch; it must never surface as an error mid-task.
      }
    },
  };
}
