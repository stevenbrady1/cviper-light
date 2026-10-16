/**
 * The Windows installer runs CViper Light's copy of Tauri's NSIS template
 * (L-253), and the copy keeps exactly the changes it was made for.
 *
 * ============================================================================
 * WHY THERE IS A COPY AT ALL
 * ============================================================================
 * Two behaviours of the stock template (tauri-cli 2.11.4) hurt on the owner's
 * machine:
 *
 *   1. Finish did its work on the installer window's own thread: the desktop
 *      shortcut (through a OneDrive-redirected Desktop) and launching a new,
 *      unsigned exe with a synchronous ShellExecute. The window went "Not
 *      Responding".
 *   2. Installing over an older version by hand ran the old uninstaller WITH
 *      its window — including "Delete the application data", which since
 *      0.10.1 also deletes the saved keys.
 *
 * Tauri offers no hook for either, so `bundle.windows.nsis.template` points at
 * `src-tauri/windows/installer.nsi`: the stock file with a few lines changed,
 * each marked `; CVIPER:`. This guard holds those changes in place, holds the
 * parts that must NOT change (the update path, the hooks, the images), and
 * fails when Tauri is upgraded until somebody re-diffs the copy.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_TAURI = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NSIS = (
  JSON.parse(readFileSync(`${SRC_TAURI}tauri.conf.json`, 'utf8')) as {
    bundle?: { windows?: { nsis?: { template?: string } } };
  }
).bundle?.windows?.nsis;

const TEMPLATE_PATH = NSIS?.template ?? '';
const TEMPLATE = TEMPLATE_PATH === '' ? '' : readFileSync(`${SRC_TAURI}${TEMPLATE_PATH}`, 'utf8');

/** NSIS comments run from `;` to the end of a line (and `#`, unused here). */
function code(nsis: string): string {
  return nsis
    .split('\n')
    .map((line) => line.replace(/(^|\s);.*$/, ''))
    .join('\n');
}

/** The body of `Function <name>` … `FunctionEnd`, comments removed. */
export function functionBody(nsis: string, name: string): string {
  const match = new RegExp(`\\nFunction ${name}\\n([\\s\\S]*?)\\nFunctionEnd`).exec(code(nsis));
  return match?.[1] ?? '';
}

/** The install Section's body (the unnamed `Section Install`), comments removed. */
export function installSection(nsis: string): string {
  return /\nSection Install\n([\s\S]*?)\nSectionEnd/.exec(code(nsis))?.[1] ?? '';
}

/** Everything wired to the finish page: its defines, and the functions they name. */
export function finishPageProblems(nsis: string): string[] {
  const problems: string[] = [];
  const source = code(nsis);
  if (/MUI_FINISHPAGE_SHOWREADME/.test(source)) {
    problems.push('the finish page still has a SHOWREADME (desktop shortcut) action');
  }
  const run = /!define MUI_FINISHPAGE_RUN_FUNCTION (\w+)/.exec(source)?.[1];
  const runBody = run === undefined ? '' : functionBody(nsis, run);
  if (/CreateShortcut|CreateOrUpdateDesktopShortcut|SetLnkAppUserModelId/.test(runBody)) {
    problems.push('the finish-page run action creates a shortcut');
  }
  if (/ExecWait|RunAsUser|ExecShellWait/.test(runBody)) {
    problems.push('the finish-page run action blocks the window while Windows starts the app');
  }
  if (
    run !== undefined &&
    !/^\s*Exec\s+'"\$WINDIR\\explorer\.exe"\s+"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"'\s*$/m.test(
      runBody,
    )
  ) {
    problems.push('the finish-page run action is not the non-blocking explorer.exe launch');
  }
  return problems;
}

const LOCK = readFileSync(`${REPO_ROOT}pnpm-lock.yaml`, 'utf8');
const LOCKED_CLI = /'@tauri-apps\/cli@(\d+\.\d+\.\d+)':/.exec(LOCK)?.[1] ?? '';

describe('the installer uses CViper Light’s template', () => {
  it('is configured in tauri.conf.json and exists', () => {
    expect(TEMPLATE_PATH).toBe('windows/installer.nsi');
    expect(TEMPLATE.length).toBeGreaterThan(20_000);
  });

  it('records the tauri-cli version it was copied from, and that version is the one locked', () => {
    const recorded = /; Copied from tauri-cli (\d+\.\d+\.\d+)/.exec(TEMPLATE)?.[1];
    expect(recorded).toBeDefined();
    expect(LOCKED_CLI, 'pnpm-lock.yaml @tauri-apps/cli').toMatch(/^\d+\.\d+\.\d+$/);
    // A Tauri upgrade changes the stock template. Fail until the copy is re-diffed.
    expect(recorded).toBe(LOCKED_CLI);
  });

  it('marks every change, and names it in the header', () => {
    const markers = TEMPLATE.split('\n').filter((line) => line.includes('; CVIPER:'));
    // The header lists the four changes; each change is marked where it is made.
    expect(markers.length).toBeGreaterThanOrEqual(4);
    expect(TEMPLATE).toMatch(/re-diff/i);
  });
});

