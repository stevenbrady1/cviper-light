/**
 * Migration 0008 (L-218), run for real.
 *
 * Applies the actual `.sql` files, in order, to an in-memory SQLite
 * (`node:sqlite`) over a database shaped like a 0.7.0 user's (0001-0007) with
 * a CV in it, then 0008. It adds one nullable column to `cvs` and changes
 * nothing else: an existing CV reads exactly as before, as "never corrected".
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { CV_COLUMNS } from './rows';

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
  '0007_job_workflow.sql',
];
const MIGRATION = '0008_cv_original_text.sql';

function existingDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of BEFORE) db.exec(sqlOf(file));
  db.exec(`
    INSERT INTO cvs (id, name, file_path, extracted_text, created_at, json_resume)
      VALUES ('cv-1', 'CV.docx', NULL, 'Steve Brady. Credit risk.', '2026-08-01T09:00:00.000Z', NULL);
  `);
  return db;
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  );
}

function schemaWithout(db: DatabaseSync, table: string): unknown[] {
  return db.prepare(`SELECT name, sql FROM sqlite_master WHERE name != ? ORDER BY name`).all(table);
}

describe('0008: cvs.original_text (L-218)', () => {
  it('adds one nullable column, last, and an existing CV reads as never corrected', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));

    expect(columnsOf(db, 'cvs')).toEqual([
      'id',
      'name',
      'file_path',
      'extracted_text',
      'created_at',
      'json_resume',
      'original_text',
    ]);
    expect(db.prepare(`SELECT * FROM cvs WHERE id = 'cv-1'`).get()).toEqual({
      id: 'cv-1',
      name: 'CV.docx',
      file_path: null,
      extracted_text: 'Steve Brady. Credit risk.',
      created_at: '2026-08-01T09:00:00.000Z',
      json_resume: null,
      original_text: null,
    });
  });

  it('changes no other table or index', () => {
    const before = schemaWithout(existingDatabase(), 'cvs');
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect(schemaWithout(db, 'cvs')).toEqual(before);
  });

  it('the app’s column list is exactly the migrated table, in order', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    expect([...CV_COLUMNS]).toEqual(columnsOf(db, 'cvs'));
  });

  it('a correction and its original round-trip, including an empty original', () => {
    const db = existingDatabase();
    db.exec(sqlOf(MIGRATION));
    db.prepare(`UPDATE cvs SET extracted_text = ?, original_text = ? WHERE id = 'cv-1'`).run(
      'Fixed.',
      '',
    );
    expect(db.prepare(`SELECT extracted_text, original_text FROM cvs`).get()).toEqual({
      extracted_text: 'Fixed.',
      original_text: '',
    });
  });
});
