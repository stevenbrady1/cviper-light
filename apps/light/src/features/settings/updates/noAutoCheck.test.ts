/**
 * The promise: this app makes no network request the user did not ask for.
 *
 * ============================================================================
 * WHY A SOURCE SCAN AND NOT ONLY A BEHAVIOURAL TEST
 * ============================================================================
 * `launch.test.tsx` mounts the whole app with a fake port and asserts `check`
 * was never called. That is the better test of the two, and it is not enough on
 * its own: it can only see the port it was given. A future `useEffect` that
 * imported `@tauri-apps/plugin-updater` directly — the obvious way somebody
 * would add "check quietly on startup" — would sail straight past it, because
 * the fake would never hear about it.
 *
 * So this file asserts the STRUCTURAL property instead: exactly one module in
 * the app imports the updater plugin, and it is the port. Break that and the
 * behavioural test's guarantee becomes local rather than global.
 *
 * Both halves of the anti-inert rule apply. The scanner must find the one real
 * import (a broken walker would otherwise pass silently), and it must be shown
 * catching a synthetic violation.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** `src/` — this file lives in `src/features/settings/updates/`. */
const SRC = fileURLToPath(new URL('../../../', import.meta.url));

/** The one module allowed to reach the plugin. */
const THE_PORT = 'features/settings/updates/port.ts';

const UPDATER_PLUGIN = '@tauri-apps/plugin-updater';

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found.sort();
}

/** Does this source import the updater plugin, statically or dynamically? */
export function importsUpdaterPlugin(source: string): boolean {
  return new RegExp(
    `from\\s+['"]${UPDATER_PLUGIN}['"]|import\\(\\s*['"]${UPDATER_PLUGIN}['"]`,
  ).test(source);
}

const FILES = sourceFiles(SRC);

const IMPORTERS = FILES.filter((file) => importsUpdaterPlugin(readFileSync(file, 'utf8'))).map(
  (file) => relative(SRC, file).replaceAll('\\', '/'),
);

describe('the updater plugin has exactly one import site', () => {
  it('finds the app source files', () => {
    // Anti-inert: a walker that returned nothing would make the assertion
    // below vacuously true for ever.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((file) => file.endsWith('App.tsx'))).toBe(true);
  });

  it('is imported by the port and by nothing else', () => {
    expect(IMPORTERS).toEqual([THE_PORT]);
  });

  it('the scanner catches an import it should not find', () => {
    // The other half of the anti-inert rule: proof the matcher can fail.
    expect(importsUpdaterPlugin(`import { check } from '${UPDATER_PLUGIN}';`)).toBe(true);
    expect(importsUpdaterPlugin(`const m = await import("${UPDATER_PLUGIN}");`)).toBe(true);
  });

  it('negative: the scanner does not fire on an unrelated plugin', () => {
    // A matcher that flagged every Tauri plugin would be deleted the first time
    // somebody added one, and the guard would go with it.
    expect(importsUpdaterPlugin(`import { openUrl } from '@tauri-apps/plugin-opener';`)).toBe(
      false,
    );
  });

  it('boundary: an empty file imports nothing', () => {
    expect(importsUpdaterPlugin('')).toBe(false);
  });
});
