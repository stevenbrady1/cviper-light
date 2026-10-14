/**
 * The updater signing key is readable by ONE kind of step, and that step only
 * signs (L-223).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `TAURI_SIGNING_PRIVATE_KEY` and its password used to sit in the `env:` of the
 * tauri-action step, which BUILDS the app. Everything that build runs inherited
 * them: `beforeBuildCommand`, every Vite plugin, and the `build.rs` of every
 * crate in the dependency tree. Any one of those, compromised, could read the
 * key — and a leaked updater key cannot be revoked, because every installed
 * copy trusts it forever (RELEASE-SIGNING.md §1).
 *
 * The build now runs with no key. A separate `sign` job, on a fresh runner that
 * installs dependencies with `--ignore-scripts` and builds nothing, downloads
 * the bundles from the draft and runs `tauri signer sign` on them.
 *
 * ============================================================================
 * A FORBID-LIST (LESSON-033)
 * ============================================================================
 * The key's NAME, anywhere outside a comment, is what is tracked — `env:`,
 * `${{ secrets.… }}` and a shell reference all spell it. Forbidden:
 *
 *   1. The key in any workflow but release.yml.
 *   2. The key at workflow level or in a job's own `env:`, where every step
 *      sees it.
 *   3. The key on a step that does not run `tauri signer sign`, or that also
 *      uses an action, installs, or builds.
 *   4. The key in a job that also builds, or installs dependencies with their
 *      scripts allowed to run: anything that runs on that runner before the
 *      signing step could leave code behind for it to execute.
 *
 * Lexical, like the other workflow guards: `#` comments are stripped first so
 * the prose explaining the rule cannot trip it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');
const RELEASE = 'release.yml';

/** Covers the key and its password, which is useless without it but no less secret. */
const KEY = /TAURI_SIGNING_PRIVATE_KEY/;
const SIGNS = /tauri\s+signer\s+sign\b/;

/** Runs code from the dependency tree, or the app's own build. */
const BUILDS: ReadonlyArray<{ readonly pattern: RegExp; readonly what: string }> = [
  { pattern: /uses:\s*tauri-apps\/tauri-action/, what: 'runs tauri-action, which builds' },
  { pattern: /tauri\s+build\b/, what: 'runs `tauri build`' },
  { pattern: /\bcargo\s+(?:build|run|test|check|install)\b/, what: 'compiles Rust' },
  { pattern: /\bpnpm\s+(?:run\s+)?build\b/, what: 'runs the frontend build' },
  { pattern: /\b(?:npm|npx|yarn)\b/, what: 'uses a package manager this repository forbids' },
];

/** `pnpm install` lets every dependency's install script run unless told not to. */
const INSTALLS = /\bpnpm\s+(?:install|i|add)\b[^\n]*/g;

interface Step {
  readonly text: string;
}

interface Job {
  readonly id: string;
  /** Everything in the job that is not a step: its `if:`, `env:`, `needs:` … */
  readonly own: string;
  readonly steps: readonly Step[];
  readonly text: string;
}

function withoutComments(workflow: string): string {
  return workflow
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

const depthOf = (line: string): number => line.length - line.trimStart().length;

/** Split a workflow into its top-level text and its jobs, each split into steps. */
function parse(workflow: string): { readonly top: string; readonly jobs: readonly Job[] } {
  const lines = withoutComments(workflow).split('\n');
  const top: string[] = [];
  const jobs: Array<{ id: string; lines: string[] }> = [];

  let inJobs = false;
  let jobIndent = -1;
  for (const line of lines) {
    if (!inJobs) {
      if (/^jobs:\s*$/.test(line)) inJobs = true;
      else top.push(line);
      continue;
    }
    if (line.trim() === '') continue;
    const depth = depthOf(line);
    if (depth === 0) {
      inJobs = false;
      top.push(line);
      continue;
    }
    const header = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header && (jobIndent === -1 || depth === jobIndent)) {
      jobIndent = depth;
      jobs.push({ id: header[2] ?? '', lines: [] });
      continue;
    }
    jobs.at(-1)?.lines.push(line);
  }

  return {
    top: top.join('\n'),
    jobs: jobs.map(({ id, lines: jobLines }) => {
      const own: string[] = [];
      const steps: string[][] = [];
      let stepsDepth = -1;
      let stepIndent = -1;
      for (const line of jobLines) {
        const depth = depthOf(line);
        if (/^\s*steps:\s*$/.test(line)) {
          stepsDepth = depth;
          continue;
        }
        if (stepsDepth !== -1 && depth <= stepsDepth) stepsDepth = -1;
        if (stepsDepth === -1) {
          own.push(line);
          continue;
        }
        if (/^\s*-\s/.test(line) && (stepIndent === -1 || depth === stepIndent)) {
          stepIndent = depth;
          steps.push([line]);
          continue;
        }
        steps.at(-1)?.push(line);
      }
      return {
        id,
        own: own.join('\n'),
        steps: steps.map((step) => ({ text: step.join('\n') })),
        text: jobLines.join('\n'),
      };
    }),
  };
}

