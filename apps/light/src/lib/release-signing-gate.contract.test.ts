/**
 * The macOS release-signing contract (L-95): no step in `release.yml` may reach
 * Apple's signing tools carrying secrets nobody has checked.
 *
 * A second contract lives at the bottom of this file, over the same workflow:
 * the ENTRY-POINT contract (L-118), which forbids a release that nobody asked
 * for and a tag nobody pushed. Both are here because they adjudicate one file
 * and share its lexical reader; each has its own premise, detector and proofs.
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

// ════════════════════════════════════════════════════════════════════════════
// THE ENTRY-POINT CONTRACT (L-118)
// ════════════════════════════════════════════════════════════════════════════
/**
 * A release has exactly TWO entry points, and neither of them invents a tag.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `tagName` used to read
 *
 *   ${{ github.ref_type == 'tag' && github.ref_name
 *       || format('light-v{0}', github.run_number) }}
 *
 * and the `bundle` job ran on any dispatch that was not a promotion. So running
 * the workflow by hand out of curiosity — no tag pushed, `promote_tag` left
 * empty — built installers and created a draft release tagged `light-v2`,
 * because two was the run number. The `latest.json` inside it said `0.1.0`. The
 * tag and the version disagreed, and nothing in the run objected: a green tick
 * over a release named after a counter.
 *
 * A run number is not a version. It goes up when a workflow is re-run, it is
 * shared by every trigger of the file, and it has no relationship whatsoever to
 * what is in `tauri.conf.json`. Any expression that can produce a tag out of
 * one is a tag nobody chose.
 *
 * ============================================================================
 * THE SECOND HALF: SKIPPING QUIETLY IS ALSO THE DEFECT
 * ============================================================================
 * Deleting the fallback leaves a bare dispatch with nothing to do, and "nothing
 * to do" must not become "every job skipped, run succeeded". A run where all
 * jobs skip is a GREEN TICK, and a green tick on a workflow called Release is
 * read by a person at eleven at night as "the release went out".
 *
 * That is the benign-alarm shape this repository has been bitten by before: a
 * check whose failure looks exactly like its success. So a dispatch with an
 * empty `promote_tag` has to reach a job that FAILS, in a sentence, naming the
 * two things it could have meant instead.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Four shapes are forbidden, and none of them is "the workflow must contain the
 * blessed line":
 *
 *   1. Any expression that manufactures a `light-v` tag.
 *   2. Any `tagName:` derived from `github.run_number`.
 *   3. A `bundle` job reachable by anything but a PUSHED TAG. The condition is
 *      read as a condition, not grepped for: both halves have to be in it, so a
 *      job gated on the event alone, or on the ref type alone, is still an
 *      offence.
 *   4. A `workflow_dispatch` trigger whose bare form (no `promote_tag`) reaches
 *      no failing job — either because no job covers that case, or because the
 *      job that covers it only prints and exits 0.
 *
 * ============================================================================
 * WHAT COUNTS AS TEXT, AND THE LIMITATION THAT BUYS
 * ============================================================================
 * `#` comments are stripped first, for the reason the top of this file gives:
 * a guard that fires on the prose explaining the fix is a guard somebody
 * deletes. The cost is that a commented-out job is invisible — which is why the
 * premise below asserts that a `bundle` job and a `promote-manifest` job were
 * actually PARSED before any of this adjudicates anything. Without that, a
 * rename or a reindent would empty the job list and every rule here would pass
 * by having nothing to look at.
 *
 * A condition written as a folded scalar (`if: >`) spreads over several lines
 * and would not be read. It fails CLOSED — reported as ungated — which is the
 * safe direction.
 */

