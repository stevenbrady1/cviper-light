/**
 * The Windows uninstaller removes every key the app can save — and only
 * those, and only when asked to (0.10.1).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * API keys live in Windows Credential Manager, not in the app's folders. The
 * NSIS uninstaller's "Delete the application data" box removed the folders and
 * left every key behind, so somebody who uninstalled to "remove everything"
 * still had their keys on the machine (owner report on 0.10.0).
 *
 * `src-tauri/windows/hooks.nsh` now deletes them, by exact target name, with
 * `CredDeleteW`. The names are a copy of what Rust writes — `keyring`'s Windows
 * store files each one as `<account>.<service>`, a GENERIC credential — so this
 * guard reads the accounts out of `secrets.rs` and fails if the hook misses
 * one. A new provider key cannot be forgotten.
 *
 * It also holds the two promises that make the hook safe:
 *   * only CViper Light's own names — every target ends `.cviper-light`, and
 *     there is no wildcard, no enumeration and no `cmdkey`;
 *   * only when the box is ticked and the uninstall is not an update — the
 *     updater runs the uninstaller with `/UPDATE`, and an update must never
 *     cost anybody their keys.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const SECRETS_RS = read('../../src-tauri/src/secrets.rs');
const TAURI_CONF = JSON.parse(read('../../src-tauri/tauri.conf.json')) as {
  bundle?: { windows?: { nsis?: { installerHooks?: string } } };
};
const HOOK_PATH = TAURI_CONF.bundle?.windows?.nsis?.installerHooks ?? '';

/** NSIS comments run from `;` or `#` to the end of the line. */
function withoutComments(nsis: string): string {
  return nsis
    .split('\n')
    .map((line) => line.replace(/\s[;#].*$|^\s*[;#].*$/, ''))
    .join('\n');
}

const HOOK = HOOK_PATH === '' ? '' : withoutComments(read(`../../src-tauri/${HOOK_PATH}`));

const SERVICE = /const SERVICE: &str = "([^"]+)";/.exec(SECRETS_RS)?.[1] ?? '';
const ACCOUNTS = [...SECRETS_RS.matchAll(/SecretKey::\w+\s*=>\s*"([a-z_]+)"/g)].map(
  (match) => match[1] ?? '',
);

/** Every `CredDeleteW(w "<target>", i 1, …)` in the hook: the targets, in order. */
function deletedTargets(nsis: string): string[] {
  return [...nsis.matchAll(/advapi32::CredDeleteW\(\s*w\s+"([^"]+)"\s*,\s*i\s+1\s*,/g)].map(
    (match) => match[1] ?? '',
  );
}

describe('the uninstaller removes every key the app can save', () => {
  it('reads the real secret list (anti-inert)', () => {
    expect(SERVICE).toBe('cviper-light');
    expect(ACCOUNTS.length).toBeGreaterThanOrEqual(10);
  });

  it('the NSIS bundle is pointed at the hook file', () => {
    expect(HOOK_PATH).toMatch(/\.nsh$/);
    expect(HOOK).toContain('!macro NSIS_HOOK_POSTUNINSTALL');
  });

  it('deletes every account Rust can write, as the Windows store names it', () => {
    const deleted = new Set(deletedTargets(HOOK));
    const missing = ACCOUNTS.map((account) => `${account}.${SERVICE}`).filter(
      (target) => !deleted.has(target),
    );
    expect(missing).toEqual([]);
  });

  it('negative: touches nothing that is not CViper Light’s', () => {
    const targets = deletedTargets(HOOK);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.endsWith(`.${SERVICE}`), target).toBe(true);
      expect(target, target).not.toMatch(/[*?]/);
    }
    // Exact names only: no tool that enumerates or matches patterns.
    expect(HOOK).not.toMatch(/cmdkey|CredEnumerate|\*/i);
    // And no call that deletes anything other than a generic credential.
    const calls = HOOK.match(/CredDeleteW/g) ?? [];
    expect(calls.length).toBe(targets.length);
  });

  it('only when "delete app data" is ticked, and never during an update', () => {
    const macro = /!macro NSIS_HOOK_POSTUNINSTALL([\s\S]*?)!macroend/.exec(HOOK)?.[1] ?? '';
    const guarded =
      /\$\{If\}\s+\$DeleteAppDataCheckboxState\s*=\s*1\s*\n\s*\$\{AndIf\}\s+\$UpdateMode\s*<>\s*1([\s\S]*?)\$\{EndIf\}/.exec(
        macro,
      )?.[1] ?? '';
    expect(deletedTargets(guarded)).toEqual(deletedTargets(HOOK));
    // Nothing deletes outside that block.
    expect(macro.replace(guarded, '')).not.toContain('CredDeleteW');
  });

  describe('the guard can fail', () => {
    it('reports a target the hook forgot', () => {
      const short = HOOK.replace(/.*google_api_key\.cviper-light.*\n/, '');
      expect(deletedTargets(short)).not.toContain('google_api_key.cviper-light');
      expect(deletedTargets(short).length).toBe(deletedTargets(HOOK).length - 1);
    });

    it('ignores a target that only appears in a comment', () => {
      expect(
        deletedTargets(
          withoutComments(`; System::Call 'advapi32::CredDeleteW(w "x.cviper-light", i 1, i 0)'`),
        ),
      ).toEqual([]);
    });
  });
});
