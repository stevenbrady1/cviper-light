/**
 * The keep-these-ids delete, run on a REAL SQLite (L-243).
 *
 * `replaceInterviewSubstages` deletes every sub-stage not in the saved list.
 * It used to build `NOT IN ($1, $2, ...)` with one placeholder per id, so its
 * text changed with the count — and a statement whose text changes cannot be
 * on the approved list Rust checks. It now binds the ids as one JSON array and
 * reads them with `json_each`. This proves the two shapes delete the same rows,
 * on `node:sqlite`, which is the same SQLite engine family the app ships.
 */
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { KEEP_ONLY } from './interviewSubstages';

function seeded(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE interview_substages (id TEXT PRIMARY KEY, label TEXT, position INTEGER)');
  for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) {
    db.prepare('INSERT INTO interview_substages VALUES (?, ?, ?)').run(id, id, index);
  }
  return db;
}

function remaining(db: DatabaseSync): string[] {
  return db
    .prepare('SELECT id FROM interview_substages ORDER BY id')
    .all()
    .map((row) => String(row.id));
}

/** The statement uses `$1`; node:sqlite names that parameter `$1` too. */
function keepOnly(db: DatabaseSync, ids: readonly string[]): void {
  db.prepare(KEEP_ONLY).run({ $1: JSON.stringify(ids) } as never);
}

describe('KEEP_ONLY on a real SQLite (L-243)', () => {
  it('keeps exactly the listed ids and deletes the rest', () => {
    const db = seeded();
    keepOnly(db, ['b', 'd']);
    expect(remaining(db)).toEqual(['b', 'd']);
  });

  it('boundary: one id', () => {
    const db = seeded();
    keepOnly(db, ['c']);
    expect(remaining(db)).toEqual(['c']);
  });

  it('negative: an id that is not there deletes everything else and adds nothing', () => {
    const db = seeded();
    keepOnly(db, ['zz']);
    expect(remaining(db)).toEqual([]);
  });

  it('negative: an id holding SQL or quotes is data, never code', () => {
    const db = seeded();
    keepOnly(db, ["a'); DROP TABLE interview_substages; --", 'a']);
    expect(remaining(db)).toEqual(['a']);
  });
});
