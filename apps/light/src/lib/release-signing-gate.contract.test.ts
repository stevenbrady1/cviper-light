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
 * A release has exactly TWO entry points, neither of them invents a tag, and the
 * tag it is given has to agree with the version it ships.
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
 * A run number is not a version. Neither is a run id, a run attempt or a commit
 * sha. They go up when a workflow is re-run, they are shared by every trigger of
 * the file, and they have no relationship whatsoever to what is in
 * `tauri.conf.json`. Any expression that can produce a tag out of one is a tag
 * nobody chose.
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
 * two things it could have meant instead — and that job must fail for real.
 * `continue-on-error: true` on it, or an `exit 1` parked under a step condition
 * that is never true, restores the original defect while leaving this file
 * green.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Six shapes are forbidden, and none of them is "the workflow must contain the
 * blessed line":
 *
 *   1. Any expression that manufactures a `light-v` tag — `format(...)`, an
 *      interpolated `light-v${{ … }}`, or a `tagName:`/`TAG:` built out of a
 *      run number, run id, run attempt or commit sha.
 *   2. A BUNDLING JOB — any job that invokes `tauri-apps/tauri-action`, found by
 *      its `uses:` and never by its name — reachable by anything but a PUSHED
 *      TAG. The condition is read as a CONJUNCTION: it is split on `&&` and both
 *      halves must be present as whole conjuncts, so `'push' || 'tag'` and
 *      `!(push && tag)` are offences rather than substring matches.
 *   3. A bundling job that never compares the tag it was handed against the
 *      version in `tauri.conf.json`. Removing the invented tag stops the two
 *      disagreeing BY ACCIDENT; only this step stops them disagreeing because
 *      somebody pushed the wrong tag.
 *   4. A `workflow_dispatch` trigger whose bare form (no `promote_tag`) reaches
 *      no failing job.
 *   5. A refusal job that cannot actually fail: `continue-on-error` anywhere in
 *      it, or no `exit 1` that is reachable unconditionally.
 *   6. A job condition written as a folded or literal block scalar, which this
 *      reader cannot follow. That is reported AS ITSELF — "write it on one
 *      line" — and never as "the job is ungated", so the guard does not accuse
 *      a correct workflow of a defect it does not have.
 *
 * ============================================================================
 * WHAT COUNTS AS TEXT, AND THE LIMITATION THAT BUYS
 * ============================================================================
 * `#` comments are stripped first, for the reason the top of this file gives:
 * a guard that fires on the prose explaining the fix is a guard somebody
 * deletes. The cost is that a commented-out job is invisible — which is why the
 * premise below asserts that a `bundle` job, a `promote-manifest` job and at
 * least one job carrying `tauri-action` were actually PARSED before any of this
 * adjudicates anything. Without that, a rename or a reindent would empty the
 * job list and every rule here would pass by having nothing to look at.
 */

/** Both spellings GitHub accepts for a dispatch input, as a regex fragment. */
const PROMOTE_TAG_SOURCE = String.raw`(?:inputs|github\.event\.inputs)\.promote_tag`;

/** The contexts the gate rules read, as regex fragments. */
const EVENT_NAME_SOURCE = String.raw`github\.event_name`;
const REF_TYPE_SOURCE = String.raw`github\.ref_type`;

/** The action that turns source into an installer. A bundling job is one that uses it. */
const BUNDLES = /uses:\s*tauri-apps\/tauri-action/;

/** Ways a `light-v` tag gets manufactured rather than pushed. */
const MANUFACTURED_TAG: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  {
    pattern: /format\(\s*'light-v[^\n]*/g,
    why:
      'this expression builds a `light-v` tag out of something that is not the tag somebody ' +
      'pushed. A release is named by a human pushing a tag; a fallback that fills one in ' +
      'produces a draft whose tag and whose `latest.json` version disagree, and nothing ' +
      'downstream compares the two.',
  },
  {
    pattern: /light-v\$\{\{[^\n}]*\}\}/g,
    why:
      'a `light-v` tag pasted together from an expression. `format(...)` is not the only way ' +
      'to spell that mistake — this is the same defect written with string interpolation, and ' +
      'a forbid-list that only knew the first spelling would have missed it.',
  },
];

/** A counter, an id or a hash. None of them is a version. */
const NOT_A_VERSION = /github\.(?:run_number|run_id|run_attempt|sha)/;

