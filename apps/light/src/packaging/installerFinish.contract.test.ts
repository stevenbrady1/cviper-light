/**
 * The installer never leaves the person on a screen they cannot get past (L-449).
 *
 * 1. After a good install, setup moves straight on to the Finish page (with
 *    "Finish" and "Run CViper Light"). With MUI_FINISHPAGE_NOAUTOCLOSE it sat
 *    on the "Installation Complete" progress page instead, and on the owner's
 *    PC its "Next >" button was not drawn until "Show details" re-laid the
 *    page out: a dead end. Without NOAUTOCLOSE, MUI's finish-page GUIInit runs
 *    `SetAutoClose true`, and NSIS skips that page only when nothing aborted
 *    (Ui.c: `if (!g_exec_flags.abort && g_exec_flags.autoclose) goto nextPage`),
 *    so a failed install still stops there with its log readable.
 * 2. Replacing an older version by hand runs the old uninstaller with
 *    /P /UPDATE, not /S /UPDATE. The installer hides itself while the old
 *    uninstaller runs (stock HideWindow), so a silent one left nothing at all
 *    on screen. Passive shows the old uninstaller's own progress window, and
 *    still skips its confirm page (un.SkipIfPassive), so the "Delete the
 *    application data" box never appears; /UPDATE still keeps data and keys.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_TAURI = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
const TEMPLATE = readFileSync(`${SRC_TAURI}windows/installer.nsi`, 'utf8');

/** NSIS comments run from `;` or `#` to the end of a line. */
function code(nsis: string): string {
  return nsis
    .split('\n')
    .map((line) => line.replace(/(^|\s)[;#].*$/, ''))
    .join('\n');
}

function functionBody(nsis: string, name: string): string {
  return new RegExp(`\\nFunction ${name}\\n([\\s\\S]*?)\\nFunctionEnd`).exec(code(nsis))?.[1] ?? '';
}

export function finishProblems(nsis: string): string[] {
  const source = code(nsis);
  const problems: string[] = [];
  if (/^\s*!define\s+MUI_FINISHPAGE_NOAUTOCLOSE\b/m.test(source)) {
    problems.push('MUI_FINISHPAGE_NOAUTOCLOSE keeps setup on the "Installation Complete" page');
  }
  if (!/^\s*!insertmacro\s+MUI_PAGE_FINISH\s*$/m.test(source)) {
    problems.push('there is no MUI_PAGE_FINISH');
  }
  if (!/^\s*!define\s+MUI_FINISHPAGE_RUN\s*$/m.test(source)) {
    problems.push('the Finish page has no "Run" checkbox');
  }
  return problems;
}

export function replaceProblems(nsis: string): string[] {
  const leave = functionBody(nsis, 'PageLeaveReinstall');
  const problems: string[] = [];
  if (leave === '') return ['PageLeaveReinstall not found'];
  if (/StrCpy \$R1 "\$R1[^"\n]*\s\/S(\s|")/.test(leave)) {
    problems.push('the old uninstaller is run silently (/S): nothing is on screen while it runs');
  }
  if (
    !/\$\{IfThen\} \$CviperSilentReplace = 1 \$\{\|\} StrCpy \$R1 "\$R1 \/P \/UPDATE"/.test(leave)
  ) {
    problems.push('replacing an older version does not run the old uninstaller with /P /UPDATE');
  }
  return problems;
}

describe('setup moves on to its Finish page', () => {
  it('has a Finish page with the Run checkbox, and no NOAUTOCLOSE', () => {
    expect(finishProblems(TEMPLATE)).toEqual([]);
  });

  it('negative: NOAUTOCLOSE is caught', () => {
    const bad = TEMPLATE.replace(
      /\n!insertmacro MUI_PAGE_FINISH\n/,
      '\n!define MUI_FINISHPAGE_NOAUTOCLOSE\n!insertmacro MUI_PAGE_FINISH\n',
    );
    expect(finishProblems(bad)).toEqual([
      'MUI_FINISHPAGE_NOAUTOCLOSE keeps setup on the "Installation Complete" page',
    ]);
  });

  it('boundary: NOAUTOCLOSE only in a comment does not count', () => {
    const commented = TEMPLATE.replace(
      /\n!insertmacro MUI_PAGE_FINISH\n/,
      '\n; !define MUI_FINISHPAGE_NOAUTOCLOSE\n!insertmacro MUI_PAGE_FINISH\n',
    );
    expect(finishProblems(commented)).toEqual([]);
  });

  it('negative: a Finish page that exists only in a comment is caught', () => {
    const gone = TEMPLATE.replace(
      /\n!insertmacro MUI_PAGE_FINISH\n/,
      '\n; !insertmacro MUI_PAGE_FINISH\n',
    );
    expect(finishProblems(gone)).toEqual(['there is no MUI_PAGE_FINISH']);
  });
});

describe('replacing an older version shows the old uninstaller’s progress', () => {
  it('runs it with /P /UPDATE, never /S', () => {
    expect(replaceProblems(TEMPLATE)).toEqual([]);
  });

  it('negative: /S /UPDATE is caught', () => {
    const silent = TEMPLATE.replace('"$R1 /P /UPDATE"', '"$R1 /S /UPDATE"');
    expect(replaceProblems(silent)).toHaveLength(2);
  });

  it('boundary: /P /UPDATE only in a comment does not count', () => {
    const commented = TEMPLATE.replace(
      /\$\{IfThen\} \$CviperSilentReplace = 1 \$\{\|\} StrCpy \$R1 "\$R1 \/P \/UPDATE" \$\{\|\}/,
      '; ${IfThen} $CviperSilentReplace = 1 ${|} StrCpy $R1 "$R1 /P /UPDATE" ${|}',
    );
    expect(replaceProblems(commented)).toEqual([
      'replacing an older version does not run the old uninstaller with /P /UPDATE',
    ]);
  });
});