/** A tag conjured out of something that is not the tag somebody pushed. */
const INVENTS_A_TAG = /format\(\s*'light-v[^\n]*/g;

/** Every `tagName:` the workflow sets, one per line. */
const TAG_NAME_LINES = /^[^\n]*\btagName:[^\n]*$/gm;

/** A counter that goes up on a re-run. Never a version, never a tag. */
const RUN_NUMBER = /github\.run_number/;

/** The dispatch trigger this file has to protect. Absent it, rule 4 is moot. */
const HAS_DISPATCH_TRIGGER = /^\s*workflow_dispatch:/m;

/** The bare dispatch: run by hand, with nothing filled in. */
const BARE_DISPATCH =
  /github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*inputs\.promote_tag\s*==\s*''/;

/** A job that fails on purpose rather than skipping into a green tick. */
const FAILS_ON_PURPOSE = /\bexit\s+1\b/;

/**
 * Both halves of "a pushed tag, and nothing else".
 *
 * They are separate entries so a job that has one and not the other reports the
 * half it is missing. `ref_type == 'tag'` alone is not enough: a dispatch can be
 * aimed at a tag ref from the Actions UI, and would sail through it.
 */
const BUNDLE_IS_A_TAG_PUSH: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  {
    pattern: /github\.event_name\s*==\s*'push'/,
    why:
      "it does not require `github.event_name == 'push'`. A workflow_dispatch can be aimed at " +
      'a tag ref from the Actions UI, so a run-by-hand still reaches the bundler. Dispatching ' +
      'this workflow means "promote a manifest" and never "build me a release".',
  },
  {
    pattern: /github\.ref_type\s*==\s*'tag'/,
    why:
      "it does not require `github.ref_type == 'tag'`, so the job can run with no tag to name " +
      'the release after — which is the state that produced the invented `light-v<run_number>` ' +
      'draft in the first place.',
  },
];

interface Job {
  readonly name: string;
  readonly text: string;
}

/**
 * The jobs of a workflow, as blocks of text.
 *
 * Deliberately lexical — no YAML parser, matching `stepsOf` above and the house
 * style of the other repository guards. A private copy rather than an import:
 * importing one TEST module from another re-registers its whole suite under the
 * wrong name (see the docblock in `repo-scan.ts`).
 */
export function jobsOf(workflow: string): Job[] {
  const jobs: Array<{ name: string; text: string[] }> = [];

  let seenJobs = false;
  let indent = -1;
  let current: { name: string; text: string[] } | null = null;

  const flush = (): void => {
    if (current !== null) jobs.push(current);
    current = null;
  };

  for (const line of workflow.split('\n')) {
    if (!seenJobs) {
      if (/^jobs:\s*$/.test(line)) seenJobs = true;
      continue;
    }
    if (line.trim() === '') {
      current?.text.push(line);
      continue;
    }

    const depth = line.length - line.trimStart().length;
    const header = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);

    if (header && (indent === -1 || depth === indent)) {
      indent = (header[1] ?? '').length;
      flush();
      current = { name: header[2] ?? '', text: [line] };
      continue;
    }

    if (indent !== -1 && depth <= indent && !header) {
      flush();
      break;
    }

    current?.text.push(line);
  }

  flush();
  return jobs.map((job) => ({ name: job.name, text: job.text.join('\n') }));
}

/**
 * A job's OWN `if:`, not its steps'.
 *
 * The job's keys all sit at one indentation, taken from its first line; an
 * `if:` at any deeper level belongs to a step and says nothing about whether
 * the job runs. An absent condition yields `''`, which no rule can satisfy —
 * the safe direction.
 */
export function jobConditionOf(jobText: string): string {
  const [, ...body] = jobText.split('\n');
  const firstKey = body.find((line) => line.trim() !== '');
  if (firstKey === undefined) return '';

  const keyIndent = firstKey.length - firstKey.trimStart().length;
  const jobLevelIf = new RegExp(String.raw`^\s{${keyIndent}}if:\s*(.*)$`);

  return body
    .map((line) => jobLevelIf.exec(line)?.[1]?.trim() ?? '')
    .filter((condition) => condition !== '')
    .join(' ');
}