/** Every place a tag is named: the bundler's input, or an env var the shell uses. */
const TAG_ASSIGNMENTS = /^[^\n]*\b(?:tagName|TAG):[^\n]*$/gm;

/** The dispatch trigger this file has to protect. Absent it, rule 4 is moot. */
const HAS_DISPATCH_TRIGGER = /^\s*workflow_dispatch:/m;

/** A job that fails on purpose rather than skipping into a green tick. */
const FAILS_ON_PURPOSE = /\bexit\s+1\b/;

/** A job or step that is allowed to fail is a job or step that cannot gate anything. */
const SWALLOWS_FAILURE = /continue-on-error/;

/** The two halves of the comparison rule 3 demands, as it must be written to work. */
const READS_THE_PUSHED_TAG = /GITHUB_REF_NAME|github\.ref_name/;
const READS_THE_SHIPPED_VERSION = /tauri\.conf\.json/;

/** A block scalar this lexical reader cannot follow. */
const BLOCK_SCALAR = /^[>|][-+]?\d*$/;

interface Job {
  readonly name: string;
  readonly text: string;
}

/** A job's own `if:`, and whether it was written in a form that can be read. */
export interface JobCondition {
  /** The condition on one line. `''` when absent, or when it is a block scalar. */
  readonly text: string;
  /** It was written as `>`/`|`, so its real value lives on the lines below. */
  readonly folded: boolean;
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
export function jobConditionOf(jobText: string): JobCondition {
  const [, ...body] = jobText.split('\n');
  const firstKey = body.find((line) => line.trim() !== '');
  if (firstKey === undefined) return { text: '', folded: false };

  const keyIndent = firstKey.length - firstKey.trimStart().length;
  const jobLevelIf = new RegExp(String.raw`^\s{${keyIndent}}if:\s*(.*)$`);

  const written = body
    .map((line) => jobLevelIf.exec(line)?.[1]?.trim() ?? '')
    .filter((condition) => condition !== '');

  if (written.some((condition) => BLOCK_SCALAR.test(condition))) {
    return { text: '', folded: true };
  }
  return { text: written.join(' '), folded: false };
}

/** Whitespace collapsed, so indentation cannot make two identical conditions differ. */
function flatten(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** The `&&`-separated halves of a condition. A conjunction, read as one. */
export function conjunctsOf(condition: string): string[] {
  return condition
    .split('&&')
    .map(flatten)
    .filter((part) => part !== '');
}

/**
 * Is `<context> == '<literal>'` one of these conjuncts, written either way round?
 *
 * ANCHORED on purpose. A substring test would accept the conjunct
 * `!(github.event_name == 'push'`, and accepting that is how a wholesale
 * negation of the whole gate would have scored clean.
 */
function hasConjunct(
  conjuncts: readonly string[],
  contextSource: string,
  literal: string,
): boolean {
  const value = escapeForRegExp(literal);
  const forwards = new RegExp(String.raw`^${contextSource}\s*==\s*'${value}'$`);
  const backwards = new RegExp(String.raw`^'${value}'\s*==\s*${contextSource}$`);
  return conjuncts.some((part) => forwards.test(part) || backwards.test(part));
}

/** The condition that says "a dispatch with the box left empty", however spelled. */
function refusesTheBareDispatch(condition: JobCondition): boolean {
  const conjuncts = conjunctsOf(condition.text);
  return (
    hasConjunct(conjuncts, EVENT_NAME_SOURCE, 'workflow_dispatch') &&
    hasConjunct(conjuncts, PROMOTE_TAG_SOURCE, '')
  );
}

/** The steps of one job, with their own `if:` — including one written on the dash line. */
function stepConditionsOf(step: string): string {
  return step
    .split('\n')
    .filter((line) => /^\s*-?\s*if:/.test(line))
    .join(' ');
}

/** Every way this workflow could release something nobody asked for. */
export function releaseEntryPointOffences(workflow: string): Offence[] {
  const text = readableYaml(workflow);
  const offences: Offence[] = [];
  const jobs = jobsOf(text);

  // ── 1. No code path may manufacture a tag. ────────────────────────────────
  for (const spelling of MANUFACTURED_TAG) {
    for (const match of text.matchAll(spelling.pattern)) {
      offences.push({
        where: 'a manufactured tag',
        found: (match[0] ?? '').trim(),
        why: spelling.why,
      });
    }
  }

  for (const line of text.match(TAG_ASSIGNMENTS) ?? []) {
    if (!NOT_A_VERSION.test(line)) continue;
    offences.push({
      where: 'a tag named after a counter',
      found: flatten(line),
      why:
        'a run number, run id, run attempt and commit sha are all things that change without ' +
        'anybody deciding to release. They go up on a re-run, they are shared by every trigger ' +
        'of this workflow, and none of them has any relationship to the version in ' +
        'tauri.conf.json. A release named after one is a release named by an accident.',
    });
  }

  // ── 2, 3 and 6. Every job that BUNDLES, found by its action, not its name. ─
  const bundlers = jobs.filter((job) => BUNDLES.test(job.text));

  for (const job of bundlers) {
    const condition = jobConditionOf(job.text);

    if (condition.folded) {
      offences.push({
        where: `the "${job.name}" job`,
        found: 'its `if:` is a folded or literal block scalar',
        why:
          'write the job condition on one line so the guard can read it. This is NOT a claim ' +
          'that the job is ungated — it may well be correct — it is that a lexical reader ' +
          'cannot follow a condition whose value lives on the lines below the key, and a guard ' +
          'that guesses in either direction is worse than one that says it cannot tell.',
      });
    } else {
      const conjuncts = conjunctsOf(condition.text);
      const shown = condition.text === '' ? 'it has no job-level `if:` at all' : condition.text;

      if (condition.text.includes('||')) {
        offences.push({
          where: `the "${job.name}" job`,
          found: shown,
          why:
            'an `||` in the gate means EITHER half is enough to get in, so the job runs in ' +
            'cases neither half was meant to admit. The gate has to be a conjunction: a pushed ' +
            'ref, AND that ref being a tag.',
        });
      }

      if (/(^|\s|\()!/.test(condition.text)) {
        offences.push({
          where: `the "${job.name}" job`,
          found: shown,
          why:
            'a negation in the gate. `!(a && b)` contains both halves as text while meaning ' +
            'the opposite of them, which is exactly the shape a substring check would wave ' +
            'through. State the condition affirmatively.',
        });
      }

      if (!hasConjunct(conjuncts, EVENT_NAME_SOURCE, 'push')) {
        offences.push({
          where: `the "${job.name}" job`,
          found: shown,
          why:
            "it does not require `github.event_name == 'push'` as a conjunct. A " +
            'workflow_dispatch can be aimed at a tag ref from the Actions UI, so a run-by-hand ' +
            'still reaches the bundler. Dispatching this workflow means "promote a manifest" ' +
            'and never "build me a release".',
        });
      }

      if (!hasConjunct(conjuncts, REF_TYPE_SOURCE, 'tag')) {
        offences.push({
          where: `the "${job.name}" job`,
          found: shown,
          why:
            "it does not require `github.ref_type == 'tag'` as a conjunct, so the job can run " +
            'with no tag to name the release after — which is the state that produced the ' +
            'invented `light-v<run_number>` draft in the first place.',
        });
      }
    }

    const compares = stepsOf(job.text).some(
      (step) =>
        READS_THE_PUSHED_TAG.test(step.text) &&
        READS_THE_SHIPPED_VERSION.test(step.text) &&
        FAILS_ON_PURPOSE.test(step.text),
    );

    if (!compares) {
      offences.push({
        where: `the "${job.name}" job`,
        found: 'nothing in it compares the tag against tauri.conf.json',
        why:
          'removing the invented tag stops the tag and the version disagreeing BY ACCIDENT. It ' +
          'does nothing about somebody pushing light-v0.2.0 at a tree whose tauri.conf.json ' +
          'still says 0.1.0 — which produces exactly the artefact this work item is about, and ' +
          'is discovered by a user whose updater offers a version that does not exist. Add a ' +
          'step that reads both and exits 1 when they differ.',
      });
    }
  }

  // ── 4 and 5. A bare dispatch has to reach a job that really fails. ────────
  if (HAS_DISPATCH_TRIGGER.test(text)) {
    const unreadable = jobs.some((job) => jobConditionOf(job.text).folded);
    const refusal = jobs.find((job) => refusesTheBareDispatch(jobConditionOf(job.text)));

    if (refusal === undefined) {
      if (!unreadable) {
        offences.push({
          where: 'the workflow_dispatch trigger',
          found: 'no job runs when promote_tag is empty',
          why:
            'a dispatch with an empty `promote_tag` has nothing to do, and a run in which ' +
            'every job skips REPORTS SUCCESS. A green tick on a workflow called Release reads ' +
            'as "the release went out". Add a job gated on ' +
            "`github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''` that fails " +
            'and says what the two real entry points are.',
        });
      }
    } else {
      if (SWALLOWS_FAILURE.test(refusal.text)) {
        offences.push({
          where: `the "${refusal.name}" job`,
          found: 'continue-on-error is set inside the job that is meant to refuse',
          why:
            '`continue-on-error` turns a failure into a green tick. On the one job whose entire ' +
            'purpose is to go red, it restores the defect exactly: the run succeeds, nothing ' +
            'was built, and the two states look identical from the Actions list.',
        });
      }

      const reachableFailure = stepsOf(refusal.text).some(
        (step) => FAILS_ON_PURPOSE.test(step.text) && stepConditionsOf(step.text) === '',
      );

      if (!reachableFailure) {
        offences.push({
          where: `the "${refusal.name}" job`,
          found: 'no step fails unconditionally',
          why:
            'this is the job that refuses a bare dispatch, and every `exit 1` in it sits behind ' +
            'a step condition — or there is none at all. A refusal that can be skipped is a ' +
            'refusal that passes, which is indistinguishable from a release that worked: the ' +
            'same shape as a health check that swallows its own error and prints "OK".',
        });
      }
    }
  }

  return offences;
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: the entry-point rules have a workflow to read', () => {
  // Asserted FIRST, and this is the anti-inert half of the contract. Every rule
  // below either scans text or selects jobs, so a reader that quietly returned
  // nothing would make the whole section pass by having nothing to adjudicate.
  const live = readableYaml(WORKFLOW);
  const parsed = jobsOf(live);
  const names = parsed.map((job) => job.name);

  it('parses a bundle job and a promote-manifest job', () => {
    expect(
      names,
      'No `bundle` job was PARSED out of release.yml. An empty job list makes every rule below ' +
        'pass silently. If the job was renamed, rename it here in the same commit.',
    ).toContain('bundle');
    expect(
      names,
      'No `promote-manifest` job was parsed out of release.yml. Promotion is the second of the ' +
        'two entry points this contract exists to keep separate.',
    ).toContain('promote-manifest');
  });

  it('finds at least one job that actually bundles', () => {
    // The gate and comparison rules are applied to jobs SELECTED by this test's
    // criterion. If the selector matches nothing — the action was renamed, the
    // `uses:` reindented — those rules adjudicate an empty list and this whole
    // section reports clean over a workflow nobody checked.
    const bundlers = parsed.filter((job) => BUNDLES.test(job.text));
    expect(
      bundlers.map((job) => job.name),
      'No job in release.yml invokes `tauri-apps/tauri-action`, so the gate rules and the ' +
        'tag-versus-version rule have nothing to adjudicate. If the bundler changed, change ' +
        'the selector here in the same commit.',
    ).not.toEqual([]);
  });

  it('reads a real job-level condition, not an empty string', () => {
    const bundle = parsed.find((job) => job.name === 'bundle');
    expect(jobConditionOf(bundle?.text ?? '').text).not.toBe('');
  });

  it('still offers the workflow_dispatch that rules 4 and 5 protect', () => {
    expect(
      live,
      'release.yml no longer accepts a dispatch. If the promote path moved, the refusal rules ' +
        'below have nothing to protect and should move with it.',
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

/** A bundling job's tag-versus-version step, so fixtures about other rules are clean. */
const COMPARISON_STEP = [
  '      - name: The tag and the version must agree',
  '        run: |',
  '          test "${GITHUB_REF_NAME#light-v}" = "$(jq -r .version apps/light/src-tauri/tauri.conf.json)" || exit 1',
];

/** A refusal job that really refuses, so fixtures about other rules are clean. */
const REFUSAL_JOB = [
  '  refuse-a-bare-dispatch:',
  "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
  '    steps:',
  '      - run: exit 1',
];

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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        "          tagName: ${{ github.ref_type == 'tag' && github.ref_name || format('light-v{0}', github.run_number) }}",
        ...REFUSAL_JOB,
      ].join('\n'),
    ],
    [
      'the same defect spelled with interpolation instead of format()',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    env:',
        '      TAG: light-v${{ github.run_number }}',
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
      ].join('\n'),
    ],
    [
      'a tag named after the commit sha',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        '          tagName: ${{ github.sha }}',
      ].join('\n'),
    ],
    [
      'a gate whose halves are alternatives rather than a conjunction',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' || github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
      ].join('\n'),
    ],
    [
      'a gate negated wholesale, which contains both halves as text',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: ${{ !(github.event_name == 'push' && github.ref_type == 'tag') }}",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
      ].join('\n'),
    ],
    [
      'a SECOND bundling job, ungated, that the old rule never looked at',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  bundle-linux:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
      ].join('\n'),
    ],
    [
      'a bundling job that never checks the tag against the version it ships',
      [
        'on:',
        '  push:',
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
      'the silent-skip trap: a bare dispatch that reaches no job at all',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - run: echo "There was nothing to do here."',
      ].join('\n'),
    ],
    [
      'a refusal job allowed to fail, which is a refusal that passes',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    continue-on-error: true',
        '    steps:',
        '      - run: exit 1',
      ].join('\n'),
    ],
    [
      'a refusal whose only exit 1 sits behind a step condition that never fires',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event_name == 'workflow_dispatch' && inputs.promote_tag == ''",
        '    steps:',
        '      - if: false',
        '        run: exit 1',
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '        with:',
        "          tagName: ${{ format('light-v{0}', github.run_number) }}",
      ].join('\n'),
    );
    expect(offences.map((offence) => offence.where)).toEqual([
      'a manufactured tag',
      'a tag named after a counter',
    ]);
    expect(offences[1]?.found).toContain('run_number');
    expect(offences[1]?.why).toContain('accident');
  });

  it('reports an unreadable condition as unreadable, not as ungated', () => {
    // W2. A folded scalar may well be a CORRECT gate — this reader simply
    // cannot follow it. Accusing it of being ungated is a false red, and a
    // false red is how a guard gets deleted rather than fixed.
    const offences = releaseEntryPointOffences(
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        '    if: >-',
        "      github.event_name == 'push'",
        "      && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
      ].join('\n'),
    );
    expect(offences.length).toBe(1);
    expect(offences[0]?.found).toContain('block scalar');
    expect(offences[0]?.why).toContain('one line');
    expect(explain(offences)).not.toContain('no job-level');
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
        ...COMPARISON_STEP,
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
      'the other spelling of a dispatch input, and the operands the other way round',
      [
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  bundle:',
        "    if: 'push' == github.event_name && 'tag' == github.ref_type",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  refuse-a-bare-dispatch:',
        "    if: github.event.inputs.promote_tag == '' && 'workflow_dispatch' == github.event_name",
        '    steps:',
        '      - run: exit 1',
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
        ...COMPARISON_STEP,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        ...REFUSAL_JOB,
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
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '      - uses: actions/upload-artifact@v4',
        '        with:',
        '          name: logs-${{ github.run_number }}',
      ].join('\n'),
    ],
    [
      'a non-bundling job with no condition, which ships nothing',
      [
        'on:',
        '  push:',
        'jobs:',
        '  bundle:',
        "    if: github.event_name == 'push' && github.ref_type == 'tag'",
        '    steps:',
        ...COMPARISON_STEP,
        '      - uses: tauri-apps/tauri-action@v0',
        '  announce:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "a release happened"',
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
    expect(jobConditionOf('')).toEqual({ text: '', folded: false });
    expect(conjunctsOf('')).toEqual([]);
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
    expect(jobConditionOf(job?.text ?? '').text).toBe('');
    expect(releaseEntryPointOffences(stepLevelOnly)).not.toEqual([]);
  });

  it('boundary: a conjunction is read as conjuncts, not as a substring', () => {
    // The C1 defect in miniature. `||` and `&&` produce the same substrings.
    expect(conjunctsOf("github.event_name == 'push' && github.ref_type == 'tag'")).toEqual([
      "github.event_name == 'push'",
      "github.ref_type == 'tag'",
    ]);
    expect(conjunctsOf("github.event_name == 'push' || github.ref_type == 'tag'")).toEqual([
      "github.event_name == 'push' || github.ref_type == 'tag'",
    ]);
  });
});
