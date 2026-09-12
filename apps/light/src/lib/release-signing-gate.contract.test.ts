/**
 * The macOS release-signing contract (L-95): no step in `release.yml` may reach
 * Apple's signing tools carrying secrets nobody has checked.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Tag `light-v0.1.0` died on the macOS leg with
 *
 *   failed codesign application: failed to run command security import:
 *   failed to import keychain certificate
 *
 * The cause was not a bad certificate. It was an ABSENT one. An unset secret
 * does not reach a workflow as "undefined" — GitHub expands it to an EMPTY
 * STRING, so `APPLE_CERTIFICATE` arrived present-and-blank, and the bundler
 * dutifully asked `security import` to import nothing.
 *
 * That is the shape worth forbidding, because the three states are not equally
 * visible:
 *
 *   all five set      -> sign, notarise, upload
 *   none set          -> skip the leg, loudly, and still ship Windows
 *   SOME set          -> the dangerous middle. Blank is indistinguishable from
 *                        real to anything that only asks "is it there?"
 *
 * The middle state is the one that burned a release, and it is the one a person
 * reading a green run would never suspect.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This encodes "an unchecked Apple secret must be ABSENT from a build step",
 * never "the workflow must contain the right lines". An allow-list asserting
 * some blessed step name exists would pass the day somebody renamed the step
 * around it and fail the day somebody improved it — and the first person to hit
 * that deletes the guard rather than the defect.
 *
 * Three shapes are forbidden:
 *
 *   1. A step that names `secrets.APPLE_*` without being gated on a classifier
 *      output equal to `'yes'`. The classifier itself is exempt: it is the step
 *      that DOES the asking, recognised by its write to `$GITHUB_OUTPUT`.
 *   2. A single-architecture macOS bundle (`--target aarch64-apple-darwin` or
 *      `--target x86_64-apple-darwin`). Either one produces an installer that
 *      simply does not run for half the Macs that download it, and it fails on
 *      the USER's machine, not in CI.
 *   3. A `universal-apple-darwin` bundle whose toolchain never installs both
 *      slices. `universal-apple-darwin` is not a rustup target — it is a Tauri
 *      pseudo-target that lipos `aarch64` and `x86_64` together, so omitting
 *      either is a build that cannot link.
 *
 * ============================================================================
 * WHY THE GATE MUST BE `== 'yes'` AND NOT `!= 'no'`
 * ============================================================================
 * Proved as a boundary below. A classifier with three answers gated on "not no"
 * lets the misconfigured middle through — which is precisely the state that
 * broke the release. The forbid-list therefore refuses to accept any condition
 * other than an equality test against the affirmative.
 *
 * ============================================================================
 * WHAT COUNTS AS TEXT, AND THE LIMITATIONS THAT COME WITH IT
 * ============================================================================
 * COMMENTS ARE EXCLUDED, for the reason `repo-scan.ts` gives: a guard that
 * fires on the prose explaining the fix is a guard somebody deletes. `#`
 * comments are stripped before anything is adjudicated.
 *
 * Two limitations that buys, stated rather than hidden:
 *
 *   - A commented-out matrix leg is invisible here. That is deliberate and it
 *     is why the premise is asserted first (below): if the macOS leg is ever
 *     commented out again, `the macOS leg is switched on` fails and names that,
 *     instead of this file quietly adjudicating a workflow with nothing in it.
 *   - A condition written as a FOLDED scalar (`if: >`) spreads across lines and
 *     would not be read as a gate. It would fail CLOSED — reported as ungated —
 *     which is the safe direction for a forbid-list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOW_PATH = '.github/workflows/release.yml';
const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8');

/** The five secrets a signed, notarised macOS build cannot proceed without. */
export const APPLE_SECRETS = [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
] as const;

/** The two real rustup targets a universal binary is lipo'd from. */
export const MAC_SLICES = ['aarch64-apple-darwin', 'x86_64-apple-darwin'] as const;

export interface Offence {
  readonly where: string;
  readonly found: string;
  readonly why: string;
}

interface Step {
  readonly text: string;
  readonly line: number;
  readonly name: string;
}

/** Any mention of an Apple secret. Not global: this one is only ever `.test`ed. */
const NAMES_AN_APPLE_SECRET = /secrets\.APPLE_[A-Z_]+/;

/** The classifier is the step that writes the answer, so it cannot be gated on it. */
const WRITES_THE_GATE = /GITHUB_OUTPUT/;

/** A gate is an equality test against the affirmative, on some step's output. */
const GATE_CONDITION = /steps\.[A-Za-z0-9_-]+\.outputs\.[A-Za-z0-9_-]+\s*==\s*'yes'/;

