/**
 * The I/O half of export and import.
 *
 * `@cviper/core-types` owns the pure half: `exportBackup` turns a payload into
 * the exact bytes that go on disk, and `importBackup` validates bytes back into
 * a payload. Neither touches a database, and neither is duplicated here.
 *
 * This file does the reading and the writing:
 *
 *     export:  readAll()  ->  exportBackup({ ...snapshot, exportedAt, app })
 *     import:  importBackup(text)  ->  writeAll(payload)
 *
 * Validation belongs to `importBackup` and is not repeated in `writeAll`. What
 * `writeAll` owns is the promise `importBackup` cannot keep on its own: that a
 * failure part-way through leaves the database exactly as it was.
 */
import {
  PROFILE_ID,
  ok,
  type Analysis,
  type Application,
  type Cv,
  type Document,
  type Job,
  type Profile,
  type Result,
} from '@cviper/core-types';

import { withDb } from './client';
import { type DbError } from './errors';
import {
  analysisFromRow,
  analysisToValues,
  applicationFromRow,
  applicationToValues,
  cvFromRow,
  cvToValues,
  documentFromRow,
  documentToValues,
  jobFromRow,
  jobToValues,
  mapRows,
  profileFromRow,
  profileToValues,
  type SqlValue,
} from './rows';
import { selectFrom, upsertInto } from './statements';

/**
 * Everything in the database, in the shape the export format uses: the five
 * collections and the one profile row.
 *
 * Structurally a subset of `BackupPayload`, so a payload straight out of
 * `importBackup` can be handed to `writeAll` unchanged, and a snapshot out of
 * `readAll` only needs `exportedAt` and `app` added to become one.
 */
export interface DbSnapshot {
  /** `null` until the user has saved one. */
  profile: Profile | null;
  jobs: Job[];
  applications: Application[];
  documents: Document[];
  cvs: Cv[];
  analyses: Analysis[];
}

// `ORDER BY id` because the export format is deterministic and sorts by id.
// Reading in that order means a re-export of untouched data is byte-identical
// without anything having to sort it again.
const SELECT_JOBS = `${selectFrom('jobs')} ORDER BY id`;
const SELECT_CVS = `${selectFrom('cvs')} ORDER BY id`;
const SELECT_APPLICATIONS = `${selectFrom('applications')} ORDER BY id`;
const SELECT_ANALYSES = `${selectFrom('analyses')} ORDER BY id`;
const SELECT_DOCUMENTS = `${selectFrom('documents')} ORDER BY id`;
// One row, by its fixed id. No ORDER BY: there is nothing to order.
const SELECT_PROFILE = `${selectFrom('profile')} WHERE id = $1`;

const UPSERT_JOB = upsertInto('jobs');
const UPSERT_CV = upsertInto('cvs');
const UPSERT_APPLICATION = upsertInto('applications');
const UPSERT_DOCUMENT = upsertInto('documents');
const UPSERT_ANALYSIS = upsertInto('analyses');
const UPSERT_PROFILE = upsertInto('profile');

/**
 * PARENTS FIRST. Foreign keys are enforced, so an application inserted before
 * its job, or an analysis before its CV, fails immediately. Jobs and CVs have
 * no parents; applications need jobs; documents need applications; analyses
 * need CVs and may reference jobs. The profile has no parent and no children
 * and is written last, inside the same transaction — see `writeAll`.
 */
const WRITE_ORDER = ['jobs', 'cvs', 'applications', 'documents', 'analyses'] as const;

/**
 * Read the whole database.
 *
 * All six reads happen inside ONE `withDb` section, so nothing the app does
 * elsewhere can land between them and produce a snapshot containing an
 * application whose job is missing, or a document whose application is.
 */