/** Every way this workflow could release something nobody asked for. */
export function releaseEntryPointOffences(workflow: string): Offence[] {
  const text = readableYaml(workflow);
  const offences: Offence[] = [];
  const jobs = jobsOf(text);

  for (const match of text.matchAll(INVENTS_A_TAG)) {
    offences.push({
      where: 'a manufactured tag',
      found: (match[0] ?? '').trim(),
      why:
        'this expression builds a `light-v` tag out of something that is not the tag somebody ' +
        'pushed. A release is named by a human pushing a tag; a fallback that fills one in ' +
        'produces a draft whose tag and whose `latest.json` version disagree, and nothing ' +
        'downstream compares the two.',
    });
  }

  for (const line of text.match(TAG_NAME_LINES) ?? []) {
    if (!RUN_NUMBER.test(line)) continue;
    offences.push({
      where: 'tagName',
      found: line.trim(),
      why:
        '`github.run_number` is a counter. It changes on a re-run, it is shared by every ' +
        'trigger of this workflow, and it has no relationship to the version in ' +
        'tauri.conf.json. A release tagged after it is a release named by an accident.',
    });
  }

  const bundle = jobs.find((job) => job.name === 'bundle');
  if (bundle !== undefined) {
    const condition = jobConditionOf(bundle.text);
    for (const required of BUNDLE_IS_A_TAG_PUSH) {
      if (required.pattern.test(condition)) continue;
      offences.push({
        where: 'the "bundle" job',
        found: condition === '' ? 'it has no job-level `if:` at all' : condition,
        why: required.why,
      });
    }
  }

  if (HAS_DISPATCH_TRIGGER.test(text)) {
    const refusal = jobs.find((job) => BARE_DISPATCH.test(jobConditionOf(job.text)));

    if (refusal === undefined) {
      offences.push({
        where: 'the workflow_dispatch trigger',
        found: 'no job runs when promote_tag is empty',
        why:
          'a dispatch with an empty `promote_tag` now has nothing to do, and a run in which ' +
          'every job skips REPORTS SUCCESS. A green tick on a workflow called Release reads as ' +
          '"the release went out". Add a job gated on ' +
          "`github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''` that fails " +
          'and says what the two real entry points are.',
      });
    } else if (!FAILS_ON_PURPOSE.test(refusal.text)) {
      offences.push({
        where: `the "${refusal.name}" job`,
        found: 'it covers the bare dispatch but never exits non-zero',
        why:
          'this is the job that is meant to refuse a bare dispatch, and it ends successfully. ' +
          'A refusal that passes is indistinguishable from a release that worked — the same ' +
          'shape as a health check that swallows its own error and prints "OK".',
      });
    }
  }

  return offences;
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: the entry-point rules have a workflow to read', () => {
  // Asserted FIRST, and this is the anti-inert half of the contract. Every rule
  // below either scans text or looks a job up by name, so a reader that quietly
  // returned nothing would make the whole section pass by having nothing to
  // adjudicate.
  const live = readableYaml(WORKFLOW);
  const names = jobsOf(live).map((job) => job.name);

  it('parses a bundle job and a promote-manifest job', () => {
    expect(
      names,
      'No `bundle` job was PARSED out of release.yml. The rules below look this job up by ' +
        'name, so an empty job list makes them all pass silently. If the job was renamed, ' +
        'rename it here in the same commit.',
    ).toContain('bundle');
    expect(
      names,
      'No `promote-manifest` job was parsed out of release.yml. Promotion is the second of the ' +
        'two entry points this contract exists to keep separate.',
    ).toContain('promote-manifest');
  });

  it('reads a real job-level condition, not an empty string', () => {
    const bundle = jobsOf(live).find((job) => job.name === 'bundle');
    expect(jobConditionOf(bundle?.text ?? '')).not.toBe('');
  });

  it('still offers the workflow_dispatch that rule 4 protects', () => {
    expect(
      live,
      'release.yml no longer accepts a dispatch. If the promote path moved, the refusal rule ' +
        'below has nothing to protect and should move with it.',
    ).toMatch(HAS_DISPATCH_TRIGGER);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('a release has two entry points and neither invents a tag', () => {
  it('release.yml is clean', () => {
    const offences = releaseEntryPointOffences(WORKFLOW);
    expect(offences, `\n${explain(offences)}\n`).toEqual([]);
  });
});

// ── Proof the detector can actually fail ────────────────────────────────────

describe('the entry-point detector can actually fail', () => {
  const caught: ReadonlyArray<readonly [string, string]> = [
    [
      'the L-118 trap, transcribed: a tag invented from the run number',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name != 'workflow_dispatch' || inputs.promote_tag == ''",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        "          tagName: ${{ github.ref_type == 'tag' && github.ref_name || format('light-v{0}', github.run_number) }}",
      ].join('\n'),
    ],
    [
      'a bundle job a dispatch can still reach',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: exit 1',
      ].join('\n'),
    ],
    [
      'a bundle job gated on the event but not on there being a tag',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: exit 1',
      ].join('\n'),
    ],
    [
      'a bundle job with no condition at all',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        '    runs-on: windows-latest',
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
      ].join('\n'),
    ],
    [
      'the silent-skip trap: a bare dispatch that reaches no job at all',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '  promote-manifest:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag != ''",
        '    steps:',
        '      - run: gh release upload updater promote/latest.json --clobber',
      ].join('\n'),
    ],
    [
      'the benign-alarm trap: a refusal job that only prints and succeeds',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: echo "There was nothing to do here."',
      ].join('\n'),
    ],
    [
      'a tag invented somewhere other than tagName',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    env:',
        "      TAG: ${{ format('light-v{0}', github.run_number) }}",
        '    steps:',
        '      - run: gh release create "$TAG"',
        '  refuse:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: exit 1',
      ].join('\n'),
    ],
  ];

  it.each(caught)('catches %s', (_name, workflow) => {
    expect(releaseEntryPointOffences(workflow)).not.toEqual([]);
  });

  it('names the run number and the reason', () => {
    const offences = releaseEntryPointOffences(
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        "          tagName: ${{ format('light-v{0}', github.run_number) }}",
      ].join('\n'),
    );
    expect(offences.map((offence) => offence.where)).toEqual(['a manufactured tag', 'tagName']);
    expect(offences[1]?.found).toContain('run_number');
    expect(offences[1]?.why).toContain('counter');
  });
});

