/**
 * Which AI providers this app can actually SET UP — the key cards, as a value.
 *
 * ============================================================================
 * THE ONE LIST THAT DECIDES WHAT IS OFFERED (L-102)
 * ============================================================================
 * `analysis/providers.ts` reads this to decide which cloud providers may appear
 * in a picker at all. The rule it encodes is "offer only what the user can set
 * up": a provider whose key can be READ but never PASTED is a dead end with a
 * price tag, and the app used to offer exactly one of those — Anthropic, whose
 * key survives in the OS credential store long after the build that wrote it.
 *
 * Because the list is READ rather than restated, adding a second card switches
 * its option back on by itself, and
 * `analysis/offeredProviders.contract.test.ts` ties this list to the
 * `AiKeyProvider` cards that really exist so it cannot drift from them.
 *
 * ============================================================================
 * WHY THIS IS ITS OWN FILE, AND WHY ITS ONLY IMPORT IS A TYPE
 * ============================================================================
 * The obvious home is `aiKeyModel.ts`, next to the cards. It cannot go there:
 * `aiKeyModel.ts` imports `OPENAI_DEFAULT_MODEL` from `analysis/providers.ts`,
 * so having `analysis/providers.ts` import a VALUE back would close an ES module
 * cycle — and this cycle is not cosmetic. `aiKeyModel.ts` reads that constant at
 * MODULE-EVALUATION time to build `OPENAI_KEY_PROVIDER`, so whichever module is
 * entered first leaves the other's `const` in the temporal dead zone and the
 * import throws `ReferenceError: Cannot access 'OPENAI_DEFAULT_MODEL' before
 * initialization`.
 *
 * The `import type` below is therefore load-bearing and must stay in that exact
 * form. `tsconfig.base.json` sets `verbatimModuleSyntax: true`, under which a
 * top-level `import type` is erased ENTIRELY, while the inline spelling
 * `import { type AiKeyProviderId }` would emit `import {} from './aiKeyModel'`
 * — a real runtime edge, and the cycle back again. Same characters to a reader,
 * a crash on startup to the bundler.
 */
// LOAD-BEARING, and invisible if you change it: `import type`, never the inline
// `import { type AiKeyProviderId }`. `verbatimModuleSyntax` is on, so the inline
// spelling still emits `import {} from './aiKeyModel'` — a real runtime edge,
// which puts the startup cycle described above straight back. The two spellings
// read the same to a person and differ by a crash to the bundler.
import type { AiKeyProviderId } from './aiKeyModel';

/**
 * The set of AI key cards, as a value, because the decision "may this be
 * offered?" happens at runtime in `providerOptions` and a type cannot answer it.
 *
 * `satisfies` rather than a plain annotation: the literal tuple type survives,
 * so an id that is not an `AiKeyProviderId` is a compile error right here —
 * this list can never name a provider the card model has never heard of.
 */
export const AI_KEY_PROVIDER_IDS = ['openai'] as const satisfies readonly AiKeyProviderId[];
