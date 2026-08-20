import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const resolveFromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * Options that must reach EVERY project. Declared once, here.
 *
 * `testTimeout` is 15s rather than Vitest's 5s default because the failures
 * this machine actually produces are load failures, not assertion failures — an
 * on-access virus scanner intermittently starves the worker pool and a test
 * that normally finishes in milliseconds blows the 5s budget. The extra headroom
 * costs nothing on a healthy run: a passing test returns when it returns, and
 * only a genuinely hung one waits out the full timeout.
 */
const sharedProjectConfig = {
  testTimeout: 15_000,
};

/**
 * Why the projects are built here instead of left as the glob
 * `['packages/*', 'apps/light']`:
 *
 * A project declared as a GLOB STRING inherits nothing from this file. Vitest
 * forwards only CLI overrides to glob-derived projects (see `resolveProjects`
 * in vitest/dist/chunks/cli-api — glob matches are initialised with
 * `test: cliOverrides` and nothing else), so a `testTimeout` sitting in the
 * `test` block above would be silently inert in all seven projects. It reads as
 * applied and is not. Only an INLINE project entry inherits, and only through
 * `extends`.
 *
 * The directory scan keeps the auto-discovery the glob gave us: a new package
 * becomes a project without anyone editing this file, so its tests can never go
 * uncollected — the silent-green failure mode CLAUDE.md warns about.
 */
const CONFIG_FILENAMES = ['vitest.config.ts', 'vite.config.ts'];

/**
 * The project's package.json name — `@cviper/job-apis` and friends.
 *
 * Vitest labels a DIRECTORY project with this automatically, but labels an
 * INLINE project with its array index, so moving to inline entries would have
 * turned every report line into `|0|`, `|1|`. Naming them back keeps a failure
 * attributable to a package at a glance.
 */
function packageName(root: string): string {
  const manifest: unknown = JSON.parse(
    readFileSync(resolveFromHere(`${root}/package.json`), 'utf8'),
  );
  const name = (manifest as { name?: unknown }).name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${root}/package.json has no usable "name" to label its Vitest project with.`);
  }
  return name;
}

function project(root: string) {
  // `extends` is what loads a project's own config. Omitting it sets
  // `configFile: false`, which is right for the packages (they have no config)
  // and would silently strip apps/light of its React plugin, jsdom opt-in and
  // include glob. Detected rather than hardcoded so a package that gains a
  // config later is honoured instead of ignored.
  const ownConfig = CONFIG_FILENAMES.map((name) => `${root}/${name}`).find((path) =>
    existsSync(resolveFromHere(path)),
  );

  // A project with its own config names itself (apps/light declares `light`);
  // don't overwrite that from here.
  return ownConfig
    ? { extends: ownConfig, root, test: { ...sharedProjectConfig } }
    : { root, test: { ...sharedProjectConfig, name: packageName(root) } };
}

const packageRoots = readdirSync(resolveFromHere('./packages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `./packages/${entry.name}`);

// Vitest 4: `vitest.workspace.ts` was removed. Multi-package runs are declared
// via `test.projects` (introduced in Vitest 3.2). Installed major is 4.x, so
// this is the correct and only supported form here.
export default defineConfig({
  test: {
    // The stub packages (ai-providers, job-apis, cv-parsing, ui) still export
    // nothing but a name, so they legitimately have no tests. core-types and
    // apps/light do, and a project that has real logic must have real tests
    // with it.
    passWithNoTests: true,
    projects: [...packageRoots, './apps/light'].map(project),
  },
});
