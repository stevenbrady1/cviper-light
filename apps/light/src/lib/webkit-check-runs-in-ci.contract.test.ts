/**
 * The WebKit check actually runs, and it stays out of `pnpm test` (L-111).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * `apps/light/e2e/pdfjs-webkit.spec.ts` is the only thing in this repository
 * that has ever executed pdf.js under WebKit. It is deliberately NOT collected
 * by Vitest, because it needs a ~60 MB browser download and `pnpm test` has to
 * stay something a contributor can run offline in seconds.
 *
 * That leaves it in the most dangerous shape a check can have: nothing on a
 * developer machine runs it, so if the CI job that does were renamed, reordered
 * or deleted, every local signal would stay green and the check would simply
 * stop happening. Nobody would find out. `lessons_silently_inert_guards` calls
 * that this repository's most-repeated failure class, and `pnpm smoke` already
 * lives with exactly this exposure.
 *
 * So the wiring is asserted rather than assumed:
 *
 *   1. ci.yml has a `webkit` job, and it runs `pnpm webkit`.
 *   2. That job installs the browser first, otherwise the run fails for a
 *      reason nobody would read as "CI forgot a step".
 *   3. The root scripts it depends on exist and point at the real spec file.
 *   4. `pnpm verify` does NOT chain it — the separation is the whole reason the
 *      spec is allowed to need a browser, and a well-meaning "let's run
 *      everything locally" edit would force a download on every contributor.
 *   5. The spec still lives outside Vitest's collection glob, so `pnpm test`
 *      cannot start needing a browser by accident.
 *   6. The honest-limit note in the spec still says what the check does NOT
 *      retire. A green WebKit run is not iOS verification, and the day that
 *      paragraph is deleted is the day somebody closes the iOS work item on the
 *      strength of it.
 *
 * ============================================================================
 * LEXICAL, NOT A YAML PARSER
 * ============================================================================
 * Matching the house style of the other workflow guards
 * (`verify-loop-matches-ci.contract.test.ts`,
 * `release-signing-gate.contract.test.ts`): a job key is only recognised after
 * a top-level `jobs:`, and comments are stripped first, so a commented-out step
 * is invisible — which is correct, because it runs nothing.
 *
 * Those helpers are re-declared here rather than imported. Importing one TEST
 * module from another re-registers its whole suite under the wrong name; that
 * is why `repo-scan.ts` exists as a plain module. Two tiny parsers with their
 * own mutation legs are cheaper than a third shared module.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const MANIFEST_PATH = 'package.json';
const SPEC_PATH = 'apps/light/e2e/pdfjs-webkit.spec.ts';
const VITEST_CONFIG_PATH = 'apps/light/vitest.config.ts';

/** The CI job that must exist, and the root script it must run. */
const JOB = 'webkit';
const SCRIPT = 'pnpm webkit';
/** The loop that must NOT run it. */
const LOOP_SCRIPT = 'verify';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const WORKFLOW = read(WORKFLOW_PATH);

// ── Detectors ───────────────────────────────────────────────────────────────

