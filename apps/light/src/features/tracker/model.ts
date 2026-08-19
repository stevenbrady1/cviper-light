/**
 * The tracker's data shapes and rules, with no React in sight.
 *
 * Everything a board needs to decide WHAT to show lives here so it can be
 * tested without rendering anything: the five columns, how a job and its
 * application are paired, and what makes a new entry valid.
 */
import {
  type Application,
  type ApplicationStatus,
  type IsoTimestamp,
  type Job,
} from '@cviper/core-types';

import { toLocalIsoDate } from '../../lib/dates';

/** A job and the application chasing it, as one thing the board can draw. */
export interface TrackerEntry {
  readonly application: Application;
  readonly job: Job;
}

/**
 * The five columns, in pipeline order.
 *
 * EXACTLY the five `ApplicationStatus` values, in the order an application
 * moves through them. They map 1:1 onto the CViper web app's board columns (see
 * `entities.ts`), so a sixth column here is not a UI decision — it is a schema
 * change that breaks the export format.
 */
export const TRACKER_COLUMNS: readonly ApplicationStatus[] = [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'rejected',
];

/** Sentence case, and the same word wherever the status appears. */
export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};

/**
 * The status pill's colours.
 *
 * The grammar, applied strictly: teal for the states where something is
 * genuinely happening, red for `rejected` and NOTHING ELSE, plain ink for the
 * rest. `offer` is teal rather than a fifth colour — a good outcome is still
 * "present and moving", and inventing a green-that-is-not-teal for one pill is
 * how a palette starts to grow.
 */
export const STATUS_PILL_TONES: Record<ApplicationStatus, string> = {
  saved: 'bg-sunken text-ink-muted',
  applied: 'bg-sunken text-ink-muted',
  interviewing: 'bg-teal/10 text-teal',
  offer: 'bg-teal/10 text-teal',
  rejected: 'bg-danger/10 text-danger',
};

/**
 * Pair each application with its job.
 *
 * An application whose job is missing is DROPPED, not rendered with blanks. The
 * foreign key makes that impossible through the app's own writes (see
 * `db/applications.ts`), so it can only come from a half-finished import — and
 * a card with no title and no company is not something a user can act on or
 * even identify.
 */
export function joinEntries(
  jobs: readonly Job[],
  applications: readonly Application[],
): TrackerEntry[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));

  const entries: TrackerEntry[] = [];
  for (const application of applications) {
    const job = byId.get(application.job_id);
    if (job === undefined) continue;
    entries.push({ application, job });
  }
  return entries;
}

/**
 * Split the entries into their columns, newest movement first.
 *
 * Every column is always present, even when empty — a board that renders three
 * columns because two are empty is a board whose layout jumps around as the
 * user works.
 */
export function groupByStatus(
  entries: readonly TrackerEntry[],
): Record<ApplicationStatus, TrackerEntry[]> {
  const grouped: Record<ApplicationStatus, TrackerEntry[]> = {
    saved: [],
    applied: [],
    interviewing: [],
    offer: [],
    rejected: [],
  };

  for (const entry of entries) {
    grouped[entry.application.status].push(entry);
  }

  for (const status of TRACKER_COLUMNS) {
    // Most recently touched at the top, with `id` as the tie-break so two cards
    // saved in the same millisecond do not swap places between renders.
    grouped[status].sort((left, right) => {
      const byUpdated = right.application.updated_at.localeCompare(left.application.updated_at);
      return byUpdated !== 0 ? byUpdated : left.application.id.localeCompare(right.application.id);
    });
  }

  return grouped;
}

// --- New entries ------------------------------------------------------------

/** What the user types to add an application by hand. */
export interface ApplicationDraft {
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly status: ApplicationStatus;
}

export type DraftField = 'title' | 'company' | 'location';

export type DraftErrors = Partial<Record<DraftField, string>>;