// ── Proof it does not fire on the correct shape ──────────────────────────────

describe('the honest release flow walks through', () => {
  const honest: ReadonlyArray<readonly [string, string]> = [
    [
      'the two entry points, as release.yml now has them',
      [
        'on:',
        '  push:',
        '    tags:',
        "      - 'light-v*'",
        '  workflow_dispatch:',
        'jobs:',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: |',
        '          echo "Push a light-v* tag, or dispatch with promote_tag set."',
        '          exit 1',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        '          tagName: ${{ github.ref_name }}',
        '  promote-manifest:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag != ''",
        '    steps:',
        '      - run: gh release upload updater promote/latest.json --clobber',
      ].join('\n'),
    ],
    [
      'a tag-push-only workflow, which has no dispatch to refuse',
      [
        'on:',
        '  push:',
        '    tags:',
        "      - 'light-v*'",
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        '          tagName: ${{ github.ref_name }}',
      ].join('\n'),
    ],
    [
      'a comment describing the fallback that was removed',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        "    # was: format('light-v{0}', github.run_number), which invented a tag",
        '    steps:',
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: exit 1',
      ].join('\n'),
    ],
    [
      'the run number used for something that is not a tag',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        '      - uses: actions/upload-artifact@v4',
        '        with:',
        '          name: logs-${{ github.run_number }}',
      ].join('\n'),
    ],
  ];

  it.each(honest)('does not fire on %s', (_name, workflow) => {
    const offences = releaseEntryPointOffences(workflow);
    expect(offences, explain(offences)).toEqual([]);
  });

  it('boundary: an empty workflow has nothing to say', () => {
    expect(releaseEntryPointOffences('')).toEqual([]);
    expect(jobsOf('')).toEqual([]);
    expect(jobConditionOf('')).toBe('');
  });

  it("boundary: a step's own `if:` is not mistaken for the job's", () => {
    // The bundle job's real gate is the one at the job's indentation. A step
    // condition that happens to mention a tag must not excuse a job that has no
    // condition of its own.
    const stepLevelOnly = [
      'jobs:',
      '  bundle:',
      '    runs-on: windows-latest',
      '    steps:',
      "      - if: github.event_name == 'push' && github.ref_type == 'tag'",
      '        uses: tauri-apps/tauri-action@v0',
    ].join('\n');

    const [job] = jobsOf(stepLevelOnly);
    expect(jobConditionOf(job?.text ?? '')).toBe('');
    expect(releaseEntryPointOffences(stepLevelOnly)).not.toEqual([]);
  });
});
