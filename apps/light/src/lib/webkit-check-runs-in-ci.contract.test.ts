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
