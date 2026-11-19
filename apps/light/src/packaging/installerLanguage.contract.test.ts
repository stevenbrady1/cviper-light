/**
 * The Windows installer's English messages are Tauri's own, with one line
 * reworded (L-426): the "still open" question says what OK does.
 *
 * Tauri's stock `appRunningOkKill` reads "CViper Light is running! Click OK to
 * kill it", and OK force-closes the app through Windows' Restart Manager. The
 * only supported way to change it is `bundle.windows.nsis.customLanguageFiles`,
 * and a custom file REPLACES Tauri's English file — it is not merged. So
 * `src-tauri/windows/English.nsh` is a full copy of the stock file from the
 * locked tauri-cli, with that one line changed. A string the copy dropped
 * would make makensis fail, or a dialog show an empty message.
 *
 * `{{product_name}}` stays a literal token: the bundler copies the file as is
 * (it only prepends a UTF-8 BOM — so the source must not have one), and
 * `CheckIfAppIsRunning` in the bundler's utils.nsh swaps the token for the
 * product name at run time (`nsis_tauri_utils::StrReplace "$(appRunningOkKill)"
 * "{{product_name}}" ...`).
 *
 * When @tauri-apps/cli is upgraded, this fails until somebody re-fetches the
 * stock English.nsh at the new tag, updates STOCK_ENGLISH and the copy, and
 * moves STOCK_FROM_CLI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_TAURI = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NSIS = (
  JSON.parse(readFileSync(`${SRC_TAURI}tauri.conf.json`, 'utf8')) as {
    bundle?: { windows?: { nsis?: { customLanguageFiles?: Record<string, string> } } };
  }
).bundle?.windows?.nsis;

const ENGLISH_PATH = NSIS?.customLanguageFiles?.English ?? '';

const LOCK = readFileSync(`${REPO_ROOT}pnpm-lock.yaml`, 'utf8');
const LOCKED_CLI = /'@tauri-apps\/cli@(\d+\.\d+\.\d+)':/.exec(LOCK)?.[1] ?? '';

/** The tauri-cli tag STOCK_ENGLISH was copied from. */
const STOCK_FROM_CLI = '2.12.4';

/**
 * crates/tauri-bundler/src/bundle/windows/nsis/languages/English.nsh at tag
 * tauri-cli-v2.12.4, line for line (LF endings, final newline, no BOM).
 */
const STOCK_ENGLISH = [
  'LangString addOrReinstall ${LANG_ENGLISH} "Add/Reinstall components"',
  'LangString alreadyInstalled ${LANG_ENGLISH} "Already Installed"',
  'LangString alreadyInstalledLong ${LANG_ENGLISH} "${PRODUCTNAME} ${VERSION} is already installed. Select the operation you want to perform and click Next to continue."',
  'LangString appRunning ${LANG_ENGLISH} "{{product_name}} is running! Please close it first then try again."',
  'LangString appRunningOkKill ${LANG_ENGLISH} "{{product_name}} is running!$\\nClick OK to kill it"',
  'LangString chooseMaintenanceOption ${LANG_ENGLISH} "Choose the maintenance option to perform."',
  'LangString chooseHowToInstall ${LANG_ENGLISH} "Choose how you want to install ${PRODUCTNAME}."',
  'LangString createDesktop ${LANG_ENGLISH} "Create desktop shortcut"',
  'LangString dontUninstall ${LANG_ENGLISH} "Do not uninstall"',
  'LangString dontUninstallDowngrade ${LANG_ENGLISH} "Do not uninstall (Downgrading without uninstall is disabled for this installer)"',
  'LangString failedToKillApp ${LANG_ENGLISH} "Failed to kill {{product_name}}. Please close it first then try again"',
  'LangString installingWebview2 ${LANG_ENGLISH} "Installing WebView2..."',
  'LangString newerVersionInstalled ${LANG_ENGLISH} "A newer version of ${PRODUCTNAME} is already installed! It is not recommended that you install an older version. If you really want to install this older version, it\'s better to uninstall the current version first. Select the operation you want to perform and click Next to continue."',
  'LangString older ${LANG_ENGLISH} "older"',
  'LangString olderOrUnknownVersionInstalled ${LANG_ENGLISH} "An $R4 version of ${PRODUCTNAME} is installed on your system. It\'s recommended that you uninstall the current version before installing. Select the operation you want to perform and click Next to continue."',
  'LangString silentDowngrades ${LANG_ENGLISH} "Downgrades are disabled for this installer, can\'t proceed with the silent installer, please use the graphical interface installer instead.$\\n"',
  'LangString unableToUninstall ${LANG_ENGLISH} "Unable to uninstall!"',
  'LangString uninstallApp ${LANG_ENGLISH} "Uninstall ${PRODUCTNAME}"',
  'LangString uninstallBeforeInstalling ${LANG_ENGLISH} "Uninstall before installing"',
  'LangString unknown ${LANG_ENGLISH} "unknown"',
  'LangString webview2AbortError ${LANG_ENGLISH} "Failed to install WebView2! The app can\'t run without it. Try restarting the installer."',
  'LangString webview2DownloadError ${LANG_ENGLISH} "Error: Downloading WebView2 Failed - $0"',
  'LangString webview2DownloadSuccess ${LANG_ENGLISH} "WebView2 bootstrapper downloaded successfully"',
  'LangString webview2Downloading ${LANG_ENGLISH} "Downloading WebView2 bootstrapper..."',
  'LangString webview2InstallError ${LANG_ENGLISH} "Error: Installing WebView2 failed with exit code $1"',
  'LangString webview2InstallSuccess ${LANG_ENGLISH} "WebView2 installed successfully"',
  'LangString deleteAppData ${LANG_ENGLISH} "Delete the application data"',
] as const;

