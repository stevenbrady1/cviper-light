/**
 * Migration 0006 (L-205), run for real.
 *
 * Every other test in `src/db` mocks the SQL driver, which cannot say whether
 * a migration is valid SQL, whether it keeps a user's existing rows, or whether
 * `ON DELETE SET NULL` does what the feature depends on. This one applies the
 * actual `.sql` files, in order, to a real in-memory SQLite (`node:sqlite`),
 * with foreign keys ON exactly as `sqlx` opens every connection.
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
];
const MIGRATION = '0006_interview_substages.sql';

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

/** A database as a user of the previous release has it, with data in it. */
function existingDatabase(): DatabaseSync {
  const db = database();
  for (const file of BEFORE) db.exec(sqlOf(file));

  db.exec(`
    INSERT INTO jobs (id, source, title, company, created_at)
      VALUES ('job-1', 'manual', 'Credit Risk Analyst', 'Barclays', '2026-09-01T09:00:00.000Z'),
             ('job-2', 'manual', 'Quant Developer', 'Man Group', '2026-09-02T09:00:00.000Z');
    INSERT INTO applications (id, job_id, status, applied_date, notes, updated_at)
      VALUES ('app-1', 'job-1', 'interviewing', '2026-09-03', 'Second round booked.', '2026-09-04T09:00:00.000Z'),
             ('app-2', 'job-2', 'saved', NULL, NULL, '2026-09-05T09:00:00.000Z');
    INSERT INTO documents (id, application_id, kind, title, text, created_at)
      VALUES ('doc-1', 'app-1', 'cover_letter', 'Letter', 'Dear hiring manager', '2026-09-04T10:00:00.000Z');
  `);
  return db;
}

describe('migration 0006 on a database that already holds data', () => {
  it('applies cleanly and keeps every existing row exactly as it was', () => {
    const db = existingDatabase();
    const before = db.prepare('SELECT * FROM applications ORDER BY id').all();

    db.exec(sqlOf(MIGRATION));

    const after = db.prepare('SELECT * FROM applications ORDER BY id').all();
    expect(after).toHaveLength(2);
    // Same values in every old column; the one new column reads NULL.
    expect(after.map((row) => ({ ...row, interview_substage_id: undefined }))).toEqual(
      before.map((row) => ({ ...row, interview_substage_id: undefined })),
    );
    expect(after.map((row) => row['interview_substage_id'])).toEqual([null, null]);

    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM interview_substages').get()).toEqual({ n: 0 });
  });

  it('is the migration that follows 0005, and nothing earlier was edited to make room', () => {
    // Applying 0001-0005 alone must still give a working database with no new
    // table: if an old file had been extended, this would already have it.
    const db = existingDatabase();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row['name']);
    expect(tables).not.toContain('interview_substages');
  });

  it('lets a card take a sub-stage after the migration', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    db.exec(`
      INSERT INTO interview_substages (id, name, position) VALUES ('sub-1', 'HR Screen', 0);
      UPDATE applications SET interview_substage_id = 'sub-1' WHERE id = 'app-1';
    `);
    expect(
      db.prepare("SELECT interview_substage_id AS s FROM applications WHERE id = 'app-1'").get(),
    ).toEqual({ s: 'sub-1' });
  });
});

describe('removing a sub-stage that cards use', () => {
  it('leaves the cards in place with no sub-stage, and loses nothing else', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    db.exec(`
      INSERT INTO interview_substages (id, name, position)
        VALUES ('sub-1', 'HR Screen', 0), ('sub-2', 'Panel Round', 1);
      UPDATE applications SET interview_substage_id = 'sub-1' WHERE id = 'app-1';
    `);

    db.exec("DELETE FROM interview_substages WHERE id = 'sub-1';");

    expect(
      db
        .prepare(
          "SELECT status, notes, interview_substage_id AS s FROM applications WHERE id = 'app-1'",
        )
        .get(),
    ).toEqual({ status: 'interviewing', notes: 'Second round booked.', s: null });
    expect(db.prepare('SELECT COUNT(*) AS n FROM applications').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 1 });
    // The other sub-stage is untouched.
    expect(db.prepare('SELECT id FROM interview_substages').all()).toEqual([{ id: 'sub-2' }]);
  });

  it('refuses a card that names a sub-stage which does not exist', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect(() =>
      db.exec("UPDATE applications SET interview_substage_id = 'ghost' WHERE id = 'app-1';"),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('deleting a job still cascades its application, sub-stage or not', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    db.exec(`
      INSERT INTO interview_substages (id, name, position) VALUES ('sub-1', 'HR Screen', 0);
      UPDATE applications SET interview_substage_id = 'sub-1' WHERE id = 'app-1';
      DELETE FROM jobs WHERE id = 'job-1';
    `);
    expect(db.prepare('SELECT id FROM applications').all()).toEqual([{ id: 'app-2' }]);
    // A sub-stage belongs to the user, not to a card: it survives.
    expect(db.prepare('SELECT COUNT(*) AS n FROM interview_substages').get()).toEqual({ n: 1 });
  });
});

describe('a fresh database', () => {
  it('runs all six migrations in order without error', () => {
    const db = database();
    for (const file of [...BEFORE, MIGRATION]) db.exec(sqlOf(file));
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'interview_substages'").all(),
    ).toHaveLength(1);
  });
});
