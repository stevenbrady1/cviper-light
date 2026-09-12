/**
 * The verification-loop contract (L-98): `pnpm verify` must run everything the
 * CI `verify` job runs.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * CLAUDE.md documents a five-command loop — `tsc`, `lint`, `test`,
 * `cargo:check`, `cargo:test` — and the root `verify` script chained exactly
 * those five. The CI `verify` job ran them too, and then ran a SIXTH step,
 * `pnpm format:check`, that the local loop never mentioned.
 *
 * So the loop under-reported, and it did it silently. All five green locally,
 * push, and CI goes red on Prettier five minutes later. That is the worst shape
 * a check can have: it is not wrong, it is INCOMPLETE, and nothing about a
 * green local run says so. It cost a full build the day it was found.
 *
 * The fix — folding `format:check` into the script — lasts exactly until the
 * next step is added to the job. This is the part that does not rot: it reads
 * BOTH files and refuses to let them disagree.
 *
 * ============================================================================
 * WHAT IT ADJUDICATES
 * ============================================================================
 * Every command the `verify` job actually runs must be one of:
 *
 *   1. a root `package.json` script that `pnpm verify` also runs, or
 *   2. `pnpm verify` itself, or
 *   3. registered in `OUTSIDE_THE_LOOP` below, with a reason.
 *
 * Anything else is an offence. That third case is the whole point of the
 * design. The obvious guard — "collect the `pnpm <script>` calls on both sides
 * and diff them" — passes quietly the day CI gains a check written as
 * `npx some-tool` or `cargo audit`, because such a step contributes NOTHING to
 * either side of the diff. Requiring every command to be classified means a new
 * CI check is red until somebody either adds it to the loop or writes down why
 * it cannot be. It fails CLOSED.
 *
 * The same closed-ness applies to the script: a segment of `verify` that is not
 * a `pnpm <script>` call is an offence, because this guard cannot vouch for
 * coverage it cannot read.
 *
 * ============================================================================
 * WHAT IT DOES *NOT* COVER — read this before trusting it
 * ============================================================================
 *   * ONLY THE `verify` JOB, and only in `ci.yml`. The `secret-scan` job is out
 *     of scope on purpose: it wants the full history, a network and a pinned
 *     gitleaks binary, so it is not something `pnpm verify` could ever run.
 *     `release.yml`, `ios.yml` and `monorepo-split.yml` are likewise out of
 *     scope — a developer cannot reproduce a signed release locally, and
 *     CLAUDE.md forbids trying.
 *   * NAMES, NOT BEHAVIOUR. It proves `pnpm test` is invoked on both sides. It
 *     cannot prove the two invocations do the same work — a workflow-level
 *     `env:` or a different `--filter` would be invisible here.
 *   * NOT WHETHER THE CHECKS PASS. That is what running them is for.
 *   * NOT ORDER. CI runs its steps separately so a failure names itself; the
 *     script chains them with `&&` so the first failure stops the rest. Both
 *     are deliberate and neither is asserted.
 *   * NOT `uses:` STEPS. A check hidden inside a composite action is invisible:
 *     only `run:` commands are read. A new check arriving that way would pass.
 *   * COMMENTS ARE STRIPPED, for the reason `repo-scan.ts` gives — a guard that
 *     fires on the prose explaining the fix is a guard somebody deletes. A
 *     commented-out step is therefore invisible, which is correct: it runs
 *     nothing. The cost is that a `#` inside a `run:` command truncates that
 *     command; there are none today and the truncation would fail closed.
 *   * A LOOP STRICTER THAN CI IS ALLOWED. The contract is one-directional. A
 *     script that runs more than CI cannot produce the surprise this exists to
 *     prevent, because the surprise is always "CI knew something I did not".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const MANIFEST_PATH = 'package.json';

/** The CI job that is meant to be reproducible with one local command. */
const JOB = 'verify';
/** The root script that is meant to reproduce it. */
const SCRIPT = 'verify';

const WORKFLOW = readFileSync(join(REPO_ROOT, WORKFLOW_PATH), 'utf8');

export interface Offence {
  readonly where: string;
  readonly found: string;
  readonly why: string;
}

