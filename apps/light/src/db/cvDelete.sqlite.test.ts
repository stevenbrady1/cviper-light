/**
 * What deleting and renaming a CV does to everything else, on a REAL SQLite
 * (L-408).
 *
 * Profile's "Delete" tells the user, before they confirm: the saved checks
 * made with this CV go; jobs stay; tailored CVs and letters saved to a job
 * stay. Those sentences are promises about the schema, so this applies the
 * actual migration files, in order, to an in-memory `node:sqlite` with foreign
 * keys ON (as the app opens every connection, `db/client.ts`) and runs the
 * app's own statements. If a migration ever changed a rule, the warning would
 * be untrue and this goes red.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { type Cv } from '@cviper/core-types';

import { cvFromRow, cvToValues } from './rows';
import { deleteFrom, upsertInto } from './statements';

const DIR = new URL('../../src-tauri/migrations/', import.meta.url);

const CV_KEPT = 'cv-kept';
const CV_GONE = 'cv-gone';

/** The app's database as it is today: every migration, then one user's data. */
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(new URL(file, DIR), 'utf8'));
  }

  db.exec(`
    INSERT INTO jobs (id, source, title, company, description, created_at)
      VALUES ('job-1', 'manual', 'Credit Risk Analyst', 'Barclays', 'SQL and Python.', '2026-09-01T09:00:00.000Z'),
             ('job-2', 'manual', 'Quant Developer', 'Man Group', NULL, '2026-09-02T09:00:00.000Z');
    INSERT INTO applications (id, job_id, status, applied_date, notes, updated_at)
      VALUES ('app-1', 'job-1', 'applied', '2026-09-03', 'Second round booked.', '2026-09-04T09:00:00.000Z'),
             ('app-2', 'job-2', 'saved', NULL, NULL, '2026-09-05T09:00:00.000Z');
    INSERT INTO cvs (id, name, file_path, extracted_text, created_at, json_resume, original_text)
      VALUES ('${CV_GONE}', 'Old CV.docx', NULL, 'Credit risk.', '2026-08-01T09:00:00.000Z', NULL, 'As first read.'),
             ('${CV_KEPT}', 'New CV.pdf', NULL, 'Credit risk, newer.', '2026-08-20T09:00:00.000Z', NULL, NULL);
    INSERT INTO analyses (id, cv_id, job_id, provider, model, match_score, result_json, created_at)
      VALUES ('an-1', '${CV_GONE}', 'job-1', 'keyword', 'keyword', 64, '{}', '2026-09-03T09:00:00.000Z'),
             ('an-2', '${CV_GONE}', NULL, 'keyword', 'keyword', 50, '{}', '2026-09-03T10:00:00.000Z'),
             ('an-3', '${CV_KEPT}', 'job-2', 'keyword', 'keyword', 71, '{}', '2026-09-04T09:00:00.000Z');
    INSERT INTO job_workflow (id, step, cv_id, ai_option, advert, draft_json, updated_at)
      VALUES ('job-1', 'tailor', '${CV_GONE}', 'keyword', 'SQL and Python.', '{"draft":true}', '2026-09-04T10:00:00.000Z'),
             ('job-2', 'analyse', '${CV_KEPT}', NULL, 'C++.', NULL, '2026-09-05T10:00:00.000Z');
    INSERT INTO documents (id, application_id, kind, title, text, created_at)
      VALUES ('doc-1', 'app-1', 'cv', 'Tailored CV', 'PROFESSIONAL SUMMARY', '2026-09-04T11:00:00.000Z'),
             ('doc-2', 'app-1', 'cover_letter', 'Cover letter', 'Dear hiring manager', '2026-09-04T11:05:00.000Z');
  `);
  return db;
}

function all(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
}

function ids(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`SELECT id FROM ${table} ORDER BY id`)
    .all()
    .map((row) => String(row.id));
}

/** The app's own statement. It uses `$1`; node:sqlite names that parameter `$1` too. */
function deleteCv(db: DatabaseSync, id: string): number {
  return Number(db.prepare(deleteFrom('cvs')).run({ $1: id } as never).changes);
}

/** The app's own upsert, bound the way `upsertCv` binds it. */
function saveCv(db: DatabaseSync, cv: Cv): void {
  const values = cvToValues(cv);
  const named = Object.fromEntries(values.map((value, index) => [`$${String(index + 1)}`, value]));
  db.prepare(upsertInto('cvs')).run(named as never);
}

function readCv(db: DatabaseSync, id: string): Cv {
  const row = db.prepare('SELECT * FROM cvs WHERE id = ?').get(id);
  const cv = cvFromRow(row);
  if (!cv.ok) throw new Error(cv.error.message);
  return cv.value;
}