/** Every way `workflow` (named `file`) lets something other than the signer read the key. */
export function keyOffences(file: string, workflow: string): string[] {
  const offences: string[] = [];
  const { top, jobs } = parse(workflow);

  const mentions = KEY.test(top) || jobs.some((job) => KEY.test(job.text));
  if (!mentions) return offences;

  if (file !== RELEASE) {
    offences.push(
      `${file}: names the updater signing key. Only release.yml signs anything, and every other ` +
        'workflow that can read the key is one more place it can leak from.',
    );
  }
  if (KEY.test(top)) {
    offences.push(
      `${file}: the signing key is set at WORKFLOW level, so every step of every job can read it.`,
    );
  }

  for (const job of jobs) {
    const keySteps = job.steps.filter((step) => KEY.test(step.text));
    if (KEY.test(job.own)) {
      offences.push(
        `${file} job "${job.id}": the signing key is in the job's own env, so every step in ` +
          'it — including any that build or install — can read it.',
      );
    }
    if (keySteps.length === 0 && !KEY.test(job.own)) continue;

    for (const step of keySteps) {
      if (!SIGNS.test(step.text)) {
        offences.push(
          `${file} job "${job.id}": a step that does not run \`tauri signer sign\` can read the ` +
            'signing key.',
        );
      }
      if (/^\s*-?\s*uses:/m.test(step.text)) {
        offences.push(
          `${file} job "${job.id}": the signing key is handed to an action. An action is code ` +
            'from outside this repository; only the signer may see the key.',
        );
      }
      for (const { pattern, what } of BUILDS) {
        if (pattern.test(step.text)) {
          offences.push(`${file} job "${job.id}": the step holding the signing key ${what}.`);
        }
      }
      if ((step.text.match(INSTALLS) ?? []).length > 0) {
        offences.push(
          `${file} job "${job.id}": the step holding the signing key installs dependencies.`,
        );
      }
    }

    for (const { pattern, what } of BUILDS) {
      if (pattern.test(job.text)) {
        offences.push(
          `${file} job "${job.id}": signs, and also ${what}. A build runs code from the whole ` +
            'dependency tree on this runner, and anything it leaves behind runs again when the ' +
            'signing step calls a tool.',
        );
      }
    }
    for (const install of job.text.match(INSTALLS) ?? []) {
      if (!install.includes('--ignore-scripts')) {
        offences.push(
          `${file} job "${job.id}": signs, and runs \`${install.trim()}\` without ` +
            '`--ignore-scripts`, which lets every dependency run its install script on this runner.',
        );
      }
    }
  }

  return offences;
}

// ── The premise ─────────────────────────────────────────────────────────────

const files = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
const read = (file: string): string => readFileSync(join(WORKFLOWS, file), 'utf8');

