/**
 * SQL text, built from the column lists in `rows.ts`.
 *
 * Every statement here is DERIVED from `TABLE_COLUMNS` rather than typed out.
 * A hand-written `INSERT` and a hand-written parameter array are two lists that
 * have to be kept in the same order by hand, and the failure is quiet: the
 * values simply land in the wrong columns. Deriving both from one list removes
 * the class.
 *
 * Placeholders are `$1, $2, ...` — the form tauri-plugin-sql passes through to
 * sqlx for SQLite and Postgres (MySQL would need `?`). No value is ever
 * interpolated into a statement.
 */
import { TABLE_COLUMNS, type TableName } from './rows';

/** `SELECT <every column, named> FROM <table>` — never `SELECT *`. */
export function selectFrom(table: TableName): string {
  return `SELECT ${TABLE_COLUMNS[table].join(', ')} FROM ${table}`;
}

/**
 * Insert, or update the row that already has this id.
 *
 * `ON CONFLICT (id)` targets the primary key only. A conflict on the partial
 * unique index `(source, external_id)` is NOT absorbed here and surfaces as a
 * `CONSTRAINT_VIOLATION` — which is the point: the same advert arriving twice
 * under two different ids is a duplicate to be reported, not silently merged
 * into whichever row happened to be written last.
 *
 * `id` is excluded from the SET list. It is the conflict target, so assigning
 * it to itself is noise at best.
 */
export function upsertInto(table: TableName): string {
  const columns = TABLE_COLUMNS[table];
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const updates = columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');

  return (
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ` +
    `ON CONFLICT (id) DO UPDATE SET ${updates}`
  );
}

export function deleteFrom(table: TableName): string {
  return `DELETE FROM ${table} WHERE id = $1`;
}
