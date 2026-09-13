/**
 * The Rust half of the loop must not narrow what it runs (L-107).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `cargo:test` was `cargo test … --lib`. `--lib` runs the library's unit tests
 * and NOTHING ELSE — no doc-tests, no binary targets, no integration tests. So
 * `cargo test` in `apps/light/src-tauri` exited 101 for months, on a doc
 * comment in `secrets.rs` that rustdoc was trying to compile as Rust, and the
 * one command CI ran was the one command that could not see it.
 *
 * `verify-loop-matches-ci.contract.test.ts` could not catch that, and the
 * boundary is worth being precise about: it compares INVOCATIONS. Both sides
 * ran `pnpm cargo:test`, so both sides agreed, and both were blind in the same
 * way. This guard is about the BODY of that one script — what the invocation
 * actually asks cargo to do.
 *
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033). It does not prescribe the
 * command; it names the flags that make cargo run less than everything, so a
 * flag nobody has thought of yet is caught by the shape rather than by the
 * list being kept up to date. `--all-targets` is on it deliberately: it reads
 * like the widest possible option and is the exact opposite here — cargo
 * documents that it EXCLUDES doc-tests, which is precisely the population
 * `--lib` was already hiding.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const MANIFEST_PATH = 'package.json';
const SCRIPT = 'cargo:test';

/**
 * Flags that make `cargo test` run a SUBSET of the targets, with the reason
 * each one is refused. Every one of them silently drops doc-tests.
 */
const NARROWING_FLAGS: readonly { readonly flag: string; readonly why: string }[] = [
  { flag: '--lib', why: 'runs the library unit tests only — this is the original L-107 defect' },
  { flag: '--bins', why: 'runs binary targets only' },
  { flag: '--bin', why: 'runs one named binary only' },
  { flag: '--tests', why: 'runs integration test targets only' },
  { flag: '--test', why: 'runs one named integration target only' },
  { flag: '--examples', why: 'runs example targets only' },
  { flag: '--example', why: 'runs one named example only' },
  { flag: '--benches', why: 'runs benchmark targets only' },
  { flag: '--bench', why: 'runs one named benchmark only' },
  { flag: '--doc', why: 'runs doc-tests only, dropping every unit test' },
  {
    flag: '--all-targets',
    why: 'reads as "everything" and is not: cargo excludes doc-tests from it',
  },
];

/** Every narrowing flag present in a command, as whole words. */
export function narrowingFlagsIn(command: string): string[] {
  return NARROWING_FLAGS.filter(({ flag }) =>
    // Whole-flag match: `--bin` must not fire on `--bins`, and `--test` must
    // not fire on `--tests`; each has its own entry and its own reason.
    new RegExp(`(?:^|\\s)${flag}(?=\\s|=|$)`).test(command),
  ).map(({ flag }) => flag);
}

const SCRIPTS: Readonly<Record<string, string>> = (() => {
  const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8'));
  const scripts = (manifest as { scripts?: unknown }).scripts;
  return typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, string>) : {};
})();

describe(`\`pnpm ${SCRIPT}\` runs every Rust test, doc-tests included`, () => {
  it('the premise: the script exists and is a cargo test invocation', () => {
    // Anti-inert. A renamed or deleted script would make the assertion below
    // pass over an empty string, which is the failure mode this whole file is
    // about: a check that reports health for something it never read.
    const command = SCRIPTS[SCRIPT];
    expect(
      command,
      `${MANIFEST_PATH} has no "${SCRIPT}" script. If it was renamed, rename SCRIPT here with it.`,
    ).toBeTypeOf('string');
    expect(command).toContain('cargo test');
  });

  it('narrows nothing', () => {
    const command = SCRIPTS[SCRIPT] ?? '';
    const found = narrowingFlagsIn(command);
    const why = NARROWING_FLAGS.filter((entry) => found.includes(entry.flag))
      .map((entry) => `${entry.flag} ${entry.why}`)
      .join('; ');
    expect(
      found,
      `\`${command}\` cannot see every Rust test: ${why}. A doc comment that rustdoc fails to ` +
        'compile is a red build that CI reports as green (L-107).',
    ).toEqual([]);
  });

  it('the detector fires on the command as it was before the fix', () => {
    // Proof, not assumption: the literal pre-L-107 script, transcribed.
    expect(
      narrowingFlagsIn('cargo test --manifest-path apps/light/src-tauri/Cargo.toml --lib'),
    ).toEqual(['--lib']);
  });

  it('the detector fires on each narrowing flag, and on nothing else', () => {
    for (const { flag } of NARROWING_FLAGS) {
      expect(narrowingFlagsIn(`cargo test ${flag}`), flag).toEqual([flag]);
    }
    // Boundary: a flag that is a prefix of another must not be confused for it,
    // and an unrelated flag must not trip anything.
    expect(narrowingFlagsIn('cargo test --bins')).toEqual(['--bins']);
    expect(narrowingFlagsIn('cargo test --tests')).toEqual(['--tests']);
    expect(narrowingFlagsIn('cargo test --libraries-are-fine')).toEqual([]);
    expect(narrowingFlagsIn('cargo test --manifest-path a/Cargo.toml')).toEqual([]);
  });
});
