/**
 * The single-zod-entry contract: no shipped file imports `zod` directly.
 *
 * ============================================================================
 * WHY THIS EXISTS (L-112)
 * ============================================================================
 * Zod 4 decides whether to JIT-compile a validator by running `new Function("")`
 * inside a try/catch. Under the packaged app's `script-src 'self'` that is
 * refused, zod swallows the `EvalError` and quietly uses its interpreted path —
 * and the browser records a real `securitypolicyviolation` on every launch, in a
 * product whose whole pitch is the policy it can point at.
 *
 * `z.config({ jitless: true })` removes it, because `allowsEval` returns `false`
 * without probing when `jitless` is set. But the setting is read while a schema
 * is BEING BUILT — `$ZodObject`'s initialiser reads it once, at construction —
 * so it has to be in place before the first schema object exists.
 *
 * What guarantees that is import order, and the only way to keep import order
 * guaranteed is to leave nobody a second door: every schema file imports `z`
 * from `packages/core-types/src/zod.ts`, which configures zod and re-exports it,
 * and ES modules evaluate a dependency before the module importing it. One file
 * that says `import { z } from 'zod'` instead puts its schemas outside that
 * order, with nothing at runtime to say so — the app still works, and the
 * refusal simply comes back.
 *
 * ============================================================================
 * THREE LAYERS, NOT ONE
 * ============================================================================
 * This guard is the STATIC layer: it can name the offending file and the line.
 * `packages/core-types/src/zod.test.ts` and its twin in `resume-schema` are the
 * RUNTIME layer: they read zod's own memoisation state to prove the probe never
 * ran. `apps/light/e2e/pdfjs-webkit.spec.ts` is the END layer: it watches a real
 * WebKit browser under the real policy and fails on any refusal at all. A guard
 * on its own would pass a file that imports the right module and then builds a
 * schema from a `z` it got some other way; a runtime check on its own would pass
 * a package nobody imported that day.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * The rule is "the `zod` specifier must be ABSENT from every shipped file except
 * one", not "these files are allowed to import it". A new schema file needs no
 * entry here; it simply must not open the second door.
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

/**
 * THE one file allowed to name `zod`, as a repository-relative path.
 *
 * If this module moves, move this string with it — and check that every package
 * that imports it can still legitimately reach it. `resume-schema` already
 * depends on `@cviper/core-types`, which is why the module lives there and not
 * in a new package invented for it.
 */
export const ZOD_ENTRY_POINT = 'packages/core-types/src/zod.ts';

/** What that module must actually do. A re-export that configures nothing is the
 * same defect wearing this guard's approval. */
export const REQUIRED_CONFIG_CALL = /\bz\.config\(\s*\{[^}]*\bjitless\s*:\s*true\b/;

/**
 * Every way a TypeScript file can name the `zod` package.
 *
 * `from 'zod'` and `from 'zod/v4/core'` alike: a subpath is the same package and
 * the same `globalConfig`, so a schema built from `zod/v4` would sit outside the
 * order just as surely. Static `import`, `export … from`, dynamic `import()` and
 * `require()` are all covered, because all four evaluate the module.
 */
const ZOD_SPECIFIER = /(?:from|import|require)\s*\(?\s*(['"])zod(?:\/[^'"]*)?\1/g;

export function zodImportsIn(source: string): string[] {
  return [...source.matchAll(ZOD_SPECIFIER)].map((match) => match[0]);
}

/** Shipped TypeScript across the whole monorepo. Tests are excluded by `walk`:
 * a test may import zod directly to make a point about zod, and several do. */
const SHIPPED_TS = [
  ...walk(join(REPO_ROOT, 'apps'), { extensions: ['.ts', '.tsx'] }),
  ...walk(join(REPO_ROOT, 'packages'), { extensions: ['.ts', '.tsx'] }),
];

describe('the scanner sees the tree it claims to scan', () => {
  // Anti-inert. Every assertion below is of the form "nothing was found", which
  // an empty file list satisfies perfectly. So the count is asserted, the ONE
  // legitimate hit is asserted to be found, and the matcher is shown to fire and
  // to leave adjacent honest names alone.
  it('walks a real number of shipped TypeScript files', () => {
    expect(SHIPPED_TS.length).toBeGreaterThan(50);
  });

  it('matches every shape of zod import, and nothing adjacent', () => {
    expect(zodImportsIn(`import { z } from 'zod';`)).toHaveLength(1);
    expect(zodImportsIn(`import { z } from "zod";`)).toHaveLength(1);
    expect(zodImportsIn(`import { globalConfig } from 'zod/v4/core';`)).toHaveLength(1);
    expect(zodImportsIn(`export { z } from 'zod';`)).toHaveLength(1);
    expect(zodImportsIn(`const { z } = await import('zod');`)).toHaveLength(1);
    expect(zodImportsIn(`const { z } = require('zod');`)).toHaveLength(1);
    // Honest neighbours must walk through: a guard that fires on a package
    // whose name merely contains "zod" is a guard that gets deleted.
    expect(zodImportsIn(`import x from 'zod-to-json-schema';`)).toEqual([]);
    expect(zodImportsIn(`import x from '@cviper/core-types/zod';`)).toEqual([]);
    expect(zodImportsIn(`import { z } from './zod';`)).toEqual([]);
  });

  it('finds the one entry point that IS allowed to import zod', () => {
    // The load-bearing anti-inert assertion: if the walk silently stopped
    // covering `packages/`, this fails rather than reporting a clean tree.
    const found = SHIPPED_TS.filter((file) => zodImportsIn(shippedText(file)).length > 0).map(
      displayPath,
    );
    expect(found).toContain(ZOD_ENTRY_POINT);
  });
});

describe('zod is reached through exactly one module', () => {
  it('is imported by no shipped file but that one', () => {
    const offenders = SHIPPED_TS.filter((file) => displayPath(file) !== ZOD_ENTRY_POINT)
      .flatMap((file) =>
        zodImportsIn(shippedText(file)).map((hit) => `${displayPath(file)}: ${hit}`),
      )
      .sort();
    expect(offenders).toEqual([]);
  });

  it('and that module configures zod rather than merely passing it on', () => {
    // Comments stripped first. The docblock explaining the fix names the call
    // it makes, and a guard satisfied by its own documentation is no guard —
    // that is how the prose outlives the code it describes.
    expect(shippedText(join(REPO_ROOT, ZOD_ENTRY_POINT))).toMatch(REQUIRED_CONFIG_CALL);
  });
});
