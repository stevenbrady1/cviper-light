/**
 * Is zod configured BEFORE the first schema is constructed? (L-112)
 *
 * ============================================================================
 * WHAT WENT WRONG
 * ============================================================================
 * Zod 4 decides whether to JIT-compile a validator by running `new Function("")`
 * inside a try/catch. Under the packaged app's `script-src 'self'` that is
 * refused; zod swallows the `EvalError` and falls back to its interpreted path,
 * so nothing breaks — and the browser records a real `securitypolicyviolation`
 * on every launch of a product whose whole pitch is the policy it can point at.
 * `apps/light/e2e/pdfjs-webkit.spec.ts` is what found it.
 *
 * `z.config({ jitless: true })` removes it, because zod's `allowsEval` returns
 * `false` without probing when `jitless` is set. But the setting is only
 * consulted while a schema is being BUILT: `$ZodObject`'s initialiser reads
 * `const fastEnabled = !globalConfig.jitless && util.allowsEval.value` once, at
 * construction. Configure zod one line too late and every schema built before
 * that line has already fired the probe.
 *
 * ============================================================================
 * WHY THIS IS A TEST AND NOT A COMMENT
 * ============================================================================
 * The ordering guarantee is real — every schema module imports `z` from
 * `./zod`, and ES modules evaluate a dependency before the module that imports
 * it — but "the imports are arranged correctly" is exactly the kind of claim
 * that stays written down after it stops being true. One `import { z } from
 * 'zod'` added to a new schema file, and the probe is back with nothing to say
 * so. `no-direct-zod-imports.contract.test.ts` guards the arrangement
 * statically; this file checks the OUTCOME at runtime, against zod itself.
 *
 * ============================================================================
 * HOW THE PROBE IS DETECTED
 * ============================================================================
 * `util.allowsEval` is built by zod's `cached()`: an object whose `value` starts
 * as a GETTER and, the first time it is read, replaces itself with a plain data
 * property holding the answer. So the shape of that one property descriptor is a
 * record of whether anything ever asked — no instrumentation, no monkey-patching,
 * and nothing this test has to keep in step with zod's internals beyond the fact
 * that `cached()` memoises. The last test in this file proves the detector by
 * reading the value and watching the shape change.
 */
import { describe, expect, it } from 'vitest';
import { globalConfig, util } from 'zod/v4/core';

// Imported for its SIDE EFFECT, and it must be the only thing this file pulls
// in from the package. Evaluating the entry point constructs every schema
// `@cviper/core-types` exports — which is the event under test.
import './index';

/**
 * Whether zod's `new Function("")` probe has been evaluated in this process.
 *
 * Throws rather than guessing if the property is not there at all: `cached()`
 * changing shape would make a silent `'not-run'` the wrong answer for the whole
 * file, and a test that cannot tell is a test that must say so.
 */
function probeState(): 'evaluated' | 'never-asked' {
  const descriptor = Object.getOwnPropertyDescriptor(util.allowsEval, 'value');
  if (descriptor === undefined) {
    throw new Error(
      "zod's `util.allowsEval` has no own `value` property any more. Its `cached()` helper has " +
        'changed shape, so this file can no longer tell whether the eval probe ran. Read ' +
        'zod/v4/core/util and rewrite the detector — do not delete it.',
    );
  }
  return typeof descriptor.get === 'function' ? 'never-asked' : 'evaluated';
}

describe('zod is configured jitless before core-types builds a schema', () => {
  it('has jitless set by the time the package has finished loading', () => {
    expect(globalConfig.jitless).toBe(true);
  });

  it('never let zod reach the eval probe — so no securitypolicyviolation is raised', () => {
    // The real assertion of this file. If a schema module ever imports `z`
    // straight from 'zod', it is constructed before `./zod` has configured
    // anything, `fastEnabled` reads `util.allowsEval.value`, and this flips.
    expect(probeState()).toBe('never-asked');
  });

  it('still parses — the interpreted path is the one users get', async () => {
    // jitless is not free: every schema now runs interpreted. That is the whole
    // axis this change moves, so one end-to-end parse is asserted here as well
    // as in the schema suites.
    const { CvSchema } = await import('./index');
    const parsed = CvSchema.safeParse({
      id: 'cv-1',
      name: 'Test CV',
      file_path: null,
      extracted_text: 'Senior Credit Risk Analyst',
      created_at: '2026-01-01T00:00:00.000Z',
      json_resume: null,
    });
    expect(parsed.success).toBe(true);
    // Negative: a missing required field must still be refused when the
    // validator is interpreted rather than compiled.
    expect(CvSchema.safeParse({ id: 'cv-1' }).success).toBe(false);
  });

  it('LAST: reading the probe proves the detector above can tell the difference', () => {
    // Everything above asserts the probe was never asked. On its own that is
    // satisfied just as well by a detector that says 'never-asked' whatever
    // happens — the shape of a guard that passes while inspecting nothing. So
    // the file ends by asking, and watching the answer change.
    //
    // It runs LAST because the memoisation is permanent: once read, it stays
    // read for the rest of this module registry. Vitest isolates test files, so
    // this cannot reach the assertions in any other suite.
    expect(util.allowsEval.value).toBe(false);
    expect(probeState()).toBe('evaluated');
  });
});