export async function readAll(): Promise<Result<DbSnapshot, DbError>> {
  const raw = await withDb(async (db) => ({
    jobs: await db.select<unknown[]>(SELECT_JOBS),
    cvs: await db.select<unknown[]>(SELECT_CVS),
    applications: await db.select<unknown[]>(SELECT_APPLICATIONS),
    analyses: await db.select<unknown[]>(SELECT_ANALYSES),
    documents: await db.select<unknown[]>(SELECT_DOCUMENTS),
    profile: await db.select<unknown[]>(SELECT_PROFILE, [PROFILE_ID]),
  }));
  if (!raw.ok) return raw;

  const jobs = mapRows(raw.value.jobs, jobFromRow);
  if (!jobs.ok) return jobs;

  const cvs = mapRows(raw.value.cvs, cvFromRow);
  if (!cvs.ok) return cvs;

  const applications = mapRows(raw.value.applications, applicationFromRow);
  if (!applications.ok) return applications;

  const analyses = mapRows(raw.value.analyses, analysisFromRow);
  if (!analyses.ok) return analyses;

  const documents = mapRows(raw.value.documents, documentFromRow);
  if (!documents.ok) return documents;

  const profiles = mapRows(raw.value.profile, profileFromRow);
  if (!profiles.ok) return profiles;

  return ok({
    profile: profiles.value[0] ?? null,
    jobs: jobs.value,
    applications: applications.value,
    documents: documents.value,
    cvs: cvs.value,
    analyses: analyses.value,
  });
}

/**
 * Write a whole snapshot, as one transaction.
 *
 * ============================================================================
 * THIS MERGES. IT DOES NOT REPLACE.
 * ============================================================================
 * Every row is an upsert keyed on `id`: a row already in the database with the
 * same id is updated, a new id is inserted, and NOTHING IS EVER DELETED. So
 * importing a backup can add to what the user has but can never silently
 * destroy work they did after the export was taken.
 *
 * A destructive restore ("make the database exactly match this file") is a
 * different operation with a different confirmation, and is deliberately not
 * what the plain Import button does.
 * ============================================================================
 *
 * ATOMIC. Serialisation happens before the transaction opens, so an
 * unserialisable record writes nothing at all; anything the database rejects
 * triggers a ROLLBACK and the original error is what the caller sees.
 */
export async function writeAll(snapshot: DbSnapshot): Promise<Result<void, DbError>> {
  // Serialise FIRST, outside the transaction. `analysisToValues` and
  // `profileToValues` are the only conversions that can fail, and discovering
  // that half way through an open transaction would mean rolling back work
  // that never needed to start.
  const analyses: SqlValue[][] = [];
  for (const analysis of snapshot.analyses) {
    const values = analysisToValues(analysis);
    if (!values.ok) return values;
    analyses.push(values.value);
  }

  let profile: SqlValue[] | null = null;
  if (snapshot.profile !== null) {
    const values = profileToValues(snapshot.profile);
    if (!values.ok) return values;
    profile = values.value;
  }

  const batches: Record<(typeof WRITE_ORDER)[number], { sql: string; rows: SqlValue[][] }> = {
    jobs: { sql: UPSERT_JOB, rows: snapshot.jobs.map(jobToValues) },
    cvs: { sql: UPSERT_CV, rows: snapshot.cvs.map(cvToValues) },
    applications: {
      sql: UPSERT_APPLICATION,
      rows: snapshot.applications.map(applicationToValues),
    },
    documents: { sql: UPSERT_DOCUMENT, rows: snapshot.documents.map(documentToValues) },
    analyses: { sql: UPSERT_ANALYSIS, rows: analyses },
  };

  return withDb(async (db) => {
    // IMMEDIATE takes the write lock up front. The default deferred BEGIN takes
    // it on the first write and can fail with SQLITE_BUSY mid-transaction,
    // which is a far worse moment to discover the database is in use.
    await db.execute('BEGIN IMMEDIATE;');

    try {
      for (const table of WRITE_ORDER) {
        const batch = batches[table];
        for (const values of batch.rows) {
          await db.execute(batch.sql, values);
        }
      }
      // The profile is a MERGE like every other row: a file with a profile
      // replaces the one row, a file without one leaves it alone. Inside the
      // same transaction, so a profile cannot land while the rest rolls back.
      if (profile !== null) await db.execute(UPSERT_PROFILE, profile);
      await db.execute('COMMIT;');
    } catch (cause) {
      // The ROLLBACK's own failure is deliberately not propagated: the caller
      // needs the reason the IMPORT failed, and a rollback that reports "no
      // transaction is active" means SQLite already rolled back for us. The
      // original error is rethrown either way, so nothing is swallowed.
      await db.execute('ROLLBACK;').catch(() => undefined);
      throw cause;
    }
  });
}