/**
 * The longest a single line of an advert may be.
 *
 * Not a database limit — SQLite would take a megabyte — but a paste guard. The
 * realistic way this field gets a 4,000-character value is somebody copying a
 * whole advert into the title box, and a card is unreadable long before that.
 */
export const MAX_FIELD_LENGTH = 200;

/**
 * What is wrong with a draft, per field. An empty object means it is fine.
 *
 * Messages say what happened AND what to do, in that order, and never blame the
 * user for it.
 */
export function validateDraft(draft: ApplicationDraft): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.title.trim() === '') {
    errors.title = 'Add a job title so you can tell this card from the others.';
  } else if (draft.title.trim().length > MAX_FIELD_LENGTH) {
    errors.title = `Job title is too long. Keep it to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }

  if (draft.company.trim() === '') {
    errors.company = 'Add the company so you know who you applied to.';
  } else if (draft.company.trim().length > MAX_FIELD_LENGTH) {
    errors.company = `Company is too long. Keep it to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }

  // Location is optional — plenty of adverts do not say — so only its length is
  // checked.
  if (draft.location.trim().length > MAX_FIELD_LENGTH) {
    errors.location = `Location is too long. Keep it to ${MAX_FIELD_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function draftIsValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0;
}

/**
 * Turn a valid draft into the two rows that have to be written.
 *
 * Ids are passed IN rather than generated here, so this stays a pure function
 * that a test can assert exactly. The data layer's rule is that ids are UUIDs
 * made by the caller (see `db/index.ts`), and the caller is the component.
 *
 * An empty optional field becomes `null`, never `''`. The data model spells
 * absence as `null` throughout, and an empty string would export as a value the
 * cloud app has to special-case.
 */
export function createEntry(
  draft: ApplicationDraft,
  ids: { readonly jobId: string; readonly applicationId: string },
  now: IsoTimestamp,
): TrackerEntry {
  const trimmed = (value: string): string | null => {
    const text = value.trim();
    return text === '' ? null : text;
  };

  const job: Job = {
    id: ids.jobId,
    source: 'manual',
    // `null` because there is no provider to have given it one. The partial
    // unique index on (source, external_id) is what makes two hand-typed jobs
    // with the same title legal.
    external_id: null,
    title: draft.title.trim(),
    company: draft.company.trim(),
    location: trimmed(draft.location),
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: now,
  };

  const application: Application = {
    id: ids.applicationId,
    job_id: job.id,
    status: draft.status,
    // Set the moment the user says they applied, not before — see
    // `withStatus`.
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: now,
  };

  return { application, job };
}

/**
 * Move an application to a new status.
 *
 * `updated_at` moves too, because that is exactly what the staleness edge
 * measures: the last time anything happened. A status change that left the
 * timestamp alone would show a card as three weeks cold seconds after the user
 * dragged it.
 */
export function withStatus(
  application: Application,
  status: ApplicationStatus,
  now: IsoTimestamp,
): Application {
  return {
    ...application,
    status,
    // Record WHEN they applied, the first time they say they did. Not
    // overwritten afterwards: moving a card back and forth must not rewrite the
    // date on the application itself.
    //
    // The date comes from `toLocalIsoDate`, NOT from slicing the first ten
    // characters off the UTC timestamp. At 00:30 on a British summer evening
    // those two differ by a day, and the user would see themselves applying
    // tomorrow.
    applied_date:
      status === 'applied' && application.applied_date === null
        ? (toLocalIsoDate(new Date(now)) ?? application.applied_date)
        : application.applied_date,
    updated_at: now,
  };
}

/**
 * Apply an edit and stamp it.
 *
 * Every mutation funnels through here or `withStatus`, so there is exactly one
 * answer to "does this count as movement" — and it is yes, always. A note the
 * user wrote today IS the application moving.
 */
export function withEdit(
  application: Application,
  changes: Partial<Pick<Application, 'notes' | 'next_action' | 'next_action_date'>>,
  now: IsoTimestamp,
): Application {
  return { ...application, ...changes, updated_at: now };
}
