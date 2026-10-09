/**
 * Migration 0009 (L-147), run for real.
 *
 * A CV's file path was stored on import and never read. From L-147 it is
 * never written; this migration blanks the paths stored before, so the
 * privacy policy can stop listing them. Nothing else changes.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

const DIR = new URL('../../src-tauri/migrations/', import.meta.url);
const MIGRATION = '0009_cv_file_path_cleared.sql';

function sqlOf(file: string): string {
  return readFileSync(new URL(file, DIR), 'utf8');
}

const BEFORE = readdirSync(DIR)
  .filter((file) => file.endsWith('.sql') && file < MIGRATION)
  .sort();

function existingDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of BEFORE) db.exec(sqlOf(file));
  db.exec(`
    INSERT INTO cvs (id, name, file_path, extracted_text, created_at, json_resume, original_text)
      VALUES ('cv-1', 'CV.pdf', 'C:\\Users\\steve\\Documents\\CV.pdf', 'Steve Brady.', '2026-08-01T09:00:00.000Z', NULL, NULL),
             ('cv-2', 'Pasted', NULL, 'Pasted text.', '2026-08-02T09:00:00.000Z', NULL, 'Original.');
    INSERT INTO jobs (id, source, title, company, description, created_at)
      VALUES ('job-1', 'manual', 'Analyst', 'Barclays', 'SQL.', '2026-09-01T09:00:00.000Z');
  `);
  return db;
}

describe('0009: stored CV file paths are cleared (L-147)', () => {
  it('there are earlier migrations to build on, ending with 0008', () => {
    expect(BEFORE.at(-1)).toBe('0008_cv_original_text.sql');
  });

  it('happy: a stored path becomes null; everything else in the row is kept', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect(db.prepare(`SELECT * FROM cvs ORDER BY id`).all()).toEqual([
      {
        id: 'cv-1',
        name: 'CV.pdf',
        file_path: null,
        extracted_text: 'Steve Brady.',
        created_at: '2026-08-01T09:00:00.000Z',
        json_resume: null,
        original_text: null,
      },
      {
        id: 'cv-2',
        name: 'Pasted',
        file_path: null,
        extracted_text: 'Pasted text.',
        created_at: '2026-08-02T09:00:00.000Z',
        json_resume: null,
        original_text: 'Original.',
      },
    ]);
  });

  it('boundary: running it twice changes nothing more', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    const once = db.prepare(`SELECT * FROM cvs ORDER BY id`).all();
    db.exec(sqlOf(MIGRATION));
    expect(db.prepare(`SELECT * FROM cvs ORDER BY id`).all()).toEqual(once);
  });

  it('negative: no other table is touched, and the column itself stays', () => {
    const db = existingDatabase();
    const jobsBefore = db.prepare(`SELECT * FROM jobs`).all();
    const schemaBefore = db.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all();
    db.exec(sqlOf(MIGRATION));
    expect(db.prepare(`SELECT * FROM jobs`).all()).toEqual(jobsBefore);
    expect(db.prepare(`SELECT name, sql FROM sqlite_master ORDER BY name`).all()).toEqual(
      schemaBefore,
    );
  });
});
