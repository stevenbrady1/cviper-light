/**
 * The error channel for the data-access layer.
 *
 * Mirrors the shape of `BackupError` in `@cviper/core-types`: a stable code the
 * caller can branch on, a message legible enough to put in front of a user
 * without further translation, and where the problem was.
 *
 * NOTHING IN `src/db` THROWS ACROSS A BOUNDARY. Every exported function returns
 * `Result<T, DbError>`, so a caller that forgets the failure path is a compile
 * error rather than an unhandled rejection in front of the user.
 */

export type DbErrorCode =
  /** The database could not be opened, or the migration failed. */
  | 'CONNECTION_FAILED'
  /** The statement ran and the database refused it, or the driver failed. */
  | 'QUERY_FAILED'
  /** A UNIQUE, FOREIGN KEY, CHECK or NOT NULL constraint rejected the write. */
  | 'CONSTRAINT_VIOLATION'
  /** A row came back from SQLite in a shape the data model does not allow. */
  | 'MALFORMED_ROW'
  /** A value could not be turned into something SQLite can store. */
  | 'SERIALISE_FAILED';

export interface DbError {
  readonly code: DbErrorCode;
  /** Legible enough to show a user without further translation. */
  readonly message: string;
  /** Which table the problem was in, or `null` if it was not table-specific. */
  readonly table: string | null;
}

export function dbError(code: DbErrorCode, message: string, table: string | null = null): DbError {
  return { code, message, table };
}

/**
 * SQLite constraint failures, as SQLite words them.
 *
 * The tauri-plugin-sql error arrives on the JavaScript side as a string, so
 * this is a MATCH ON MESSAGE TEXT and is exactly as fragile as that sounds. It
 * is used only to CLASSIFY, never to decide what information survives: the
 * original message is carried through verbatim either way, so the worst a miss
 * can do is report `QUERY_FAILED` where `CONSTRAINT_VIOLATION` would have been
 * more specific. It can never swallow the reason.
 */
const CONSTRAINT_FAILURE = /\bconstraint failed\b/i;

/** The text of an unknown thrown value, without assuming it is an `Error`. */
export function describeUnknown(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

/** Turn something thrown by the SQL plugin into a `DbError`. */
export function fromThrown(cause: unknown, table: string | null = null): DbError {
  const message = describeUnknown(cause);
  return dbError(
    CONSTRAINT_FAILURE.test(message) ? 'CONSTRAINT_VIOLATION' : 'QUERY_FAILED',
    message,
    table,
  );
}