/** The workflow as the runner sees it, with `#` commentary gone. */
export function readableYaml(source: string): string {
  return source.replaceAll('\r\n', '\n').replace(/(^|\s)#.*$/gm, '$1');
}

/**
 * The body of one job, as text. `''` when the job is not there.
 *
 * The key is only recognised after a top-level `jobs:`, so the word `webkit`
 * appearing in a `name:` or an `env:` cannot be mistaken for the job itself.
 */
export function jobTextOf(workflow: string, job: string): string {
  const header = new RegExp(String.raw`^(\s+)${job}:\s*$`);
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

/** Every command the job's `run:` keys carry, in order, one per entry. */
export function runCommandsOf(jobText: string): string[] {
  const commands: string[] = [];
  for (const line of jobText.split('\n')) {
    const inline = /^\s*(?:-\s+)?run:\s*(.+)$/.exec(line)?.[1]?.trim();
    if (inline === undefined || /^[|>][+-]?\d*$/.test(inline)) continue;
    commands.push(inline.replace(/^(['"])([\s\S]*)\1$/, '$2'));
  }
  return commands;
}

const JOB_TEXT = jobTextOf(readableYaml(WORKFLOW), JOB);
const JOB_COMMANDS = runCommandsOf(JOB_TEXT);

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is a job to adjudicate', () => {
  // Asserted FIRST. Every leg below reads a list of commands, and a parser that
  // quietly returned an empty list would let the whole file pass by having
  // nothing to say.

  it(`ci.yml has a "${JOB}" job with steps in it`, () => {
    expect(
      JOB_TEXT,
      `There is no "${JOB}" job in ${WORKFLOW_PATH}. If it was renamed, rename JOB here with ` +
        'it. If it was deleted, nothing in this repository runs pdf.js under WebKit any more — ' +
        `delete ${SPEC_PATH} too rather than leaving a check that never executes.`,
    ).not.toBe('');
    expect(JOB_TEXT).toContain('steps:');
  });

  it('the parser reads real commands out of it', () => {
    expect(JOB_COMMANDS.length).toBeGreaterThanOrEqual(4);
    // A named command, so a YAML restyle that defeated the parser goes red here
    // rather than silently green below.
    expect(JOB_COMMANDS).toContain('corepack enable pnpm');
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('the WebKit check runs in CI', () => {
  it(`the "${JOB}" job runs \`${SCRIPT}\``, () => {
    expect(
      JOB_COMMANDS,
      `The "${JOB}" job no longer runs \`${SCRIPT}\`. Its commands are: ${JOB_COMMANDS.join(' | ')}`,
    ).toContain(SCRIPT);
  });

  it('it installs the WebKit browser, and does it BEFORE driving anything', () => {
    const install = JOB_COMMANDS.findIndex(
      (command) => /playwright-core\s+install\b/.test(command) && /\bwebkit\b/.test(command),
    );
    expect(
      install,
      'No step installs the WebKit browser. `playwright-core` has no lifecycle script, so ' +
        '`pnpm install` never downloads a browser — that is deliberate, and it means the ' +
        'download has to be asked for here or the run fails with a missing executable.',
    ).toBeGreaterThanOrEqual(0);
    expect(
      install,
      'The browser is installed AFTER the check runs, so the check can never have a browser.',
    ).toBeLessThan(JOB_COMMANDS.indexOf(SCRIPT));
  });

  it('the scripts the job calls exist and point at the real spec', () => {
    const parsed: unknown = JSON.parse(read(MANIFEST_PATH));
    const scripts = (parsed as { scripts?: Record<string, string> }).scripts ?? {};

    expect(scripts).toHaveProperty('webkit');
    expect(scripts).toHaveProperty('webkit:build');
    expect(
      scripts['webkit'],
      '`pnpm webkit` must drive the spec this contract is about.',
    ).toContain(SPEC_PATH);
    expect(existsSync(join(REPO_ROOT, SPEC_PATH)), `${SPEC_PATH} does not exist`).toBe(true);
  });

  // L-300: the rendered colour-contrast check rides the same job. It is the only
  // check that measures colours on a painted screen (jsdom paints nothing), so
  // dropping it from the script would leave contrast checked by grep alone.
  it('`pnpm webkit` also builds and drives the rendered contrast check', () => {
    const parsed: unknown = JSON.parse(read(MANIFEST_PATH));
    const scripts = (parsed as { scripts?: Record<string, string> }).scripts ?? {};
    const contrastSpec = 'apps/light/e2e/contrast-webkit.spec.ts';

    expect(scripts['webkit']).toContain(contrastSpec);
    expect(scripts['webkit:build']).toContain('vite.contrast-harness.config.ts');
    expect(existsSync(join(REPO_ROOT, contrastSpec)), `${contrastSpec} does not exist`).toBe(true);
  });
});

/**
 * L-280 — a slow package mirror must not hold a required check for 20 minutes.
 *
 * On 26 Oct 2026 the install ran out the whole job twice. It was not a hang:
 * `--with-deps` pulls system libraries through apt, and the Ubuntu mirror was
 * serving them at 20-40 KB/s. A normal install takes under a minute. So each
 * attempt is capped with `timeout`, and a second attempt follows a failed
 * first one, on a fresh connection. The whole retry is on ONE `run:` line
 * because the parser above reads inline commands only.
 */
export const INSTALL_ATTEMPT_CAP_SECONDS = 300;

export function installAttempts(command: string): number[] {
  return [
    ...command.matchAll(
      /\btimeout\s+(?:--\S+\s+)*(\d+)\s+[^|]*?playwright-core\s+install\b[^|]*?\bwebkit\b/g,
    ),
  ].map((match) => Number(match[1]));
}

describe('a slow mirror cannot hold the check for the whole job (L-280)', () => {
  const install =
    JOB_COMMANDS.find(
      (command) => /playwright-core\s+install\b/.test(command) && /\bwebkit\b/.test(command),
    ) ?? '';

  it('caps every install attempt with a timeout, and tries twice', () => {
    const attempts = installAttempts(install);
    expect(attempts, `install step: ${install}`).toHaveLength(2);
    for (const seconds of attempts)
      expect(seconds).toBeLessThanOrEqual(INSTALL_ATTEMPT_CAP_SECONDS);
    expect(install).toMatch(/\|\|/);
  });

  it('both attempts fit inside the job, leaving time to run the check', () => {
    const jobMinutes = Number(/^\s+timeout-minutes:\s*(\d+)\s*$/m.exec(JOB_TEXT)?.[1] ?? NaN);
    const installMinutes = installAttempts(install).reduce((sum, s) => sum + s, 0) / 60;
    expect(installMinutes).toBeLessThan(jobMinutes - 5);
  });

  // The first live run of L-280 (PR #371) proved this is needed: `timeout`
  // stopped pnpm, but apt-get runs under sudo in its own process group, so it
  // outlived the cap, kept the dpkg lock, and the retry failed in one second
  // with "Could not get lock". The retry is worthless unless the leftover apt
  // is stopped and a half-done install repaired first.
  it('frees the dpkg lock before the retry', () => {
    const [, retry = ''] = install.split('||');
    expect(retry, `retry half of: ${install}`).toMatch(
      /^\s*\(\s*bash\s+\.github\/scripts\/release-apt-lock\.sh\s*&&\s*timeout\b/,
    );
    expect(existsSync(join(REPO_ROOT, '.github/scripts/release-apt-lock.sh'))).toBe(true);
  });

  // NEGATIVE — the detector itself.
  it('does not count an uncapped install as capped', () => {
    expect(
      installAttempts(
        'pnpm --filter @cviper/light exec playwright-core install --with-deps webkit',
      ),
    ).toEqual([]);
  });

  it('boundary: reads a cap with a kill-after flag', () => {
    expect(
      installAttempts(
        'timeout --kill-after=20 300 pnpm exec playwright-core install --with-deps webkit',
      ),
    ).toEqual([300]);
  });
});

/**
 * L-284 — WebKit's system packages are cached, so a slow mirror is not hit.
 *
 * L-280 capped a slow install; it did not make it succeed. Three stalls on
 * 26 Oct 2026 were all the Ubuntu mirror serving `--with-deps` packages at a
 * few kB/s. So apt's package directory is pointed at a folder `actions/cache`
 * restores before the install and saves after it. Each leg below is a step
 * whose absence would quietly make the cache empty again, with every run still
 * green — just slow, and sometimes red for a reason nobody connects to it.
 */
export const APT_CACHE_DIR = '~/.cache/webkit-apt';
const APT_CACHE_SCRIPT = '.github/scripts/webkit-apt-cache.sh';

/** The index of the first job line matching `pattern`, or -1. */
export function lineIndexOf(jobText: string, pattern: RegExp): number {
  return jobText.split('\n').findIndex((line) => pattern.test(line));
}

describe("WebKit's system packages are cached between runs (L-284)", () => {
  const lines = JOB_TEXT;
  const installLine = lineIndexOf(lines, /playwright-core\s+install\b.*\bwebkit\b/);
  const configure = JOB_COMMANDS.findIndex((c) =>
    c.startsWith(`bash ${APT_CACHE_SCRIPT} configure ${APT_CACHE_DIR}`),
  );
  const report = JOB_COMMANDS.findIndex((c) =>
    c.startsWith(`bash ${APT_CACHE_SCRIPT} report ${APT_CACHE_DIR}`),
  );
  const install = JOB_COMMANDS.findIndex(
    (c) => /playwright-core\s+install\b/.test(c) && /\bwebkit\b/.test(c),
  );

  it('restores the package folder with actions/cache BEFORE the install', () => {
    const cachePath = lineIndexOf(lines, new RegExp(`path:\\s*${APT_CACHE_DIR}/\\*\\.deb\\s*$`));
    expect(cachePath, `no actions/cache step saves ${APT_CACHE_DIR}/*.deb`).toBeGreaterThan(-1);
    expect(cachePath).toBeLessThan(installLine);
  });

  it('points apt at that folder before the install, and reports after it', () => {
    expect(configure, `no step runs ${APT_CACHE_SCRIPT} configure`).toBeGreaterThan(-1);
    expect(configure).toBeLessThan(install);
    expect(report, `no step runs ${APT_CACHE_SCRIPT} report`).toBeGreaterThan(install);
    expect(existsSync(join(REPO_ROOT, APT_CACHE_SCRIPT))).toBe(true);
  });

  it('the script keeps what apt downloads, outside the path docker-clean empties', () => {
    const script = read(APT_CACHE_SCRIPT);
    expect(script).toMatch(/Dir::Cache::Archives\s+"\$dir\/"/);
    expect(script).toMatch(/APT::Keep-Downloaded-Packages\s+"true"/);
  });

  // NEGATIVE — the detector itself.
  it('does not find a cache step that is not there', () => {
    expect(lineIndexOf('steps:\n  - run: echo hi', /path:\s*~\/\.cache\/webkit-apt/)).toBe(-1);
  });
});

describe('and it stays out of the offline loop', () => {
  it(`\`pnpm ${LOOP_SCRIPT}\` does not chain it`, () => {
    const parsed: unknown = JSON.parse(read(MANIFEST_PATH));
    const loop = (parsed as { scripts?: Record<string, string> }).scripts?.[LOOP_SCRIPT] ?? '';
    expect(loop, `there is no "${LOOP_SCRIPT}" script to check`).not.toBe('');
    expect(
      loop.includes('webkit'),
      `\`pnpm ${LOOP_SCRIPT}\` now runs the WebKit check, which forces a ~60 MB browser download ` +
        'on every contributor and on every CI job that calls the loop. It is separate on ' +
        'purpose, exactly as `pnpm smoke` is. If it genuinely belongs in the loop, say so in ' +
        'CLAUDE.md first — the loop is documented as something you can run offline.',
    ).toBe(false);
  });

  it('Vitest still collects only `src`, so `pnpm test` cannot need a browser', () => {
    // The mechanism, not the outcome: the spec is safe from collection because
    // the include glob names `src`, and this is the line that has to change for
    // that to stop being true.
    const config = read(VITEST_CONFIG_PATH);
    const include = /include:\s*\[([^\]]*)\]/.exec(config)?.[1];
    expect(include, `${VITEST_CONFIG_PATH} has no readable include glob any more`).toBeDefined();
    for (const glob of (include ?? '')
      .split(',')
      .map((entry) => entry.trim().replace(/['"]/g, ''))) {
      if (glob === '') continue;
      expect(glob, `${glob} would collect files outside src/`).toMatch(/^src\//);
    }
    expect(SPEC_PATH.startsWith('apps/light/src/')).toBe(false);
  });
});

describe('the honest limit is still written down', () => {
  // `lessons_green_tests_false_documents`: a check can be perfectly green and
  // still be quoted as proof of something it never tested. The spec's own
  // header is the only thing standing between "pdf.js works under WebKit" and
  // "iOS is verified", so its deletion is a regression like any other.
  const SPEC = read(SPEC_PATH);

  it.each([
    ['names WKWebView, the thing it is a proxy for', /WKWebView/],
    ['says plainly that it is not iOS', /IT IS NOT iOS/],
    ['leaves iOS memory limits open', /MEMORY LIMIT/i],
    ['leaves the share-sheet file path open', /SHARE-SHEET/i],
    ['leaves the Tauri iOS shell open', /TAURI iOS SHELL/i],
  ])('the spec %s', (_what, pattern) => {
    expect(
      SPEC,
      `${SPEC_PATH} no longer carries this part of its honest-limit note. A WebKit run retires ` +
        'engine-level risk and nothing about a device; deleting the sentence that says so is how ' +
        'a green tick closes the wrong work item.',
    ).toMatch(pattern);
  });
});

// ── Proof the detector can actually fail ────────────────────────────────────

describe('the detector can actually fail', () => {
  // Mutations of a COPY of the REAL workflow text, so they prove the parser
  // works on the shape ci.yml actually has rather than on a fixture that
  // happens to suit it.

  it('an absent job is not silently treated as a passing one', () => {
    expect(jobTextOf(readableYaml(WORKFLOW), 'no-such-job-exists')).toBe('');
  });

  it('spots the run step being dropped', () => {
    const without = JOB_TEXT.split('\n')
      .filter((line) => !line.includes(SCRIPT))
      .join('\n');
    expect(runCommandsOf(without)).not.toContain(SCRIPT);
  });

  it('does not count a commented-out step as running', () => {
    const commented = readableYaml(`jobs:\n  ${JOB}:\n    steps:\n      # run: ${SCRIPT}\n`);
    expect(runCommandsOf(jobTextOf(commented, JOB))).not.toContain(SCRIPT);
  });

  it('spots the browser install being dropped', () => {
    const without = JOB_TEXT.split('\n')
      .filter((line) => !/playwright-core\s+install/.test(line))
      .join('\n');
    const install = runCommandsOf(without).findIndex((command) =>
      /playwright-core\s+install\b/.test(command),
    );
    expect(install).toBe(-1);
  });

  it('spots the WebKit check being pulled into the loop', () => {
    expect('pnpm tsc && pnpm webkit && pnpm test'.includes('webkit')).toBe(true);
  });
});

/**
 * L-367 — a failed download reads as a failed download, and a warm cache needs
 * no Ubuntu package server at all.
 *
 * On 11 Nov 2026 the job went red twice with no test run (CI #1102, #1107). The
 * L-284 package cache was a FULL hit both times. What failed was `apt-get
 * update`, which Playwright's `--with-deps` always runs first and which always
 * needs the network: the runner could not resolve the Ubuntu servers, each
 * lookup took ~40 s, and the update never finished inside either 5-minute cap.
 * The re-runs that "passed" hit the same failure and got lucky on the clock.
 *
 *   1. Both caches are keyed on the Playwright version, and the package cache
 *      on the runner image too: the image's own package lists say which version
 *      of each package apt will want, so the cached files must match THEM.
 *   2. A step installs the packages from the cache with `--no-download` — no
 *      network, no `apt-get update`. Only when that fails does the install step
 *      add `--with-deps`, and with it the servers.
 *   3. A check after the install and BEFORE the tests confirms nothing is
 *      missing, and a last step names the install, not a test, whenever the
 *      tests never ran.
 *
 * Above everything: the job never passes without the tests having run. Each
 * forbid-list rule below has a mutation of the REAL workflow proving it fails.
 */
const KEYS_STEP_ID = 'keys';
const EXPLAIN_SCRIPT = '.github/scripts/webkit-install-failed.sh';
const BROWSER_CACHE_DIR = '~/.cache/ms-playwright';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The job's steps, one text block per `- ` item under `steps:`, in order. */
export function stepsOf(jobText: string): string[] {
  const lines = jobText.split('\n');
  const start = lines.findIndex((line) => /^\s+steps:\s*$/.test(line));
  if (start === -1) return [];
  const first = lines.slice(start + 1).find((line) => /^\s*-\s/.test(line));
  if (first === undefined) return [];
  const indent = indentOf(first);
  const steps: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && indentOf(line) === indent && /^\s*-\s/.test(line)) steps.push(line);
    else if (steps.length > 0) steps[steps.length - 1] += `\n${line}`;
  }
  return steps;
}

/** A step's (single-line) value for `key`, or undefined. */
export function stepValue(step: string, key: string): string | undefined {
  return new RegExp(String.raw`^\s*(?:-\s+)?${key}:\s*(.+?)\s*$`, 'm').exec(step)?.[1];
}

/** The body of one `mode)` arm of a bash `case`, `#` commentary removed. */
export function caseArm(script: string, mode: string): string {
  const arm = new RegExp(String.raw`^\s*${mode}\)\s*$([\s\S]*?)^\s*;;\s*$`, 'm');
  return arm.exec(readableYaml(script))?.[1] ?? '';
}

const isInstall = (command: string): boolean =>
  /playwright-core\s+install\b/.test(command) && /\bwebkit\b/.test(command);

/** Shapes that turn a failed command into a passing one. */
export const MASKS: readonly RegExp[] = [
  /\|\|\s*(?:true|:|exit\s+0|echo)\b/,
  /\|\|\s*:\s*$/,
  /;\s*(?:true|exit\s+0)\s*\)?\s*$/,
  /\bset\s+\+e\b/,
];

/**
 * Every way the job could finish green without `pnpm webkit` having run and
 * passed. Forbid-list: each entry names a shape that must be ABSENT.
 */
export function neverGreenOffences(jobText: string): string[] {
  const offences: string[] = [];
  const lines = jobText.split('\n').filter((line) => line.trim() !== '');
  const jobIndent = lines.length > 0 ? indentOf(lines[0] ?? '') : 0;

  if (/^\s*(?:-\s+)?continue-on-error\s*:/m.test(jobText))
    offences.push('`continue-on-error` lets a failing step leave the job green');
  if (lines.some((line) => indentOf(line) === jobIndent && /^\s*if\s*:/.test(line)))
    offences.push('a job-level `if:` can skip the whole job, and a skipped check counts as passed');

  const steps = stepsOf(jobText);
  const drive = steps.findIndex((step) => runCommandsOf(step).includes(SCRIPT));
  if (drive === -1) offences.push(`no step runs \`${SCRIPT}\``);
  for (const step of steps.slice(0, drive + 1))
    if (stepValue(step, 'if') !== undefined)
      offences.push(
        `a step up to and including the tests has an \`if:\`: ${step.trim().split('\n')[0]}`,
      );

  for (const command of runCommandsOf(jobText))
    if (MASKS.some((mask) => mask.test(command))) offences.push(`\`${command}\` masks a failure`);

  const install = runCommandsOf(jobText).find(isInstall) ?? '';
  if (!/\|\|\s*\(.*\bwebkit\s*\)\s*$/.test(install))
    offences.push(
      'the install line no longer ends in its capped retry, so its status is not the install’s',
    );
  return offences;
}

/** Cache keys that would survive a change of runner image or Playwright version. */
export function cacheKeyOffences(jobText: string): string[] {
  const offences: string[] = [];
  const steps = stepsOf(jobText);
  const keysAt = steps.findIndex((step) => stepValue(step, 'id') === KEYS_STEP_ID);
  if (keysAt === -1) offences.push(`no step with \`id: ${KEYS_STEP_ID}\` names the caches`);

  const caches: [string, string, string][] = [
    ['system packages', `${APT_CACHE_DIR}/*.deb`, 'image'],
    ['browser', BROWSER_CACHE_DIR, 'os'],
  ];
  for (const [what, path, runner] of caches) {
    const at = steps.findIndex((step) =>
      new RegExp(String.raw`^\s*path:\s*${escapeRegExp(path)}\s*$`, 'm').test(step),
    );
    const key = at === -1 ? undefined : stepValue(steps[at] ?? '', 'key');
    if (key === undefined) {
      offences.push(`the ${what} cache has no key`);
      continue;
    }
    for (const output of ['playwright', runner])
      if (
        !new RegExp(String.raw`\$\{\{\s*steps\.${KEYS_STEP_ID}\.outputs\.${output}\s*\}\}`).test(
          key,
        )
      )
        offences.push(`the ${what} cache key does not change with \`${output}\`: ${key}`);
    if (keysAt === -1 || keysAt > at)
      offences.push(`the ${what} cache is restored before its key is named`);
  }
  return offences;
}

/** The "no test ran" step: present, failure-only, after the tests, never green. */
export function explainOffences(jobText: string, script: string): string[] {
  const offences: string[] = [];
  const steps = stepsOf(jobText);
  const drive = steps.findIndex((step) => runCommandsOf(step).includes(SCRIPT));
  const at = steps.findIndex((step) => runCommandsOf(step).includes(`bash ${EXPLAIN_SCRIPT}`));
  if (at === -1) return [`no step runs \`bash ${EXPLAIN_SCRIPT}\``];
  if (at < drive) offences.push('the explanation runs before the tests');
  const condition = stepValue(steps[at] ?? '', 'if') ?? '';
  if (!/\bfailure\(\)/.test(condition)) offences.push(`it is not failure-only: if: ${condition}`);
  if (
    !/\bsteps\.drive\.outcome\b/.test(condition) ||
    stepValue(steps[drive] ?? '', 'id') !== 'drive'
  )
    offences.push('it does not ask whether the tests ran (steps.drive.outcome)');

  const body = readableYaml(script);
  if (!/::error\b/.test(body)) offences.push('the script raises no ::error annotation');
  if (!/no (?:WebKit )?test ran/i.test(body)) offences.push('the script never says no test ran');
  if (!/GITHUB_STEP_SUMMARY/.test(body)) offences.push('the script writes no job summary');
  if (/\bexit\s+0\b/.test(body)) offences.push('the script can exit 0');
  if (!/\bexit\s+1\s*$/.test(body.trimEnd())) offences.push('the script does not end in exit 1');
  return offences;
}

describe('the caches change with the runner image and Playwright (L-367)', () => {
  it('both cache keys are named by a step that reads the image and the Playwright version', () => {
    expect(cacheKeyOffences(JOB_TEXT)).toEqual([]);
    const keys = caseArm(read(APT_CACHE_SCRIPT), KEYS_STEP_ID);
    expect(keys, `${APT_CACHE_SCRIPT} has no "${KEYS_STEP_ID}" mode`).not.toBe('');
    expect(keys).toMatch(/\$\{?ImageOS\b/);
    expect(keys).toMatch(/\$\{?ImageVersion\b/);
    expect(keys).toMatch(/playwright-core\/package\.json/);
    expect(JOB_COMMANDS).toContain(`bash ${APT_CACHE_SCRIPT} ${KEYS_STEP_ID}`);
  });
});

describe('a warm cache does not need the Ubuntu package servers (L-367)', () => {
  const offline = JOB_COMMANDS.findIndex((c) =>
    c.includes(`bash ${APT_CACHE_SCRIPT} offline ${APT_CACHE_DIR}`),
  );
  const install = JOB_COMMANDS.findIndex(isInstall);
  const report = JOB_COMMANDS.findIndex((c) => c.startsWith(`bash ${APT_CACHE_SCRIPT} report`));

  it('installs from the cache before the browser step, and checks after it, before the tests', () => {
    expect(offline, `no step runs ${APT_CACHE_SCRIPT} offline`).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(install);
    expect(report).toBeGreaterThan(install);
    expect(report).toBeLessThan(JOB_COMMANDS.indexOf(SCRIPT));
  });

  it('the offline install cannot reach the network, and is capped', () => {
    const arm = caseArm(read(APT_CACHE_SCRIPT), 'offline');
    expect(arm, `${APT_CACHE_SCRIPT} has no "offline" mode`).toMatch(
      /apt-get\s+install\b.*--no-download/,
    );
    expect(arm).not.toMatch(/apt-get\s+update|--with-deps/);
    expect(arm).toMatch(/\btimeout\s+(?:--\S+\s+)*\d+\s+apt-get\b/);
    for (const mask of MASKS) expect(arm).not.toMatch(mask);
  });

  it('both install attempts ask for the servers only when the cache could not cover it', () => {
    const line = JOB_COMMANDS[install] ?? '';
    expect(line.match(/install\s+\$\{NEEDS_APT:\+--with-deps\}\s+webkit\b/g) ?? []).toHaveLength(2);
    expect(line).not.toMatch(/install\s+--with-deps\b/);
    const step = stepsOf(JOB_TEXT).find((s) => runCommandsOf(s).some(isInstall)) ?? '';
    expect(stepValue(step, 'NEEDS_APT')).toMatch(
      /^\$\{\{\s*steps\.deps\.outputs\.needs-apt\s*\}\}$/,
    );
  });

  it('the check before the tests uses Playwright’s own dry run and fails the step', () => {
    const arm = caseArm(read(APT_CACHE_SCRIPT), 'report');
    expect(arm).toMatch(/playwright-core\s+install-deps\s+--dry-run\s+webkit/);
    expect(arm).toMatch(/\bexit\s+1\b/);
    for (const mask of MASKS) expect(arm).not.toMatch(mask);
  });

  it('every cap still fits inside the job, leaving time to run the check', () => {
    const offlineCap = Number(
      /\btimeout\s+(?:--\S+\s+)*(\d+)\s+apt-get\b/.exec(
        caseArm(read(APT_CACHE_SCRIPT), 'offline'),
      )?.[1] ?? NaN,
    );
    const installSeconds = installAttempts(JOB_COMMANDS[install] ?? '').reduce((a, b) => a + b, 0);
    const jobMinutes = Number(/^\s+timeout-minutes:\s*(\d+)\s*$/m.exec(JOB_TEXT)?.[1] ?? NaN);
    expect((offlineCap + installSeconds) / 60).toBeLessThan(jobMinutes - 5);
  });
});

describe('the job never passes without the tests, and says so when they did not run (L-367)', () => {
  it('nothing in the job can turn a failure green or skip the tests', () => {
    expect(neverGreenOffences(JOB_TEXT)).toEqual([]);
  });

  it('a failure before the tests is reported as "no test ran", and stays red', () => {
    expect(existsSync(join(REPO_ROOT, EXPLAIN_SCRIPT)), `${EXPLAIN_SCRIPT} does not exist`).toBe(
      true,
    );
    expect(explainOffences(JOB_TEXT, read(EXPLAIN_SCRIPT))).toEqual([]);
  });
});

describe('the L-367 detectors can actually fail', () => {
  // Every mutation edits a COPY of the real ci.yml, and first proves the text it
  // edits is really there, so a mutation that silently changed nothing cannot
  // pass for a detector that works.
  const mutate = (from: string | RegExp, to: string): string => {
    const after = WORKFLOW.replaceAll('\r\n', '\n').replace(from, to);
    expect(after, `mutation found nothing to change: ${String(from)}`).not.toBe(
      WORKFLOW.replaceAll('\r\n', '\n'),
    );
    return jobTextOf(readableYaml(after), JOB);
  };
  const DRIVE_RUN = '        run: pnpm webkit\n';

  it.each([
    ['`|| true` on the install line', /(webkit\))\n/, '$1 || true\n', /masks a failure/],
    ['`|| true` on the tests', DRIVE_RUN, '        run: pnpm webkit || true\n', /masks a failure/],
    ['`; exit 0` after the retry', /(webkit\))\n/, '$1; exit 0\n', /masks a failure/],
    ['`|| :` on the tests', DRIVE_RUN, '        run: pnpm webkit || :\n', /masks a failure/],
    [
      '`set +e` before the tests',
      DRIVE_RUN,
      '        run: set +e; pnpm webkit\n',
      /masks a failure/,
    ],
    [
      '`continue-on-error` on the tests',
      DRIVE_RUN,
      `${DRIVE_RUN}        continue-on-error: true\n`,
      /continue-on-error/,
    ],
    ['an `if:` on the tests', DRIVE_RUN, `        if: success()\n${DRIVE_RUN}`, /has an `if:`/],
    [
      'an `if:` on the install',
      '        id: install\n',
      "        id: install\n        if: github.event_name == 'push'\n",
      /has an `if:`/,
    ],
    [
      'a job-level `if:`',
      '    name: drive pdf.js under WebKit\n',
      "    name: drive pdf.js under WebKit\n    if: github.event_name == 'push'\n",
      /job-level `if:`/,
    ],
  ])('flags %s', (_what, from, to, expected) => {
    expect(neverGreenOffences(mutate(from, to)).join('\n')).toMatch(expected);
  });

  it('a commented-out `if:` is not an `if:` — it runs nothing', () => {
    expect(neverGreenOffences(mutate(DRIVE_RUN, `        # if: false\n${DRIVE_RUN}`))).toEqual([]);
  });

  it('flags the package cache keyed on the lockfile again, even beside a comment with the right key', () => {
    const job = mutate(
      /key: webkit-apt-\$\{\{ steps\.keys\.outputs\.image \}\}.*\n/,
      "key: webkit-apt-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }} # key: webkit-apt-${{ steps.keys.outputs.image }}-${{ steps.keys.outputs.playwright }}\n",
    );
    expect(cacheKeyOffences(job).join('\n')).toMatch(
      /system packages cache key does not change with `image`/,
    );
  });

  it('flags the browser cache losing the Playwright version', () => {
    const job = mutate(
      /(key: playwright-webkit-\$\{\{ steps\.keys\.outputs\.os \}\})-.*\n/,
      "$1-${{ hashFiles('pnpm-lock.yaml') }}\n",
    );
    expect(cacheKeyOffences(job).join('\n')).toMatch(
      /browser cache key does not change with `playwright`/,
    );
  });

  it('flags an explanation that could run on a green job, or that ignores whether the tests ran', () => {
    const script = read(EXPLAIN_SCRIPT);
    const always = mutate(/if: failure\(\) && (steps\.drive)/, 'if: always() && $1');
    expect(explainOffences(always, script).join('\n')).toMatch(/not failure-only/);
    const blind = mutate(/if: failure\(\) && .*\n/, 'if: failure()\n');
    expect(explainOffences(blind, script).join('\n')).toMatch(/whether the tests ran/);
  });

  it('flags an explanation script that exits 0 or stays quiet', () => {
    expect(
      explainOffences(
        JOB_TEXT,
        'echo "::error::No test ran" >> "$GITHUB_STEP_SUMMARY"\nexit 0\n',
      ).join('\n'),
    ).toMatch(/exit 0/);
    expect(explainOffences(JOB_TEXT, 'echo hi\nexit 1\n').join('\n')).toMatch(/::error/);
  });
});
