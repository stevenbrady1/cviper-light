/**
 * The connection the database layer talks to (L-243).
 *
 * The same shape as `@tauri-apps/plugin-sql`'s `Database` — `load`, then
 * `execute` and `select` — so nothing above `client.ts` changed, and every
 * database test fakes it the way it used to fake the plugin.
 *
 * What changed is where the SQL runs, and who opens the file. Rust opens the
 * database at startup and runs its migrations (after the safety copy — see
 * `lib.rs`), so the page holds no `sql:` permission at all and no longer ships
 * the plugin's JavaScript. Queries go to the app's own Rust commands,
 * `db_execute` and `db_select`, which run a statement ONLY if it is on the
 * approved list compiled into the binary (`src-tauri/src/approved_sql.rs`,
 * written from `approved.ts`). A script that got into the page could not run
 * `ATTACH DATABASE` — or anything else the app was not built with.
 *
 * `load` therefore opens nothing. It hands back the connection, and refuses
 * any database but the app's own, so a caller cannot believe it reached one.
 */
import { invoke } from '@tauri-apps/api/core';

import { DB_URL } from './constants';

export interface QueryResult {
  readonly rowsAffected: number;
  readonly lastInsertId?: number;
}

export interface SqlConnection {
  execute(query: string, values?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, values?: unknown[]): Promise<T>;
}

function load(url: string): Promise<SqlConnection> {
  // Only the app's own database: Rust opened DB_URL at startup and runs
  // statements against it and nothing else.
  if (url !== DB_URL) {
    return Promise.reject(new Error(`Only ${DB_URL} can be opened, not ${url}.`));
  }

  return Promise.resolve({
    async execute(query, values = []) {
      const [rowsAffected, lastInsertId] = await invoke<[number, number]>('db_execute', {
        sql: query,
        values,
      });
      return { rowsAffected, lastInsertId };
    },
    async select<T>(query: string, values: unknown[] = []) {
      return invoke<T>('db_select', { sql: query, values });
    },
  });
}

export default { load };