/**
 * Commands the `verify` job runs that are deliberately NOT part of the local
 * loop, each with the reason it is excused.
 *
 * Kept deliberately tight. A broad pattern here is how this guard would go
 * quietly inert, so each entry describes one specific command rather than a
 * category of them.
 */
export const OUTSIDE_THE_LOOP: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  {
    pattern: /^corepack\s+enable\b/,
    why: 'runner setup — a developer already has pnpm on PATH.',
  },
  {
    pattern: /^pnpm\s+install\b/,
    why: 'dependency install — a developer already has node_modules.',
  },
  {
    pattern: /^pnpm\s+--filter\s+\S+\s+build\b/,
    why:
      'the Vite build, which is a build and not a check. It stays out of the loop so the loop ' +
      'is fast; if it ever needs to be in, put it in the script rather than widening this.',
  },
];

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The workflow as the runner sees it, with `#` commentary gone. */
export function readableYaml(source: string): string {
  return source.replaceAll('\r\n', '\n').replace(/(^|\s)#.*$/gm, '$1');
}

/** The `scripts` block of a `package.json`, as plain strings. */
export function scriptsOf(manifest: string): Record<string, string> {
  const parsed: unknown = JSON.parse(manifest);
  const scripts: unknown = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== 'object' || scripts === null) {
    throw new Error(`${MANIFEST_PATH} has no "scripts" block to compare the CI job against.`);
  }
  return Object.fromEntries(
    Object.entries(scripts as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

const SCRIPTS: Readonly<Record<string, string>> = scriptsOf(
  readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8'),
);

/**
 * The body of one job, as text.
 *
 * Deliberately lexical — no YAML parser, matching the house style of the other
 * repository guards (see `release-signing-gate.contract.test.ts`). The job key
 * is only recognised after a top-level `jobs:`, so a `verify:` appearing
 * anywhere else cannot be mistaken for it. An absent job yields `''`, which the
 * premise below refuses to adjudicate.
 */
export function jobTextOf(workflow: string, job: string): string {
  const header = new RegExp(String.raw`^(\s+)${escapeForRegExp(job)}:\s*$`);
  const collected: string[] = [];
  let seenJobs = false;
  let indent = -1;

  for (const line of workflow.split('\n')) {
    if (!seenJobs) {
      if (/^jobs:\s*$/.test(line)) seenJobs = true;
      continue;
    }
    if (indent === -1) {
      const match = header.exec(line);
      if (match) indent = match[1]?.length ?? 0;
      continue;
    }
    if (line.trim() === '') {
      collected.push(line);
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    collected.push(line);
  }

  return collected.join('\n');
}

/**
 * One shell command per entry.
 *
 * `&&`, `||` and `;` chain separate commands, so they are split on. A `|` pipe
 * is NOT: its right-hand side is a continuation of one command, and splitting
 * there would invent commands like `head -5` that nobody runs.
 */
function splitCommands(text: string): string[] {
  return text
    .split(/\n|&&|\|\||;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function unquote(value: string): string {
  return /^(['"])([\s\S]*)\1$/.exec(value)?.[2] ?? value;
}

/**
 * Every command the job's `run:` keys carry, inline and block-scalar alike.
 *
 * A bare `run:` with no scalar (the `defaults: run: shell:` mapping) yields
 * nothing, which is right — it configures commands rather than being one.
 */
export function runCommandsOf(jobText: string): string[] {
  const lines = jobText.split('\n');
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*(?:-\s+)?)run:\s*(.*)$/.exec(lines[index] ?? '');
    if (!match) continue;

    const keyIndent = (match[1] ?? '').length;
    const inline = (match[2] ?? '').trim();

    if (!/^[|>][+-]?\d*$/.test(inline)) {
      commands.push(...splitCommands(unquote(inline)));
      continue;
    }

    const block: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const body = lines[next] ?? '';
      if (body.trim() !== '' && body.length - body.trimStart().length <= keyIndent) break;
      block.push(body.trim());
      index = next;
    }
    commands.push(...splitCommands(block.join('\n')));
  }

  return commands;
}

/** The root script a command invokes, or `null` if it invokes none. */
export function rootScriptInvokedBy(
  command: string,
  scripts: Readonly<Record<string, string>>,
): string | null {
  const name = /^pnpm(?:\s+run)?\s+(\S+)/.exec(command)?.[1];
  if (name === undefined) return null;
  return Object.hasOwn(scripts, name) ? name : null;
}

/** What the `verify` script chains, and any segment of it this guard cannot read. */
export function loopOf(scripts: Readonly<Record<string, string>>): {
  readonly runs: readonly string[];
  readonly unreadable: readonly string[];
} {
  const body = scripts[SCRIPT];
  if (body === undefined) {
    throw new Error(
      `${MANIFEST_PATH} has no "${SCRIPT}" script. The local loop has no entry point.`,
    );
  }

  const runs: string[] = [];
  const unreadable: string[] = [];
  for (const segment of splitCommands(body)) {
    const name = rootScriptInvokedBy(segment, scripts);
    if (name === null) unreadable.push(segment);
    else runs.push(name);
  }
  return { runs, unreadable };
}

/** Every way the job and the script could disagree. */
export function loopDriftOffences(
  jobText: string,
  scripts: Readonly<Record<string, string>>,
): Offence[] {
  const { runs, unreadable } = loopOf(scripts);
  const covered = new Set<string>(runs);
  const offences: Offence[] = [];

  for (const segment of unreadable) {
    offences.push({
      where: `the "${SCRIPT}" script`,
      found: segment,
      why:
        'this is not a `pnpm <script>` call, so this guard cannot tell what it covers and will ' +
        'not vouch for it. Express the check as a root script and chain that instead.',
    });
  }

  for (const command of runCommandsOf(jobText)) {
    const name = rootScriptInvokedBy(command, scripts);

    if (name === SCRIPT) continue;
    if (name !== null && covered.has(name)) continue;

    if (name !== null) {
      offences.push({
        where: `the "${JOB}" job runs \`${command}\``,
        found: `pnpm ${name}`,
        why:
          `CI runs \`pnpm ${name}\` and \`pnpm ${SCRIPT}\` does not, so the documented loop can ` +
          'be green on a machine that CI is about to fail. Add it to the "verify" script — and ' +
          'to the loop in CLAUDE.md.',
      });
      continue;
    }

    if (OUTSIDE_THE_LOOP.some((entry) => entry.pattern.test(command))) continue;

    offences.push({
      where: `the "${JOB}" job runs \`${command}\``,
      found: command,
      why:
        'this command is neither a root script the loop runs nor a registered exception, so ' +
        'nobody can say whether `pnpm verify` reproduces it. Make it a root script and chain it ' +
        'into "verify", or add it to OUTSIDE_THE_LOOP with the reason it cannot be run locally.',
    });
  }

  return offences;
}

export function driftOffences(
  workflow: string,
  scripts: Readonly<Record<string, string>>,
): Offence[] {
  return loopDriftOffences(jobTextOf(readableYaml(workflow), JOB), scripts);
}

function explain(offences: readonly Offence[]): string {
  return offences.map((o) => `${o.where}\n    [${o.found}]\n    -> ${o.why}`).join('\n');
}

/** A copy of a job with one more step bolted on, for proving the detector fires. */
function withExtraStep(jobText: string, name: string, run: string): string {
  const indent = /^(\s*)-\s/m.exec(jobText)?.[1] ?? '      ';
  return `${jobText}\n${indent}- name: ${name}\n${indent}  run: ${run}\n`;
}

const REAL_JOB = jobTextOf(readableYaml(WORKFLOW), JOB);

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is a job and a script to compare', () => {
  // Asserted FIRST. Everything below adjudicates a list of commands, so a
  // parser that quietly returned an empty list would make the contract pass by
  // having nothing to say. This is the leg that refuses to let that happen.

  it(`ci.yml still has a "${JOB}" job with steps in it`, () => {
    expect(
      REAL_JOB,
      `There is no "${JOB}" job in ${WORKFLOW_PATH} any more. If the job was renamed, rename ` +
        'JOB here with it; if it was deleted, delete this contract rather than leaving it ' +
        'adjudicating nothing.',
    ).not.toBe('');
    expect(REAL_JOB).toContain('steps:');
  });

  it('the guard reads real commands out of it', () => {
    const commands = runCommandsOf(REAL_JOB);
    expect(commands.length).toBeGreaterThanOrEqual(8);
    // A named command, so a YAML restyle that defeated the parser is red here
    // rather than silently green below.
    expect(commands).toContain('pnpm tsc');
  });

  it(`the "${SCRIPT}" script is a readable chain of real root scripts`, () => {
    const { runs, unreadable } = loopOf(SCRIPTS);
    expect(unreadable).toEqual([]);
    expect(runs.length).toBeGreaterThanOrEqual(5);
    for (const name of runs) {
      expect(
        Object.hasOwn(SCRIPTS, name),
        `"${SCRIPT}" chains \`pnpm ${name}\`, which does not exist`,
      ).toBe(true);
    }
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe(`\`pnpm ${SCRIPT}\` runs everything the "${JOB}" job runs`, () => {
  it('the local loop has no gap', () => {
    const offences = driftOffences(WORKFLOW, SCRIPTS);
    expect(offences, `\n${explain(offences)}\n`).toEqual([]);
  });
});

// ── Proof the detector can actually fail ────────────────────────────────────

describe('the detector can actually fail', () => {
  // These mutate a COPY of the REAL job text, never the workflow on disk, so
  // they prove the parser works on the shape ci.yml actually has rather than on
  // a six-line fixture that happens to suit it.

  it('catches the L-98 defect itself, transcribed', () => {
    const beforeTheFix: Record<string, string> = {
      ...SCRIPTS,
      [SCRIPT]: 'pnpm tsc && pnpm lint && pnpm test && pnpm cargo:check && pnpm cargo:test',
    };
    const offences = loopDriftOffences(REAL_JOB, beforeTheFix);
    expect(offences.map((offence) => offence.found)).toContain('pnpm format:check');
  });

  it('catches a NEW root-script check appearing in the job', () => {
    const baseline = loopDriftOffences(REAL_JOB, SCRIPTS).length;
    const scripts: Record<string, string> = { ...SCRIPTS, licences: 'licence-check' };
    const offences = loopDriftOffences(
      withExtraStep(REAL_JOB, 'Check the licences', 'pnpm licences'),
      scripts,
    );
    expect(offences).toHaveLength(baseline + 1);
    expect(offences.at(-1)?.found).toBe('pnpm licences');
  });

  it('catches a NEW check that is not a root script at all', () => {
    // The case a naive two-sided diff sleeps through: it contributes nothing to
    // either side, so only a classify-everything guard notices it.
    const baseline = loopDriftOffences(REAL_JOB, SCRIPTS).length;
    const offences = loopDriftOffences(
      withExtraStep(REAL_JOB, 'Audit', 'pnpm audit --audit-level high'),
      SCRIPTS,
    );
    expect(offences).toHaveLength(baseline + 1);
    expect(offences.at(-1)?.found).toBe('pnpm audit --audit-level high');
  });

  it('catches a new check hidden inside a block scalar', () => {
    const baseline = loopDriftOffences(REAL_JOB, SCRIPTS).length;
    const indent = /^(\s*)-\s/m.exec(REAL_JOB)?.[1] ?? '      ';
    const offences = loopDriftOffences(
      `${REAL_JOB}\n${indent}- name: Extra\n${indent}  run: |\n${indent}    cargo audit\n${indent}    cargo deny check\n`,
      SCRIPTS,
    );
    expect(offences).toHaveLength(baseline + 2);
    expect(offences.map((offence) => offence.found)).toContain('cargo deny check');
  });

  it('catches a check chained onto an existing step with &&', () => {
    const baseline = loopDriftOffences(REAL_JOB, SCRIPTS).length;
    const offences = loopDriftOffences(
      REAL_JOB.replace('run: pnpm tsc', 'run: pnpm tsc && npx knip'),
      SCRIPTS,
    );
    expect(offences).toHaveLength(baseline + 1);
    expect(offences.map((offence) => offence.found)).toContain('npx knip');
  });

  it('catches a "verify" script this guard cannot read', () => {
    const opaque: Record<string, string> = { ...SCRIPTS, [SCRIPT]: 'turbo run everything' };
    expect(loopDriftOffences(REAL_JOB, opaque).map((offence) => offence.found)).toContain(
      'turbo run everything',
    );
  });

  it('names the check and the reason', () => {
    const beforeTheFix: Record<string, string> = {
      ...SCRIPTS,
      [SCRIPT]: 'pnpm tsc && pnpm lint && pnpm test && pnpm cargo:check && pnpm cargo:test',
    };
    const offence = loopDriftOffences(REAL_JOB, beforeTheFix).find(
      (candidate) => candidate.found === 'pnpm format:check',
    );
    expect(offence?.where).toContain('pnpm format:check');
    expect(offence?.why).toContain('CLAUDE.md');
  });
});

// ── Proof it does not fire on the correct shape ──────────────────────────────

describe('a loop that matches walks through', () => {
  const scripts: Record<string, string> = {
    tsc: 'turbo run typecheck',
    lint: 'turbo run lint',
    verify: 'pnpm tsc && pnpm lint',
  };

  const job = (...steps: string[]): string =>
    ['jobs:', '  verify:', '    steps:', ...steps].join('\n');

  it('accepts a job whose every check is in the loop', () => {
    const offences = loopDriftOffences(
      jobTextOf(job('      - run: pnpm tsc', '      - run: pnpm lint'), 'verify'),
      scripts,
    );
    expect(offences, explain(offences)).toEqual([]);
  });

  it('accepts a job that simply runs `pnpm verify`', () => {
    const offences = loopDriftOffences(
      jobTextOf(job('      - run: pnpm verify'), 'verify'),
      scripts,
    );
    expect(offences, explain(offences)).toEqual([]);
  });

  it('accepts `pnpm run <script>`, the long form of the same call', () => {
    const offences = loopDriftOffences(
      jobTextOf(job('      - run: pnpm run tsc'), 'verify'),
      scripts,
    );
    expect(offences, explain(offences)).toEqual([]);
  });

  it('accepts the registered setup and build steps', () => {
    const offences = loopDriftOffences(
      jobTextOf(
        job(
          '      - run: corepack enable pnpm',
          '      - run: pnpm install --frozen-lockfile',
          '      - run: pnpm --filter @cviper/light build',
        ),
        'verify',
      ),
      scripts,
    );
    expect(offences, explain(offences)).toEqual([]);
  });

  it('accepts a loop STRICTER than CI — the safe direction', () => {
    const stricter: Record<string, string> = { ...scripts, verify: 'pnpm tsc && pnpm lint' };
    const offences = loopDriftOffences(jobTextOf(job('      - run: pnpm tsc'), 'verify'), stricter);
    expect(offences, explain(offences)).toEqual([]);
  });

  it('ignores a commented-out step, which runs nothing', () => {
    const text = readableYaml(job('      - run: pnpm tsc', '      # - run: npx knip'));
    expect(loopDriftOffences(jobTextOf(text, 'verify'), scripts)).toEqual([]);
  });

  it('reads only the named job, not its neighbours', () => {
    const two = [
      'jobs:',
      '  verify:',
      '    steps:',
      '      - run: pnpm tsc',
      '  secret-scan:',
      '    steps:',
      '      - run: ./gitleaks dir .',
    ].join('\n');
    expect(loopDriftOffences(jobTextOf(two, 'verify'), scripts)).toEqual([]);
    expect(jobTextOf(two, 'verify')).not.toContain('gitleaks');
  });

  it('boundary: a job with no steps has nothing to say', () => {
    expect(runCommandsOf('')).toEqual([]);
    expect(loopDriftOffences('', scripts)).toEqual([]);
  });

  it('boundary: an absent job yields empty text rather than the whole file', () => {
    expect(jobTextOf(readableYaml(WORKFLOW), 'no-such-job')).toBe('');
  });

  it('boundary: a bare `run:` mapping is not a command', () => {
    expect(runCommandsOf('    defaults:\n      run:\n        shell: bash')).toEqual([]);
  });
});
