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

/**
 * What the user types to add an application by hand — or reviews after a paste.
 *
 * ============================================================================
 * EVERY FIELD IS A STRING, INCLUDING THE SALARY. THAT IS ON PURPOSE.
 * ============================================================================
 * This is what is in the boxes, not what will be stored. A half-typed "450" on
 * the way to "45000" is a legitimate intermediate state, and a draft typed as
 * `number | null` would have to invent an answer for it. `createEntry` is the
 * one place strings become the row's real types, and `validateDraft` is the one
 * place the user is told a box will not read.
 *
 * The six advert fields below arrived with the paste-and-review flow. They are
 * here rather than in a second structure because an extraction that cannot be
 * REVIEWED must not be saved, and a field with nowhere to be reviewed would
 * have to be either silently persisted or silently dropped. Both are wrong.
 * Every one of them is optional to the user: an advert that says nothing about
 * pay produces empty boxes, never a zero.
 */
export interface ApplicationDraft {
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly status: ApplicationStatus;
  readonly description: string;
  readonly url: string;
  /** `YYYY-MM-DD`, or empty. */
  readonly postedDate: string;
  /** A yearly figure as typed — `45000`, `£45,000`. Empty means not stated. */
  readonly salaryMin: string;
  readonly salaryMax: string;
  /** A three-letter ISO-4217 code as typed, or empty. */
  readonly salaryCurrency: string;
}

export type DraftField =
  | 'title'
  | 'company'
  | 'location'
  | 'description'
  | 'url'
  | 'postedDate'
  | 'salaryMin'
  | 'salaryMax'
  | 'salaryCurrency';

export type DraftErrors = Partial<Record<DraftField, string>>;

/** A blank draft. The form's starting point, and the paste fall-through's base. */
export const EMPTY_DRAFT: ApplicationDraft = {
  title: '',
  company: '',
  location: '',
  status: 'saved',
  description: '',
  url: '',
  postedDate: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: '',
};

/**
 * The longest a single line of an advert may be.
 *
 * Not a database limit — SQLite would take a megabyte — but a paste guard. The
 * realistic way this field gets a 4,000-character value is somebody copying a
 * whole advert into the title box, and a card is unreadable long before that.
 */
export const MAX_FIELD_LENGTH = 200;

/**
 * The longest link that will be accepted.
 *
 * 2,000 characters is the practical ceiling every browser and server agrees on
 * for a URL. A job-board link with a tracking payload genuinely reaches four
 * figures, so `MAX_FIELD_LENGTH` would reject real adverts.
 */
export const MAX_URL_LENGTH = 2000;

/**
 * The longest description that will be accepted.
 *
 * Generous on purpose: when an extraction fails, the user's ENTIRE paste is put
 * in this box so nothing they copied is lost, and a whole advert with a quoted
 * email thread attached runs to tens of thousands of characters. The cap exists
 * only to stop a runaway paste — a clipboard holding a PDF's worth of text —
 * being written to the row without anyone being told.
 */
export const MAX_DESCRIPTION_LENGTH = 50_000;

/** `YYYY-MM-DD` and nothing else. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a salary the way somebody copying one off an advert would type it.
 *
 * `£45,000` and `45000` are the same number, and a form that accepts one and
 * refuses the other is a form that makes the user feel stupid for pasting. What
 * it will NOT do is guess: `about forty grand` and `45k` return null, because
 * "45k" could as easily be 45 as 45,000 and this is the one field where being
 * wrong costs the user a decision.
 */
export function readSalaryField(raw: string): number | null {
  const trimmed = raw
    .trim()
    .replace(/^[£$€¥]\s*/, '')
    .replace(/,/g, '')
    .trim();
  if (trimmed === '' || !/^-?\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Is this box empty once the whitespace is gone? */
function blank(value: string): boolean {
  return value.trim() === '';
}

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

  // ── The advert fields. All optional; only what is filled in is checked. ───

  if (draft.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    errors.description =
      `That description is longer than ${MAX_DESCRIPTION_LENGTH.toLocaleString()} characters. ` +
      'Trim it to the part of the advert you want to keep.';
  }

  if (draft.url.trim().length > MAX_URL_LENGTH) {
    errors.url = `That link is too long. Keep it to ${MAX_URL_LENGTH} characters or fewer.`;
  }

  if (!blank(draft.postedDate)) {
    const value = draft.postedDate.trim();
    // Both halves matter: `18/08/2026` is the wrong shape, and `2026-13-45` is
    // the right shape and not a day that exists.
    const parsed = ISO_DATE.test(value) ? new Date(`${value}T00:00:00Z`) : null;
    if (parsed === null || Number.isNaN(parsed.getTime())) {
      errors.postedDate =
        'Write the date the advert went up as YYYY-MM-DD, for example 2026-08-18.';
    }
  }

  const salaryMin = blank(draft.salaryMin) ? null : readSalaryField(draft.salaryMin);
  const salaryMax = blank(draft.salaryMax) ? null : readSalaryField(draft.salaryMax);

  if (!blank(draft.salaryMin) && salaryMin === null) {
    errors.salaryMin = 'Write the salary as a plain yearly number, for example 45000.';
  } else if (salaryMin !== null && salaryMin < 0) {
    errors.salaryMin =
      'A salary cannot be less than zero. Leave it blank if the advert did not say.';
  }

  if (!blank(draft.salaryMax) && salaryMax === null) {
    errors.salaryMax = 'Write the salary as a plain yearly number, for example 55000.';
  } else if (salaryMax !== null && salaryMax < 0) {
    errors.salaryMax =
      'A salary cannot be less than zero. Leave it blank if the advert did not say.';
  } else if (
    salaryMin !== null &&
    salaryMax !== null &&
    errors.salaryMin === undefined &&
    salaryMin > salaryMax
  ) {
    errors.salaryMax = 'The top of the range is below the bottom. Swap the two figures over.';
  }

  if (!blank(draft.salaryCurrency) && !/^[A-Za-z]{3}$/.test(draft.salaryCurrency.trim())) {
    errors.salaryCurrency = 'Use the three-letter code for the currency, for example GBP.';
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

  const salaryMin = readSalaryField(draft.salaryMin);
  const salaryMax = readSalaryField(draft.salaryMax);
  const hasSalary = salaryMin !== null || salaryMax !== null;

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
    salary_min: salaryMin,
    salary_max: salaryMax,
    // Stored upper-case: `Job.salary_currency` is documented as ISO-4217, and
    // "gbp" and "GBP" sorting as two currencies is a bug waiting for a report.
    salary_currency: trimmed(draft.salaryCurrency)?.toUpperCase() ?? null,
    /*
     * `'year'` whenever there is a figure at all, and `null` when there is not.
     *
     * NOT A GUESS, on either path into this function. The extraction pipeline
     * forces a day rate, an hourly rate and pro-rata pay to null precisely so
     * that anything reaching here is annual (see `extraction-clamp.ts`), and
     * the form's own label says "a year" to the user typing one by hand. The
     * field exists because Reed's period-less figures once made a good contract
     * look like an insulting permanent salary — so leaving it null when a
     * figure IS present would reintroduce exactly the ambiguity it was added
     * to remove.
     */
    salary_period: hasSalary ? 'year' : null,
    description: trimmed(draft.description),
    url: trimmed(draft.url),
    posted_date: trimmed(draft.postedDate),
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
