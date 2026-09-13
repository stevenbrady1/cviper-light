/**
 * The one place `zod` is imported, configured before it is handed on (L-112).
 *
 * ============================================================================
 * WHAT THIS FIXES
 * ============================================================================
 * Zod 4 decides whether to JIT-compile a validator by running `new Function("")`
 * inside a try/catch. The packaged app's Content-Security-Policy is
 * `script-src 'self'`, which refuses that; zod catches the `EvalError` and
 * quietly uses its interpreted validator instead, so nothing breaks — and the
 * browser records a real `securitypolicyviolation` during first paint, on every
 * single launch, before the user has touched anything.
 *
 * For a local-first app whose whole promise is a policy an auditor can read,
 * that is not cosmetic: the product was telling the browser a different story
 * from the one it tells the user, and the refusal is the first thing anyone
 * looking would see.
 *
 * `jitless` removes it at the source. Zod's `allowsEval` returns `false`
 * WITHOUT probing when the flag is set, so the `new Function` is never reached
 * and there is nothing for the policy to refuse. The cost is honest and small:
 * every schema runs interpreted. It already was — the probe has been failing in
 * the packaged app since the day the policy was written.
 *
 * ============================================================================
 * WHY EVERY SCHEMA MUST IMPORT `z` FROM HERE
 * ============================================================================
 * The flag is read while a schema is BEING CONSTRUCTED, not when it parses:
 * `$ZodObject`'s initialiser evaluates `!globalConfig.jitless && allowsEval.value`
 * once, as the object is built. A schema constructed before `z.config` runs has
 * already fired the probe, and no amount of configuring afterwards takes it back.
 *
 * So the ordering is the fix, and ES module semantics are what enforce it: a
 * module's dependencies are fully evaluated before its own body runs. Import `z`
 * from here and the call below has already happened. Import it from `'zod'` and
 * it has not.
 *
 * That is a property of the import graph, which means it can be broken by one
 * line in a new file with nothing at runtime to complain. Three checks hold it:
 *
 *   - `apps/light/src/lib/no-direct-zod-imports.contract.test.ts` fails if any
 *     shipped file names `zod` except this one — and fails if this one stops
 *     configuring anything.
 *   - `zod.test.ts` here, and its twin in `@cviper/resume-schema`, read zod's own
 *     memoisation state after loading the package to prove the probe never ran.
 *   - `apps/light/e2e/pdfjs-webkit.spec.ts` drives a real WebKit browser under
 *     the real policy and fails on any refusal at all.
 *
 * ============================================================================
 * WHY IT LIVES IN `@cviper/core-types`
 * ============================================================================
 * `core-types` is the bottom of the dependency graph, and `@cviper/resume-schema`
 * — the only other package that builds schemas — already depends on it. Putting
 * the module here reaches both without inventing a package, and without
 * `resume-schema` gaining a dependency it did not already have.
 */
import { z } from 'zod';

// Before any schema in this package or any other is constructed. This statement
// is the entire point of the module: everything else here is a re-export.
z.config({ jitless: true });

export { z };