describe('fix 1: Finish never blocks the installer window', () => {
  it('the finish page creates no shortcut and launches without waiting', () => {
    expect(finishPageProblems(TEMPLATE)).toEqual([]);
  });

  it('the desktop shortcut is created in the install Section, by the same function', () => {
    const section = installSection(TEMPLATE);
    expect(section).toMatch(/Call CreateOrUpdateDesktopShortcut/);
    // No longer only for passive/silent installs: every install runs it, and
    // the function itself keeps the update-mode and /NS guards.
    expect(section).not.toMatch(
      /\$\{If\} \$PassiveMode = 1\s*\n\s*\$\{OrIf\} \$\{Silent\}\s*\n\s*Call CreateOrUpdateDesktopShortcut/,
    );
  });

  it('the shortcut function still skips update mode and /NS, and still migrates old shortcuts', () => {
    const body = functionBody(TEMPLATE, 'CreateOrUpdateDesktopShortcut');
    expect(body).toMatch(/\$UpdateMode = 1/);
    expect(body).toMatch(/\$NoShortcutMode = 1/);
    expect(body).toMatch(/IsShortcutTarget/);
    expect(body).toMatch(/SetLnkAppUserModelId/);
  });

  it('the updater’s passive /R relaunch is untouched', () => {
    const body = functionBody(TEMPLATE, '\\.onInstSuccess');
    expect(body).toMatch(/\$\{GetOptions\} \$CMDLINE "\/R" \$R0/);
    expect(body).toMatch(
      /nsis_tauri_utils::RunAsUser "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe" "\$R0"/,
    );
  });
});

describe('fix 2: an upgrade by hand never shows the old uninstaller', () => {
  const leave = functionBody(TEMPLATE, 'PageLeaveReinstall');

  it('passes /S /UPDATE to the old uninstaller when replacing an older version', () => {
    expect(leave).toMatch(/StrCpy \$R1 "\$R1 \/S \/UPDATE"/);
    // Only on the flag set for an upgrade (not WiX, not same version, not a downgrade).
    expect(leave).toMatch(/\$\{AndIf\} \$R0 = 1/);
    expect(leave).toMatch(/\$\{IfThen\} \$CviperSilentReplace = 1/);
  });

  it('asks before closing a running app, rather than letting a silent uninstall kill it', () => {
    expect(leave).toMatch(/!insertmacro CheckIfAppIsRunning "\$\{MAINBINARYNAME\}\.exe"/);
  });

  it('the updater path still skips the uninstaller altogether', () => {
    expect(leave).toMatch(/\$\{If\} \$UpdateMode = 1\s*\n\s*Goto reinst_done/);
  });
});

describe('what must not change', () => {
  it('every installer hook call site is still there', () => {
    for (const hook of [
      'NSIS_HOOK_PREINSTALL',
      'NSIS_HOOK_POSTINSTALL',
      'NSIS_HOOK_PREUNINSTALL',
      'NSIS_HOOK_POSTUNINSTALL',
    ]) {
      expect(TEMPLATE, hook).toContain(`!ifmacrodef ${hook}\n    !insertmacro ${hook}`);
    }
    expect(TEMPLATE).toContain('!include "{{installer_hooks}}"');
  });

  it('the image and icon defines are still used', () => {
    expect(TEMPLATE).toContain('!define SIDEBARIMAGE "{{sidebar_image}}"');
    expect(TEMPLATE).toContain('!define HEADERIMAGE "{{header_image}}"');
    expect(TEMPLATE).toContain('!define INSTALLERICON "{{installer_icon}}"');
    expect(TEMPLATE).toContain('!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBARIMAGE}"');
    expect(TEMPLATE).toContain('!define MUI_HEADERIMAGE_BITMAP "${HEADERIMAGE}"');
  });

  it('the app-data deletion stays behind the checkbox and update mode', () => {
    expect(TEMPLATE).toMatch(
      /\$\{If\} \$DeleteAppDataCheckboxState = 1\s*\n\s*\$\{AndIf\} \$UpdateMode <> 1/,
    );
  });
});

describe('the guards can fail', () => {
  it('catches the stock finish page (shortcut on Finish, blocking RunAsUser)', () => {
    const stock = TEMPLATE.replace(
      /\n!define MUI_FINISHPAGE_RUN\n/,
      '\n!define MUI_FINISHPAGE_SHOWREADME\n!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut\n!define MUI_FINISHPAGE_RUN\n',
    ).replace(
      /Exec '"\$WINDIR\\explorer\.exe" "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"'/,
      'nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" ""',
    );
    const problems = finishPageProblems(stock);
    expect(problems.join('\n')).toContain('SHOWREADME');
    expect(problems.join('\n')).toContain('blocks the window');
  });

  it('ignores a call that only appears in a comment', () => {
    expect(
      functionBody('\nFunction F\n  ; ExecWait "x"\nFunctionEnd', 'F').includes('ExecWait'),
    ).toBe(false);
  });
});
