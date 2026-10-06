/**
 * Migration 0007 (L-199), run for real.
 *
 * Applies the actual `.sql` files, in order, to an in-memory SQLite
 * (`node:sqlite`) with foreign keys ON, as `sqlx` opens every connection —
 * over a database shaped like a 0.6.0 user's (0001-0006), with real rows in
 * every table the new one touches.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const DIR = new URL('../../src-tauri/migrations/', import.meta.url);

function sqlOf(file: string): string {
  return readFileSync(new URL(file, DIR), 'utf8');
}

const BEFORE = [
  '0001_init.sql',
  '0002_cv_json_resume.sql',
  '0003_profile.sql',
  '0004_documents.sql',
  '0005_job_agency.sql',
  '0006_interview_substages.sql',
];
const MIGRATION = '0007_job_workflow.sql';

/** Every user table, so "nothing else changed" is checked table by table. */
const OLD_TABLES = [
  'jobs',
  'applications',
  'cvs',
  'analyses',
  'profile',
  'documents',
  'interview_substages',
];

/** A database as a 0.6.0 user has it, with data in it. */
function existingDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of BEFORE) db.exec(sqlOf(file));

  db.exec(`
    INSERT INTO jobs (id, source, title, company, description, created_at)
      VALUES ('job-1', 'manual', 'Credit Risk Analyst', 'Barclays', 'SQL and Python.', '2026-09-01T09:00:00.000Z'),
             ('job-2', 'reed', 'Quant Developer', 'Man Group', NULL, '2026-09-02T09:00:00.000Z');
    INSERT INTO cvs (id, name, file_path, extracted_text, created_at)
      VALUES ('cv-1', 'CV.docx', NULL, 'Steve Brady. Credit risk.', '2026-08-01T09:00:00.000Z');
    INSERT INTO analyses (id, cv_id, job_id, provider, model, match_score, result_json, created_at)
      VALUES ('an-1', 'cv-1', 'job-1', 'keyword', 'keyword', 64, '{}', '2026-09-03T09:00:00.000Z');
    INSERT INTO interview_substages (id, name, position) VALUES ('sub-1', 'HR Screen', 0);
    INSERT INTO applications (id, job_id, status, applied_date, notes, updated_at, interview_substage_id)
      VALUES ('app-1', 'job-1', 'interviewing', '2026-09-03', 'Second round booked.', '2026-09-04T09:00:00.000Z', 'sub-1'),
             ('app-2', 'job-2', 'saved', NULL, NULL, '2026-09-05T09:00:00.000Z', NULL);
    INSERT INTO documents (id, application_id, kind, title, text, created_at)
      VALUES ('doc-1', 'app-1', 'cv', 'Tailored CV — Credit Risk Analyst', 'PROFESSIONAL SUMMARY', '2026-09-04T10:00:00.000Z');
  `);
  return db;
}

function snapshot(db: DatabaseSync): Record<string, unknown[]> {
  return Object.fromEntries(
    OLD_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]),
  );
}

function tables(db: DatabaseSync): unknown[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row['name']);
}

function workflow(db: DatabaseSync, id: string, cvId: string | null): void {
  db.prepare(
    `INSERT INTO job_workflow (id, step, cv_id, ai_option, advert, draft_json, updated_at)
       VALUES (?, 'tailor', ?, 'ollama:llama3.1:8b', 'SQL and Python.', '{"result":null}', '2026-10-06T09:00:00.000Z')`,
  ).run(id, cvId);
}

describe('migration 0007 on a 0.6.0 database that holds data', () => {
  it('applies cleanly and leaves every existing row in every table exactly as it was', () => {
    const db = existingDatabase();
    const before = snapshot(db);

    db.exec(sqlOf(MIGRATION));

    expect(snapshot(db)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_workflow').get()).toEqual({ n: 0 });
  });

  it('is the migration that follows 0006: nothing earlier was edited to make room', () => {
    expect(tables(existingDatabase())).not.toContain('job_workflow');
  });

  it('is safe to run twice (IF NOT EXISTS) — a re-run neither fails nor empties it', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    workflow(db, 'job-1', 'cv-1');
    db.exec(sqlOf(MIGRATION));
    expect(db.prepare('SELECT COUNT(*) AS n FROM job_workflow').get()).toEqual({ n: 1 });
  });

  it('keeps one row per job, and the shared upsert replaces it', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    workflow(db, 'job-1', 'cv-1');
    db.exec(
      `INSERT INTO job_workflow (id, step, cv_id, ai_option, advert, draft_json, updated_at)
         VALUES ('job-1', 'tailor', NULL, NULL, 'Edited.', NULL, '2026-10-06T10:00:00.000Z')
         ON CONFLICT (id) DO UPDATE SET advert = excluded.advert, cv_id = excluded.cv_id`,
    );
    expect(db.prepare('SELECT id, advert, cv_id FROM job_workflow').all()).toEqual([
      { id: 'job-1', advert: 'Edited.', cv_id: null },
    ]);
  });
});

describe('what the work in progress is tied to', () => {
  it('deleting a job deletes its work in progress, and nothing of another job', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    workflow(db, 'job-1', 'cv-1');
    workflow(db, 'job-2', 'cv-1');

    db.exec("DELETE FROM jobs WHERE id = 'job-1';");

    expect(db.prepare('SELECT id FROM job_workflow').all()).toEqual([{ id: 'job-2' }]);
  });

  it('deleting a CV keeps the job’s work, with no CV chosen', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    workflow(db, 'job-1', 'cv-1');

    // The analysis references the CV with ON DELETE CASCADE; it goes too.
    db.exec("DELETE FROM cvs WHERE id = 'cv-1';");

    expect(db.prepare('SELECT id, cv_id, advert FROM job_workflow').all()).toEqual([
      { id: 'job-1', cv_id: null, advert: 'SQL and Python.' },
    ]);
  });

  it('negative: refuses work in progress for a job that does not exist', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect(() => workflow(db, 'ghost', null)).toThrow(/FOREIGN KEY/i);
  });

  it('boundary: step and advert are required; everything else may be empty', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect(() =>
      db.exec(
        "INSERT INTO job_workflow (id, step, advert, updated_at) VALUES ('job-1', NULL, '', 'x')",
      ),
    ).toThrow(/NOT NULL/i);
    db.exec(
      "INSERT INTO job_workflow (id, step, advert, updated_at) VALUES ('job-1', 'tailor', '', 'x')",
    );
    expect(db.prepare('SELECT cv_id, ai_option, draft_json FROM job_workflow').get()).toEqual({
      cv_id: null,
      ai_option: null,
      draft_json: null,
    });
  });
});
