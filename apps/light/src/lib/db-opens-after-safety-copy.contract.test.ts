/**
 * L-243, part 2 — Rust opens the database, and only AFTER the safety copy.
 *
 * The page used to open the database itself (`sql:allow-load`) on its first
 * query, which ran the migrations then. Now the plugin opens it at startup
 * from `plugins.sql.preload` in `tauri.conf.json`, so the page needs no `sql:`
 * permission at all.
 *
 * The trap: the plugin's preload runs the migrations inside the PLUGIN'S
 * setup, and plugins added with `Builder::plugin(...)` are set up before the
 * app's own `.setup()`. That is where the safety copy is made (L-227) — the
 * copy of the database taken before a migration changes it. Registered the
 * old way, an update would migrate first and copy second, and the copy would
 * already be the new schema. So the plugin is registered INSIDE `.setup()`,
 * after `make_safety_copy`, and this test holds that order in the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DB_URL } from '../db/constants';

import { REPO_ROOT, stripComments } from './repo-scan';

const TAURI = join(REPO_ROOT, 'apps', 'light', 'src-tauri');
const LIB_RS = stripComments(readFileSync(join(TAURI, 'src', 'lib.rs'), 'utf8'));

/** Where `make_safety_copy` and the SQL plugin's builder appear in `run()`. */
export function openingOrder(source: string): { copy: number; plugin: number[] } {
  const plugin = [...source.matchAll(/tauri_plugin_sql::Builder/gu)].map((match) => match.index);
  return { copy: source.indexOf('make_safety_copy('), plugin };
}

describe('the database opens in Rust, after the safety copy (L-243)', () => {
  it('the SQL plugin is registered once, after the safety copy is made', () => {
    const { copy, plugin } = openingOrder(LIB_RS);
    expect(copy, 'make_safety_copy( is no longer called in lib.rs').toBeGreaterThan(-1);
    expect(plugin).toHaveLength(1);
    expect(plugin[0]).toBeGreaterThan(copy);
  });

  it('tauri.conf.json preloads exactly the app’s own database', () => {
    const config = JSON.parse(readFileSync(join(TAURI, 'tauri.conf.json'), 'utf8')) as {
      plugins?: { sql?: { preload?: unknown } };
    };
    expect(config.plugins?.sql?.preload).toEqual([DB_URL]);
  });

  it('the page no longer ships the plugin’s JavaScript', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps', 'light', 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain('@tauri-apps/plugin-sql');
  });
});

describe('openingOrder', () => {
  it('negative: the plugin registered on the builder, before the copy', () => {
    const source =
      'tauri::Builder::default().plugin(tauri_plugin_sql::Builder::default().build())\n' +
      '.setup(|app| { make_safety_copy(&dir); Ok(()) })';
    const { copy, plugin } = openingOrder(source);
    expect((plugin[0] ?? Infinity) > copy).toBe(false);
  });

  it('boundary: registered inside setup, after the copy', () => {
    const source =
      '.setup(|app| { make_safety_copy(&dir);\n' +
      'app.handle().plugin(tauri_plugin_sql::Builder::default().build()); Ok(()) })';
    const { copy, plugin } = openingOrder(source);
    expect(plugin).toHaveLength(1);
    expect((plugin[0] ?? -1) > copy).toBe(true);
  });
});
