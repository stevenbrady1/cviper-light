/**
 * The telemetry contract: the switch exists, it is off, and NOTHING reads it.
 *
 * ============================================================================
 * THE POINT IS TO MAKE AN ABSENCE AUDITABLE, NOT TO LOOK TIDY.
 * ============================================================================
 * "We collect nothing" is the loudest claim this product makes. A user cannot
 * verify it, a reviewer would have to read the whole app, and the app is not
 * open in front of most of the people who have to decide whether to believe it.
 *
 * So the claim is reduced to something a machine checks in a second: there is
 * one flag, it is the literal `false`, and no branch anywhere in the source
 * does anything when it is true. That is a stronger statement than "we did not
 * write any telemetry", because it stays true as the app grows — the day
 * somebody adds `if (TELEMETRY_ENABLED) send(...)`, this file goes red and the
 * copy on the Settings screen stops being a lie in the same commit.
 *
 * The type does half of it too. `TELEMETRY_ENABLED` is typed as the literal
 * `false`, so flipping it to `true` is a compile error rather than a decision
 * somebody can make quietly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TELEMETRY_ENABLED, TELEMETRY_NOTE } from './telemetry';

/** `src/` — this file lives in `src/features/settings/`. */
const SRC = fileURLToPath(new URL('../../', import.meta.url));

const FLAG = 'TELEMETRY_ENABLED';

/**
 * The only files allowed to mention the flag at all.
 *
 * Not a style rule. Each addition to this list is a new place somebody has to
 * read before they can believe the claim, and the value of the claim is that it
 * is cheap to check.
 */
const ALLOWED = [
  'features/settings/Settings.tsx',
  'features/settings/telemetry.contract.test.ts',
  'features/settings/telemetry.ts',
];

/**
 * Modules that can reach a network or the filesystem. None of them may so much
 * as name telemetry — a read here is the first half of an exfiltration however
 * inert the flag currently is.
 */
const OUTBOUND = [
  'ai/transport.ts',
  'jobs/transport.ts',
  'platform/browser.ts',
  'platform/files.ts',
  'features/settings/updates/port.ts',
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found.sort();
}

/**
 * Drop comments before looking for branches.
 *
 * Deliberately a local copy of the same three lines in
 * `styles/tokens.contract.test.ts` rather than an import: importing one test
 * module from another re-registers its whole suite, and the token contract
 * would then run twice under a name that says nothing about telemetry.
 *
 * Without this the guard fires on its own documentation — the sentence above
 * that says "the day somebody writes `if (TELEMETRY_ENABLED) send(...)`" — and
 * a guard that fails on its own prose is a guard the next person deletes.
 * Stripping can only ever hide a violation, never invent one, and violations do
 * not live in comments.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Every place this source does something BECAUSE the flag is true.
 *
 * Rendering the flag into a control (`checked={TELEMETRY_ENABLED}`) is a read
 * and is fine — that is the switch showing the user its own state. What is
 * forbidden is a BRANCH: code that runs in the true case and not in the false
 * one. That is the shape telemetry would actually arrive in.
 */
export function telemetryBranches(source: string): string[] {
  const patterns: readonly RegExp[] = [
    new RegExp(`\\bif\\s*\\([^)]*${FLAG}`, 'g'),
    new RegExp(`\\bwhile\\s*\\([^)]*${FLAG}`, 'g'),
    new RegExp(`${FLAG}\\s*(?:&&|\\|\\||\\?)`, 'g'),
    new RegExp(`${FLAG}\\s*===?\\s*true`, 'g'),
    new RegExp(`!\\s*${FLAG}`, 'g'),
  ];

  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[0]));
}

const FILES = sourceFiles(SRC);

const MENTIONS = FILES.filter((file) => readFileSync(file, 'utf8').includes(FLAG)).map((file) =>
  relative(SRC, file).replaceAll('\\', '/'),
);

const BRANCHES = FILES.flatMap((file) =>
  telemetryBranches(stripComments(readFileSync(file, 'utf8'))).map(
    (found) => `${relative(SRC, file).replaceAll('\\', '/')}: ${found}`,
  ),
);

describe('the telemetry flag', () => {
  it('is off', () => {
    expect(TELEMETRY_ENABLED).toBe(false);
  });

  it('says, in the user-facing copy, that it is not implemented and sends nothing', () => {
    // The exact promise, asserted so a future copy edit cannot soften it into
    // "we may collect anonymous statistics".
    expect(TELEMETRY_NOTE).toBe(
      'Anonymous usage statistics — not implemented. CViper Light sends no data.',
    );
  });
});

describe('no code path reads the telemetry flag as true', () => {
  it('finds the app source files', () => {
    // Anti-inert: a walker that returned nothing would make both assertions
    // below vacuously true for ever.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((file) => file.endsWith('App.tsx'))).toBe(true);
  });

  it('is mentioned only where the switch is declared and drawn', () => {
    expect(MENTIONS).toEqual(ALLOWED);
  });

  it('is never branched on, anywhere', () => {
    expect(BRANCHES, `\n${BRANCHES.join('\n')}\n`).toEqual([]);
  });

  it('is not so much as named by anything that can reach a network or a file', () => {
    for (const module of OUTBOUND) {
      const source = readFileSync(join(SRC, module), 'utf8');
      expect(source.includes(FLAG), module).toBe(false);
    }
  });
});

describe('the scanner can actually fail', () => {
  // The other half of the anti-inert rule. Every case below is the real shape
  // telemetry would arrive in; if the scanner stops catching one, this block
  // goes red even though the app itself is clean.
  const violations: ReadonlyArray<[string, string]> = [
    ['a plain if', `if (${FLAG}) { send(event); }`],
    ['a guarded call', `${FLAG} && send(event);`],
    ['a ternary', `const url = ${FLAG} ? COLLECTOR : null;`],
    ['an explicit comparison', `if (${FLAG} === true) send(event);`],
    ['a negation', `if (!${FLAG}) return; send(event);`],
    ['a loop', `while (${FLAG}) { flush(); }`],
    ['a multi-condition guard', `if (online && ${FLAG}) send(event);`],
  ];

  it.each(violations)('catches %s', (_name, source) => {
    expect(telemetryBranches(source)).not.toEqual([]);
  });

  it('negative: does not fire on the switch drawing its own state', () => {
    // A scanner that flagged this would be deleted the first time somebody hit
    // it, and the guard would go with it.
    expect(telemetryBranches(`<input checked={${FLAG}} disabled />`)).toEqual([]);
    expect(telemetryBranches(`export const ${FLAG}: TelemetryEnabled = false;`)).toEqual([]);
  });

  it('boundary: an empty file has no branches', () => {
    expect(telemetryBranches('')).toEqual([]);
  });
});