const SINGLE_ARCH_BUNDLE = /--target\s+(aarch64-apple-darwin|x86_64-apple-darwin)\b/g;
const UNIVERSAL_BUNDLE = /--target\s+universal-apple-darwin\b/;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The workflow as the runner sees it, with `#` commentary gone. */
export function readableYaml(source: string): string {
  return source.replaceAll('\r\n', '\n').replace(/(^|\s)#.*$/gm, '$1');
}

/**
 * The steps of every job, as blocks.
 *
 * Deliberately lexical — no YAML parser, matching the house style of the other
 * repository guards. A step begins at a `-` at the list indentation under a
 * `steps:` key and runs until the next one, or until the indentation escapes
 * back out of the block.
 */
export function stepsOf(workflow: string): Step[] {
  const lines = workflow.split('\n');
  const steps: Step[] = [];

  let inSteps = false;
  let stepsIndent = 0;
  let dashIndent = -1;
  let current: string[] = [];
  let start = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const text = current.join('\n');
    const label = /^\s*-?\s*(?:name|uses):\s*(.+)$/m.exec(text);
    steps.push({ text, line: start + 1, name: label?.[1]?.trim() ?? '(unnamed step)' });
    current = [];
  };

  lines.forEach((line, index) => {
    const stepsKey = /^(\s*)steps:\s*$/.exec(line);
    if (stepsKey) {
      flush();
      inSteps = true;
      stepsIndent = stepsKey[1]?.length ?? 0;
      dashIndent = -1;
      return;
    }
    if (!inSteps) return;

    if (line.trim() === '') {
      if (current.length > 0) current.push(line);
      return;
    }

    const indent = line.length - line.trimStart().length;

    if (/^\s*-\s+\S/.test(line) && (dashIndent === -1 || indent === dashIndent)) {
      flush();
      dashIndent = indent;
      start = index;
      current = [line];
      return;
    }

    if (indent <= stepsIndent) {
      flush();
      inSteps = false;
      return;
    }

    current.push(line);
  });

  flush();
  return steps;
}

function conditionsOf(step: string): string {
  return step
    .split('\n')
    .filter((line) => /^\s*if:/.test(line))
    .join(' ');
}

function appleSecretsIn(step: string): string[] {
  return [
    ...new Set([...step.matchAll(/secrets\.(APPLE_[A-Z_]+)/g)].map((match) => match[1] ?? '')),
  ];
}

function installsSlice(workflow: string, slice: string): boolean {
  const literal = escapeForRegExp(slice);
  return (
    new RegExp(String.raw`^\s*targets?:[^\n]*\b${literal}\b`, 'm').test(workflow) ||
    new RegExp(String.raw`rustup\s+target\s+add[^\n]*\b${literal}\b`).test(workflow)
  );
}

/** Every way this workflow could sign, or fail to run, on somebody else's machine. */
export function signingGateOffences(workflow: string): Offence[] {
  const text = readableYaml(workflow);
  const offences: Offence[] = [];

  for (const step of stepsOf(text)) {
    if (!NAMES_AN_APPLE_SECRET.test(step.text)) continue;
    if (WRITES_THE_GATE.test(step.text)) continue;
    if (GATE_CONDITION.test(conditionsOf(step.text))) continue;

    offences.push({
      where: `line ${step.line} — ${step.name}`,
      found: appleSecretsIn(step.text).join(', '),
      why:
        'this step receives Apple signing secrets without being gated on a classifier output ' +
        "equal to 'yes'. An unset secret arrives as an EMPTY STRING, so a blank certificate " +
        'reaches `security import` and the build dies there — which is exactly how light-v0.1.0 ' +
        'failed. Gate it on a step that has checked all five, or do not pass them.',
    });
  }

  for (const match of text.matchAll(SINGLE_ARCH_BUNDLE)) {
    offences.push({
      where: match[0],
      found: match[1] ?? '',
      why:
        'a single-architecture macOS bundle. Anyone on the other architecture downloads an ' +
        'installer that will not run, and it fails on THEIR machine rather than in CI. Bundle ' +
        '`--target universal-apple-darwin` instead.',
    });
  }

  if (UNIVERSAL_BUNDLE.test(text)) {
    for (const slice of MAC_SLICES) {
      if (installsSlice(text, slice)) continue;
      offences.push({
        where: 'the macOS toolchain targets',
        found: `${slice} is never installed`,
        why:
          '`universal-apple-darwin` is not a rustup target — it is a Tauri pseudo-target that ' +
          `lipos the two real slices together. Without ${slice} installed the universal build ` +
          'cannot link.',
      });
    }
  }

  return offences;
}

