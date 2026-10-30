/**
 * Ask every keyless job feed the app ships whether it still answers (L-339).
 *
 * Usage, from the repository root:
 *
 *     pnpm canary:feeds
 *
 * Run once a day by `.github/workflows/feed-canary.yml`, and NEVER by
 * `pnpm verify` or `pnpm test`: it makes real requests to somebody else's free
 * service. The judgement lives in `feedCanary.ts`, which is unit-tested with no
 * network; this file is the shell that makes the requests and sets an exit code.
 *
 * ============================================================================
 * WHY VITE LOADS THE CHECKER, WHEN NODE RUNS THE OTHER SCRIPTS DIRECTLY
 * ============================================================================
 * `checkLNumbers.ts` and its siblings import nothing but their own `.ts` files,
 * which Node can run as they are. The canary's whole point is to use the app's
 * REAL reader from `@cviper/job-apis`, and the packages are source-only with
 * extensionless imports that only a bundler resolves. Vite is already what
 * compiles them for the app and for Vitest, so `runnerImport` loads the checker
 * through it, and the code under test is the code that ships.
 *
 * ============================================================================
 * A FAILED CHECK IS NEVER A PASS
 * ============================================================================
 * Any problem sets exit code 1, and anything that throws — a missing file, a
 * broken import — ends the process non-zero as well. There is no `catch` here
 * that turns an error into a green run.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runnerImport } from 'vite';

// Types only: the module itself is loaded through Vite below, never by Node.
import type * as FeedCanary from './feedCanary.ts';

type Canary = typeof FeedCanary;

/** The same timeout `keyless_fetch` gives a feed (`FEED_TIMEOUT`). */
const TIMEOUT_MS = 20_000;

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const { module: canary } = await runnerImport<Canary>(here('./feedCanary.ts'), {
  configFile: false,
  logLevel: 'error',
});

const rust = readFileSync(here('../../src-tauri/src/keyless.rs'), 'utf8');
const result = await canary.runFeedCanary(rust, canary.httpFeedFetcher(fetch, TIMEOUT_MS));

for (const verdict of result.verdicts) {
  const state = verdict.problems.length === 0 ? 'ok  ' : 'FAIL';
  console.log(
    `feed-canary: ${state} ${verdict.source}: ${verdict.fetched} advert(s) read, ` +
      `${verdict.usable} with a title and a link`,
  );
}

if (result.problems.length > 0) {
  console.error('');
  console.error('feed-canary: a keyless job feed is not answering the way the app needs.');
  console.error('');
  for (const problem of result.problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`feed-canary: all ${result.verdicts.length} keyless feed(s) answered.`);
}
