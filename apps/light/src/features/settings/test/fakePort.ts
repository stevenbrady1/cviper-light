import { err, ok } from '@cviper/core-types';

import { type DbError, type DbSnapshot } from '../../../db';
import { type BackupPort } from '../backup';

/**
 * An in-memory `BackupPort`.
 *
 * It is a REAL round trip: `write` stores the snapshot and `read` gives it
 * back, so an export-then-import test through the UI proves the data survived
 * rather than proving two mocks were called. The atomicity and the write order
 * belong to `db/backup.ts` and are tested there against SQLite's own rules.
 */

export interface FakeBackupPort extends BackupPort {
  /** What is currently "in the database". */
  readonly snapshot: () => DbSnapshot;
  /** Make the next `read` or `write` fail. */
  readonly failNext: (method: 'read' | 'write') => void;
  readonly calls: Record<'read' | 'write', number>;
}

const EMPTY: DbSnapshot = { jobs: [], applications: [], cvs: [], analyses: [] };

const FAILURE: DbError = {
  code: 'QUERY_FAILED',
  message: 'The database is locked by another copy of CViper.',
  table: null,
};

export function createFakeBackupPort(initial: DbSnapshot = EMPTY): FakeBackupPort {
  let stored: DbSnapshot = {
    jobs: [...initial.jobs],
    applications: [...initial.applications],
    cvs: [...initial.cvs],
    analyses: [...initial.analyses],
  };
  const failing = new Set<'read' | 'write'>();
  const calls = { read: 0, write: 0 };

  function refuses(method: 'read' | 'write'): boolean {
    if (!failing.has(method)) return false;
    failing.delete(method);
    return true;
  }

  return {
    calls,
    snapshot: () => stored,
    failNext: (method) => failing.add(method),

    async read() {
      calls.read += 1;
      return refuses('read') ? err(FAILURE) : ok(stored);
    },

    async write(snapshot) {
      calls.write += 1;
      if (refuses('write')) return err(FAILURE);
      // MERGES, exactly as `writeAll` does: same id updates, new id inserts,
      // nothing is ever deleted. A fake that replaced would let a test pass
      // while the real thing did something else entirely.
      stored = {
        jobs: mergeById(stored.jobs, snapshot.jobs),
        applications: mergeById(stored.applications, snapshot.applications),
        cvs: mergeById(stored.cvs, snapshot.cvs),
        analyses: mergeById(stored.analyses, snapshot.analyses),
      };
      return ok(undefined);
    },
  };
}

function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const merged = new Map(existing.map((row) => [row.id, row]));
  for (const row of incoming) merged.set(row.id, row);
  return [...merged.values()];
}
