/**
 * L-243 — the SQL the app may run is one list, kept in two places, and they
 * agree.
 *
 * TypeScript registers every statement with `approved()`. Rust runs a
 * statement only if its exact text is in `src-tauri/src/approved_sql.rs`. This
 * renders the first into the second and compares them with the committed
 * file: a statement added on one side and not the other fails here, not for a
 * user. `pnpm approved-sql` rewrites the file (it runs this test with `-u`).
 *
 * It also holds the line the whole change exists for: the page keeps NO
 * `sql:` permission at all. `sql:default` grants `allow-select`, and the
 * plugin's select runs whatever it is given — ATTACH DATABASE included; and
 * since part 2, Rust opens the database, so not even `allow-load` is left.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allApprovedSql } from '../db/approvedAll';
import { renderApprovedSqlRust } from '../db/approvedSqlRust';

import { REPO_ROOT } from './repo-scan';

const CAPABILITIES = join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'capabilities');

describe('the approved SQL list (L-243)', () => {
  it('src-tauri/src/approved_sql.rs is exactly what the approved() calls render', async () => {
    const statements = await allApprovedSql();
    expect(statements.length).toBeGreaterThan(30);
    await expect(renderApprovedSqlRust(statements)).toMatchFileSnapshot(
      join(REPO_ROOT, 'apps', 'light', 'src-tauri', 'src', 'approved_sql.rs'),
    );
  });

  it('nothing on it can attach a file or change how the database is opened', async () => {
    const dangerous = (await allApprovedSql()).filter((sql) =>
      /\b(ATTACH|DETACH|load_extension|PRAGMA\s+(?!foreign_keys = ON;$))/iu.test(sql),
    );
    expect(dangerous).toEqual([]);
  });

  it('the page holds no plugin permission that runs SQL', () => {
    const granted = ['default.json', 'desktop.json'].flatMap((file) => {
      const capability = JSON.parse(readFileSync(join(CAPABILITIES, file), 'utf8')) as {
        permissions: (string | { identifier: string })[];
      };
      return capability.permissions.map((entry) =>
        typeof entry === 'string' ? entry : entry.identifier,
      );
    });
    // None at all since part 2 (L-243): Rust opens the database itself.
    const sql = granted.filter((permission) => permission.startsWith('sql:'));
    expect(sql).toEqual([]);
  });
});

describe('renderApprovedSqlRust', () => {
  it('sorts, and keeps each statement byte for byte in a raw string', () => {
    const text = renderApprovedSqlRust(["SELECT b FROM t WHERE x = 'q'", 'COMMIT;']);
    expect(text).toContain('    r##"COMMIT;"##,\n    r##"SELECT b FROM t WHERE x = \'q\'"##,');
  });

  it('negative: refuses an empty statement and one that would break the raw string', () => {
    expect(() => renderApprovedSqlRust(['  '])).toThrow(/empty/);
    expect(() => renderApprovedSqlRust(['SELECT "##'])).toThrow(/raw string/);
  });
});
