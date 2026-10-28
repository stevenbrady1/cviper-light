/**
 * The connection the database layer talks to (L-243).
 *
 * The same shape as `@tauri-apps/plugin-sql`'s `Database` — `load`, then
 * `execute` and `select` — so nothing above `client.ts` changed, and every
 * database test fakes it the way it used to fake the plugin.
 *
 * What changed is where the SQL runs. `load` still asks the plugin to open the
 * file and apply its migrations; that is the one plugin permission the page
 * keeps (`sql:allow-load`). Queries go to the app's own Rust commands,
 * `db_execute` and `db_select`, which run a statement ONLY if it is on the
 * approved list compiled into the binary (`src-tauri/src/approved_sql.rs`,
 * written from `approved.ts`). The plugin's own `execute` and `select` are no
 * longer reachable from the page, so a script that got into it could not run
 * `ATTACH DATABASE` — or anything else the app was not built with.
 */
import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

import { DB_URL } from './constants';

export interface QueryResult {
  readonly rowsAffected: number;
  readonly lastInsertId?: number;
}

export interface SqlConnection {
  execute(query: string, values?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, values?: unknown[]): Promise<T>;
}

async function load(url: string): Promise<SqlConnection> {
  // Only the app's own database: Rust runs statements against DB_URL and
  // nothing else, so opening any other file would be a connection that can
  // never be used.
  if (url !== DB_URL) throw new Error(`Only ${DB_URL} can be opened, not ${url}.`);
  await Database.load(url);

  return {
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
  };
}

export default { load };