describe('the premise: release.yml still signs, in a step this guard can see', () => {
  it('finds a step holding the key that runs the signer', () => {
    const { jobs } = parse(read(RELEASE));
    const signing = jobs.flatMap((job) =>
      job.steps.filter((step) => KEY.test(step.text) && SIGNS.test(step.text)),
    );
    expect(signing.length).toBeGreaterThan(0);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('only the signer can read the signing key', () => {
  it.each(files)('%s is clean', (file) => {
    expect(keyOffences(file, read(file))).toEqual([]);
  });
});

// ── The detector can fail ───────────────────────────────────────────────────

const SIGN_STEP = [
  '      - name: Sign',
  '        env:',
  '          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
  '        run: pnpm --dir apps/light exec tauri signer sign bundles/a.msi',
];

const job = (id: string, steps: readonly string[], own: readonly string[] = []): string =>
  [`  ${id}:`, '    runs-on: ubuntu-latest', ...own, '    steps:', ...steps].join('\n');

const workflow = (...jobs: string[]): string => ['on: push', 'jobs:', ...jobs].join('\n');

describe('the detector can actually fail', () => {
  it('flags the old layout: the key on the tauri-action step that builds', () => {
    const old = workflow(
      job('bundle', [
        '      - run: pnpm install --frozen-lockfile',
        '      - uses: tauri-apps/tauri-action@0123456789abcdef0123456789abcdef01234567',
        '        env:',
        '          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
      ]),
    );
    const offences = keyOffences(RELEASE, old).join('\n');
    expect(offences).toMatch(/does not run `tauri signer sign`/);
    expect(offences).toMatch(/handed to an action/);
    expect(offences).toMatch(/tauri-action/);
    expect(offences).toMatch(/--ignore-scripts/);
  });

  it('flags the key at workflow level', () => {
    const text = [
      'on: push',
      'env:',
      '  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}',
      'jobs:',
      job('sign', SIGN_STEP),
    ].join('\n');
    expect(keyOffences(RELEASE, text).join('\n')).toMatch(/WORKFLOW level/);
  });

  it("flags the key in a job's own env", () => {
    const text = workflow(
      job(
        'sign',
        ['      - run: pnpm --dir apps/light exec tauri signer sign a.msi'],
        ['    env:', '      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.X }}'],
      ),
    );
    expect(keyOffences(RELEASE, text).join('\n')).toMatch(/job's own env/);
  });

  it('flags a signing job that installs with scripts allowed', () => {
    const text = workflow(
      job('sign', ['      - run: pnpm install --frozen-lockfile', ...SIGN_STEP]),
    );
    expect(keyOffences(RELEASE, text).join('\n')).toMatch(/--ignore-scripts/);
  });

  it('flags a signing job that also builds', () => {
    const text = workflow(job('sign', ['      - run: pnpm build', ...SIGN_STEP]));
    expect(keyOffences(RELEASE, text).join('\n')).toMatch(/frontend build/);
  });

  it('flags the key referenced inline in a run line that is not the signer', () => {
    const text = workflow(
      job('sign', ['      - run: echo "${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}" > key']),
    );
    expect(keyOffences(RELEASE, text).join('\n')).toMatch(/does not run `tauri signer sign`/);
  });

  it('flags the key in any workflow other than release.yml', () => {
    expect(keyOffences('ci.yml', workflow(job('sign', SIGN_STEP))).join('\n')).toMatch(
      /Only release.yml signs/,
    );
  });
});

describe('a correct layout walks through', () => {
  it('accepts a signing job that installs with --ignore-scripts and only signs', () => {
    const text = workflow(
      job('bundle', [
        '      - run: pnpm install --frozen-lockfile',
        '      - uses: tauri-apps/tauri-action@0123456789abcdef0123456789abcdef01234567',
      ]),
      job('sign', [
        '      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567',
        '      - run: pnpm install --frozen-lockfile --ignore-scripts',
        ...SIGN_STEP,
      ]),
    );
    expect(keyOffences(RELEASE, text)).toEqual([]);
  });

  it('ignores the key named only in a comment', () => {
    const text = workflow(
      job('bundle', ['      # TAURI_SIGNING_PRIVATE_KEY is not here any more', '      - run: x']),
    );
    expect(keyOffences(RELEASE, text)).toEqual([]);
  });

  it('boundary: a workflow that never names the key has nothing to say', () => {
    expect(keyOffences('ci.yml', workflow(job('verify', ['      - run: pnpm build'])))).toEqual([]);
  });
});

// ── One failed platform must not hold back the others' update file ─────────
//
// `bundle` is a matrix, and a job that `needs:` it sees ONE result for all of
// its legs: a single failed leg is `failure`, and a plain `needs:` skips the
// job. light-v0.9.0 showed it — the macOS leg failed on a half-set group of
// Apple secrets in one second, and the Windows installers sat on the draft
// with nothing to sign them. Before L-223 tauri-action wrote each leg's
// manifest itself, so Windows shipped regardless.
//
// So the job that signs must run whenever bundling was ATTEMPTED — `!cancelled()`
// in its condition, and still the push-and-tag conjuncts. It then signs what
// actually reached the draft, and fails loudly if nothing did.

/** Every way the signing job could be skipped by one failed platform leg. */
export function legOffences(workflow: string): string[] {
  const { jobs } = parse(workflow);
  const offences: string[] = [];
  for (const job of jobs) {
    if (!job.steps.some((step) => KEY.test(step.text) && SIGNS.test(step.text))) continue;
    const condition = /^\s*if:\s*(.+)$/m.exec(job.own)?.[1] ?? '';
    if (!/!\s*cancelled\(\)|\balways\(\)/.test(condition)) {
      offences.push(
        `job "${job.id}": signs, but its \`if:\` has no \`!cancelled()\`, so one failed platform ` +
          'leg skips it and no other platform gets an update file.',
      );
    }
    for (const conjunct of ["github.event_name == 'push'", "github.ref_type == 'tag'"]) {
      if (!condition.includes(conjunct)) {
        offences.push(`job "${job.id}": signs without requiring ${conjunct} in its \`if:\`.`);
      }
    }
  }
  return offences;
}

describe('a failed platform leg does not stop the others being signed', () => {
  it('release.yml is clean', () => {
    expect(legOffences(read(RELEASE))).toEqual([]);
  });

  it('flags the plain needs that skipped signing on light-v0.9.0', () => {
    const text = workflow(
      job('sign', SIGN_STEP, [
        '    needs: bundle',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
      ]),
    );
    expect(legOffences(text).join('\n')).toMatch(/!cancelled\(\)/);
  });

  it('flags a signing job that runs on anything but a pushed tag', () => {
    const text = workflow(
      job('sign', SIGN_STEP, ['    needs: bundle', '    if: ${{ !cancelled() }}']),
    );
    expect(legOffences(text).join('\n')).toMatch(/event_name/);
  });

  it('accepts !cancelled() alongside the push-and-tag conjuncts', () => {
    const text = workflow(
      job('sign', SIGN_STEP, [
        '    needs: bundle',
        "    if: \"!cancelled() && github.event_name == 'push' && github.ref_type == 'tag'\"",
      ]),
    );
    expect(legOffences(text)).toEqual([]);
  });
});
