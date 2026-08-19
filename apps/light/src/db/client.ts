/**
 * The single connection to the local SQLite database, and the single queue
 * every database operation goes through.
 *
 * ============================================================================
 * WHY EVERY OPERATION IS SERIALISED
 * ============================================================================
 * `tauri-plugin-sql` connects with `sqlx::Pool::connect(...)`, which uses
 * sqlx's default pool: up to TEN connections, created on demand. Each
 * `db.execute()` / `db.select()` acquires a connection independently, so a
 * multi-statement transaction issued as separate calls —
 *
 *     BEGIN; INSERT ...; INSERT ...; COMMIT;
 *
 * — is only atomic if all four land on the SAME pooled connection. That holds
 * exactly when nothing else touches the pool in between: with one idle
 * connection and strictly sequential access, the pool hands the same one back
 * every time and never opens a second. A concurrent read from a React component
 * during an import would force a second connection, and the transaction would
 * be split across two of them.
 *
 * `withDb()` is what makes that condition true. It is not an optimisation and
 * it is not defensive style — `backup.ts` depends on it for atomicity. Anything
 * that reaches the database goes through it.
 *
 * If this ever proves insufficient, the fix is a Rust-side command that takes a
 * real `sqlx::Transaction`, not a retry loop here.
 * ============================================================================
 */
import Database from '@tauri-apps/plugin-sql';

import { err, ok, type Result } from '@cviper/core-types';

import { DB_URL } from './constants';
import { dbError, describeUnknown, fromThrown, type DbError } from './errors';

/**
 * The in-flight or settled connection attempt. `null` means "not connected and
 * not connecting" — including after a failure, so a user who frees the disk or
 * closes the other copy of the app can simply try again.
 */
let connecting: Promise<Database> | null = null;

/** The tail of the operation queue. See the note at the top of the file. */
let queue: Promise<unknown> = Promise.resolve();

async function connect(): Promise<Database> {
  const db = await Database.load(DB_URL);

  // Foreign key enforcement is per-CONNECTION in SQLite and is not stored in
  // the database file, which is why it is not in `0001_init.sql`.
  //
  // The real guarantee comes from sqlx-sqlite, which puts
  // `PRAGMA foreign_keys = ON` in the default pragma set it sends on every
  // connection it opens. This statement covers the one connection we are
  // holding, and — more importantly — states the requirement in our own code
  // instead of leaving it inherited from a dependency's defaults, where a
  // version bump could remove it without anything here noticing.
  await db.execute('PRAGMA foreign_keys = ON;');

  return db;
}

/**
 * The connected database, opened on first use.
 *
 * Prefer `withDb()`. Reach for `getDb()` only when you need the handle itself
 * and have already taken responsibility for ordering.
 */
export async function getDb(): Promise<Result<Database, DbError>> {
  if (connecting === null) {
    const attempt = connect();
    connecting = attempt;
    // Do not cache a failure. Guarded against clobbering a newer attempt that
    // may already have replaced this one.
    attempt.catch(() => {
      if (connecting === attempt) connecting = null;
    });
  }

  try {
    return ok(await connecting);
  } catch (cause) {
    return err(
      dbError(
        'CONNECTION_FAILED',
        `CViper could not open its local database: ${describeUnknown(cause)}`,
      ),
    );
  }
}

/**
 * Run one database operation, serialised against every other one.
 *
 * Nothing thrown inside `run` escapes: a rejection becomes a `DbError`,
 * classified as `CONSTRAINT_VIOLATION` when the database says a constraint
 * failed and `QUERY_FAILED` otherwise, carrying the original message either
 * way.
 */
export function withDb<T>(
  run: (db: Database) => Promise<T>,
  table: string | null = null,
): Promise<Result<T, DbError>> {
  const next = queue.then(async (): Promise<Result<T, DbError>> => {
    const db = await getDb();
    if (!db.ok) return db;

    try {
      return ok(await run(db.value));
    } catch (cause) {
      return err(fromThrown(cause, table));
    }
  });

  // The queue must never carry a rejection forward: one poisoned link would
  // fail every operation queued after it, forever.
  queue = next.then(
    () => undefined,
    () => undefined,
  );

  return next;
}