describe('deleting a CV, on the real schema (L-408)', () => {
  it('takes the saved checks made with that CV, and only those', () => {
    const db = database();

    expect(deleteCv(db, CV_GONE)).toBe(1);

    expect(ids(db, 'cvs')).toEqual([CV_KEPT]);
    expect(ids(db, 'analyses')).toEqual(['an-3']);
  });

  it('keeps every job, application and saved document exactly as it was', () => {
    const db = database();
    const before = {
      jobs: all(db, 'jobs'),
      applications: all(db, 'applications'),
      documents: all(db, 'documents'),
    };

    deleteCv(db, CV_GONE);

    expect(all(db, 'jobs')).toEqual(before.jobs);
    expect(all(db, 'applications')).toEqual(before.applications);
    expect(all(db, 'documents')).toEqual(before.documents);
    expect(ids(db, 'documents')).toEqual(['doc-1', 'doc-2']);
  });

  it('keeps the job’s work in progress and only forgets which CV it used', () => {
    const db = database();

    deleteCv(db, CV_GONE);

    // The job still opens on its step, advert and unsaved draft. `cv_id` is
    // NULL, which Tailor reads as "use the newest CV" (`Tailor.tsx`).
    expect(all(db, 'job_workflow')).toEqual([
      {
        id: 'job-1',
        step: 'tailor',
        cv_id: null,
        ai_option: 'keyword',
        advert: 'SQL and Python.',
        draft_json: '{"draft":true}',
        updated_at: '2026-09-04T10:00:00.000Z',
      },
      {
        id: 'job-2',
        step: 'analyse',
        cv_id: CV_KEPT,
        ai_option: null,
        advert: 'C++.',
        draft_json: null,
        updated_at: '2026-09-05T10:00:00.000Z',
      },
    ]);
  });

  it('boundary: deleting the last CV leaves no CV and no check, and every job', () => {
    const db = database();

    deleteCv(db, CV_GONE);
    deleteCv(db, CV_KEPT);

    expect(ids(db, 'cvs')).toEqual([]);
    expect(ids(db, 'analyses')).toEqual([]);
    expect(ids(db, 'jobs')).toEqual(['job-1', 'job-2']);
    expect(ids(db, 'documents')).toEqual(['doc-1', 'doc-2']);
    expect(db.prepare('SELECT cv_id FROM job_workflow').all()).toEqual([
      { cv_id: null },
      { cv_id: null },
    ]);
  });

  it('negative: an id that is not there deletes nothing', () => {
    const db = database();

    expect(deleteCv(db, 'cv-nobody')).toBe(0);

    expect(ids(db, 'cvs')).toEqual([CV_GONE, CV_KEPT]);
    expect(ids(db, 'analyses')).toEqual(['an-1', 'an-2', 'an-3']);
  });

  it('negative: an id holding SQL or quotes is data, never code', () => {
    const db = database();

    deleteCv(db, "x' OR '1'='1");

    expect(ids(db, 'cvs')).toEqual([CV_GONE, CV_KEPT]);
  });

  it('negative: without foreign keys on, the checks would be orphaned — which is why the app turns them on', () => {
    const db = database();
    db.exec('PRAGMA foreign_keys = OFF;');

    deleteCv(db, CV_GONE);

    // Proof this file can fail: the cascade is the pragma's doing.
    expect(ids(db, 'analyses')).toEqual(['an-1', 'an-2', 'an-3']);
  });
});

describe('renaming a CV, on the real schema (L-408)', () => {
  it('changes the name and nothing else: not its checks, text, date or its place in a job', () => {
    const db = database();
    const before = readCv(db, CV_GONE);
    const others = {
      analyses: all(db, 'analyses'),
      job_workflow: all(db, 'job_workflow'),
      documents: all(db, 'documents'),
    };

    // An upsert that REPLACED the row would delete it first and cascade.
    saveCv(db, { ...before, name: 'Banking CV' });

    expect(readCv(db, CV_GONE)).toEqual({ ...before, name: 'Banking CV' });
    expect(readCv(db, CV_GONE).original_text).toBe('As first read.');
    expect(ids(db, 'cvs')).toEqual([CV_GONE, CV_KEPT]);
    expect(all(db, 'analyses')).toEqual(others.analyses);
    expect(all(db, 'job_workflow')).toEqual(others.job_workflow);
    expect(all(db, 'documents')).toEqual(others.documents);
  });

  it('boundary: a name with quotes, a semicolon and 100 emoji is stored as typed', () => {
    const db = database();
    const name = `Robert'); DROP TABLE cvs; -- ${'📄'.repeat(100)}`;

    saveCv(db, { ...readCv(db, CV_KEPT), name });

    expect(readCv(db, CV_KEPT).name).toBe(name);
    expect(ids(db, 'cvs')).toEqual([CV_GONE, CV_KEPT]);
  });
});