function explain(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.where}  [${o.found}]\n    -> ${o.why}`).join('\n');
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the macOS leg is switched on', () => {
  // Asserted FIRST. Everything below adjudicates a macOS build, so if there is
  // no macOS build the whole file would pass by having nothing to say. This is
  // the leg that refuses to let that happen quietly.
  const live = readableYaml(WORKFLOW);

  it('is a real matrix entry, not commentary', () => {
    expect(
      live,
      'The macOS leg is gone from release.yml. If that was deliberate, this contract is what ' +
        'has to be removed with it — do not leave it adjudicating a workflow that no longer ' +
        'builds for a Mac.',
    ).toMatch(/platform:\s*macos-/);
  });

  it('bundles through tauri-action, with steps to adjudicate', () => {
    expect(live).toContain('tauri-apps/tauri-action');
    expect(stepsOf(live).length).toBeGreaterThan(5);
  });

  it('checks all five Apple secrets by name', () => {
    for (const secret of APPLE_SECRETS) {
      expect(live, `${secret} is never checked`).toContain(secret);
    }
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('no step reaches Apple signing with an unchecked secret', () => {
  it('release.yml is clean', () => {
    const offences = signingGateOffences(WORKFLOW);
    expect(offences, `\n${explain(offences)}\n`).toEqual([]);
  });
});

// ── Proof the detector can actually fail ────────────────────────────────────

describe('the detector can actually fail', () => {
  const caught: ReadonlyArray<readonly [string, string]> = [
    [
      'the light-v0.1.0 trap, transcribed: secrets on an ungated build step',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        env:',
        '          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
        '          APPLE_ID: ${{ secrets.APPLE_ID }}',
      ].join('\n'),
    ],
    [
      'a step gated on the platform rather than on the secrets',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        "        if: runner.os == 'macOS'",
        '        env:',
        '          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
      ].join('\n'),
    ],
    [
      "the middle state let through by != 'no'",
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        "        if: steps.apple.outputs.signing != 'no'",
        '        env:',
        '          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
      ].join('\n'),
    ],
    [
      'an Apple-Silicon-only bundle, which does not run on an Intel Mac',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        "        args: '--target aarch64-apple-darwin'",
      ].join('\n'),
    ],
    [
      'an Intel-only bundle, the same defect the other way round',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        "        args: '--target x86_64-apple-darwin'",
      ].join('\n'),
    ],
    [
      'a universal bundle missing a slice it has to be lipoed from',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: dtolnay/rust-toolchain@stable',
        '        with:',
        '          targets: aarch64-apple-darwin',
        '      - uses: tauri-apps/tauri-action@v0',
        "        args: '--target universal-apple-darwin'",
      ].join('\n'),
    ],
  ];

  it.each(caught)('catches %s', (_name, workflow) => {
    expect(signingGateOffences(workflow)).not.toEqual([]);
  });

  it('names the secrets and the reason', () => {
    const [offence, ...rest] = signingGateOffences(
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - name: Bundle',
        '        env:',
        '          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}',
      ].join('\n'),
    );
    expect(rest).toEqual([]);
    expect(offence?.found).toBe('APPLE_TEAM_ID');
    expect(offence?.where).toContain('Bundle');
    expect(offence?.why).toContain('EMPTY STRING');
  });
});

// ── Proof it does not fire on the correct shape ──────────────────────────────

describe('a correctly gated workflow walks through', () => {
  const honest: ReadonlyArray<readonly [string, string]> = [
    [
      'the classifier itself, which must read the secrets to check them',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - name: Classify the Apple signing secrets',
        '        id: apple',
        '        env:',
        '          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
        '        run: |',
        '          echo "signing=yes" >> "$GITHUB_OUTPUT"',
      ].join('\n'),
    ],
    [
      'a build step gated on all five having been checked',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        "        if: runner.os != 'macOS' || steps.apple.outputs.signing == 'yes'",
        '        env:',
        '          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
      ].join('\n'),
    ],
    [
      'a universal bundle with both slices installed',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: dtolnay/rust-toolchain@stable',
        '        with:',
        '          targets: aarch64-apple-darwin,x86_64-apple-darwin',
        '      - uses: tauri-apps/tauri-action@v0',
        "        args: '--target universal-apple-darwin'",
      ].join('\n'),
    ],
    [
      'both slices installed the other way, with rustup',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - name: Add the slices',
        '        run: |',
        '          rustup target add aarch64-apple-darwin',
        '          rustup target add x86_64-apple-darwin',
        '      - uses: tauri-apps/tauri-action@v0',
        "        args: '--target universal-apple-darwin'",
      ].join('\n'),
    ],
    [
      'a Windows-only workflow, which has no Apple secrets at all',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        env:',
        '          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
      ].join('\n'),
    ],
    [
      'a comment naming a secret, which reaches no runner',
      [
        'jobs:',
        '  bundle:',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        # env: APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}',
      ].join('\n'),
    ],
  ];

  it.each(honest)('does not fire on %s', (_name, workflow) => {
    const offences = signingGateOffences(workflow);
    expect(offences, explain(offences)).toEqual([]);
  });

  it('boundary: an empty workflow has nothing to say', () => {
    expect(signingGateOffences('')).toEqual([]);
    expect(stepsOf('')).toEqual([]);
  });

  it('boundary: the toolchain target line is not itself a bundle target', () => {
    // `targets: aarch64-apple-darwin,x86_64-apple-darwin` INSTALLS both slices.
    // Only a `--target` handed to the bundler chooses what ships, and confusing
    // the two would make the correct configuration unrepresentable.
    const workflow = [
      'jobs:',
      '  bundle:',
      '    steps:',
      '      - uses: dtolnay/rust-toolchain@stable',
      '        with:',
      '          targets: aarch64-apple-darwin,x86_64-apple-darwin',
    ].join('\n');
    expect(signingGateOffences(workflow)).toEqual([]);
  });
});
