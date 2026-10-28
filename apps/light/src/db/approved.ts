/**
 * The approved SQL statements (L-243): the only SQL the app can run.
 *
 * ============================================================================
 * WHY THE PAGE NO LONGER SENDS ITS OWN SQL
 * ============================================================================
 * Until L-243 the web page held `sql:default` and `sql:allow-execute`, so it
 * could run ANY statement against the database. One of those is
 * `ATTACH DATABASE '<path>' AS x`, which creates a file anywhere the user can
 * write — the Startup folder, for instance — and, with a table written into
 * it, puts content there. If script ever got into the page, that is code
 * execution on Windows. `sql:allow-select` alone would not have closed it:
 * the plugin's `select` runs whatever it is given (`fetch_all`), ATTACH
 * included. The real defence was that script injection is hard; this is the
 * second layer.
 *
 * Now every statement is registered here, by the module that sends it, with
 * `approved()`. `pnpm approved-sql` writes the same list into
 * `src-tauri/src/approved_sql.rs`, and Rust's `db_execute` and
 * `db_select` refuse anything that is not on it, byte for byte. The page lost
 * the plugin's `select` and `execute` permissions; it can only ask Rust to run
 * a statement the app was built with.
 *
 * Two checks keep the halves together:
 *   * `client.ts` refuses an unapproved statement on the TypeScript side too,
 *     so every database test that reaches a new statement fails until it is
 *     registered — not a user, at runtime, in Rust.
 *   * `approved-sql.contract.test.ts` fails when the Rust file is not exactly
 *     what this list renders.
 *
 * A statement is approved by its EXACT text. No value is ever interpolated
 * into one: values travel separately as `$1, $2, ...` parameters.
 */

const APPROVED = new Set<string>();

/** Register a statement as one the app may run, and return it unchanged. */
export function approved(sql: string): string {
  APPROVED.add(sql);
  return sql;
}

export function isApproved(sql: string): boolean {
  return APPROVED.has(sql);
}

/**
 * Every statement registered so far, sorted so the generated Rust file is
 * stable. Complete only once every module that sends SQL has been imported —
 * see `allApprovedSql()` in `approvedAll.ts`.
 */
export function registeredSql(): string[] {
  return [...APPROVED].sort();
}

/** Statements the connection itself sends, outside any one table's module. */
export const FOREIGN_KEYS_ON = approved('PRAGMA foreign_keys = ON;');
export const BEGIN = approved('BEGIN IMMEDIATE;');
export const COMMIT = approved('COMMIT;');
export const ROLLBACK = approved('ROLLBACK;');