/** The owner-approved wording (2026-11-19); `$\n` is NSIS's line break. */
const APPROVED_OK_KILL =
  'LangString appRunningOkKill ${LANG_ENGLISH} "{{product_name}} is still open.$\\nClick OK to close it now (anything not saved will be lost), or Cancel to stop."';

const isOkKill = (line: string): boolean => line.startsWith('LangString appRunningOkKill ');

/** The ids a language file defines, in order. */
export function langStringIds(text: string): string[] {
  return [...text.matchAll(/^LangString (\w+) /gm)].map((m) => m[1] ?? '');
}

/** Every way `text` differs from the stock file with only the approved line changed. */
export function languageFileProblems(text: string): string[] {
  const problems: string[] = [];
  if (text.startsWith('\uFEFF')) problems.push('starts with a BOM (the bundler adds its own)');
  if (text.includes('\r')) problems.push('has CR line endings');
  if (!text.endsWith('\n')) problems.push('has no final newline');
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/);
  const stockIds = langStringIds(STOCK_ENGLISH.join('\n'));
  const ids = langStringIds(lines.join('\n'));
  if ([...ids].sort().join() !== [...stockIds].sort().join()) {
    problems.push(
      `defines LangStrings [${ids.join(', ')}], not the stock set [${stockIds.join(', ')}]`,
    );
  }
  const okKill = lines.filter(isOkKill);
  if (okKill.length !== 1 || okKill[0] !== APPROVED_OK_KILL) {
    problems.push(`appRunningOkKill is not the approved text: ${okKill.join(' | ')}`);
  }
  STOCK_ENGLISH.forEach((stock, i) => {
    if (!isOkKill(stock) && lines[i] !== stock) {
      problems.push(`line ${i + 1} differs from stock: ${lines[i] ?? '(missing)'}`);
    }
  });
  if (lines.length !== STOCK_ENGLISH.length) {
    problems.push(`has ${lines.length} lines, stock has ${STOCK_ENGLISH.length}`);
  }
  return problems;
}

const COPY =
  STOCK_ENGLISH.map((line) => (isOkKill(line) ? APPROVED_OK_KILL : line)).join('\n') + '\n';

describe('the installer’s English messages are the stock file with one line reworded', () => {
  it('customLanguageFiles.English points at an existing file', () => {
    expect(ENGLISH_PATH, 'bundle.windows.nsis.customLanguageFiles.English').toBe(
      'windows/English.nsh',
    );
    expect(existsSync(`${SRC_TAURI}${ENGLISH_PATH}`)).toBe(true);
  });

  it('the pinned stock file is from the locked tauri-cli', () => {
    // A Tauri upgrade can add, drop or reword strings. Fail until re-fetched.
    expect(LOCKED_CLI, 're-fetch English.nsh at the new tauri-cli tag and re-diff').toBe(
      STOCK_FROM_CLI,
    );
  });

  describe('the file', () => {
    const bytes =
      ENGLISH_PATH === '' ? new Uint8Array() : readFileSync(`${SRC_TAURI}${ENGLISH_PATH}`);
    const text = new TextDecoder('utf-8').decode(bytes);

    it('has no BOM (the bundler prepends one when it copies the file)', () => {
      expect([bytes[0], bytes[1], bytes[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
    });

    it('defines exactly the stock LangString ids', () => {
      expect(langStringIds(text).sort()).toEqual(langStringIds(STOCK_ENGLISH.join('\n')).sort());
    });

    it('appRunningOkKill is the approved text, exactly', () => {
      expect(text.split('\n').filter(isOkKill)).toEqual([APPROVED_OK_KILL]);
    });

    it('no other line differs from stock', () => {
      expect(languageFileProblems(text)).toEqual([]);
      expect(text).toBe(COPY);
    });
  });
});

describe('the language-file check can fail', () => {
  it('passes the intended copy', () => {
    expect(languageFileProblems(COPY)).toEqual([]);
  });

  it('negative: the stock file (OK "kills" the app) is caught', () => {
    const stock = STOCK_ENGLISH.join('\n') + '\n';
    expect(languageFileProblems(stock).join('\n')).toContain(
      'appRunningOkKill is not the approved',
    );
  });

  it('negative: one word changed on another line is caught', () => {
    const changed = COPY.replace('"Do not uninstall"', '"Do not remove"');
    expect(languageFileProblems(changed)).toEqual([
      'line 9 differs from stock: LangString dontUninstall ${LANG_ENGLISH} "Do not remove"',
    ]);
  });

  it('negative: a dropped LangString is caught', () => {
    const dropped = COPY.replace(/^LangString deleteAppData .*\n/m, '');
    expect(languageFileProblems(dropped).join('\n')).toContain('not the stock set');
  });

  it('boundary: a BOM or CRLF endings are caught', () => {
    expect(languageFileProblems(`\uFEFF${COPY}`)).toEqual([
      'starts with a BOM (the bundler adds its own)',
    ]);
    expect(languageFileProblems(COPY.replace(/\n/g, '\r\n'))).toEqual(['has CR line endings']);
  });
});
