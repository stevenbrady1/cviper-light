# CLAUDE.md — @cviper/ai-providers

AI provider adapters: bring-your-own-key cloud providers and local Ollama.

Root rules in [../../CLAUDE.md](../../CLAUDE.md) apply in full. The HARD RULES
there are not negotiable from inside this package.

## This package is source-only

No `build` script. No `dist`. No compiled output — ever. Consumers import
`src/index.ts` directly; Vite compiles it, `tsc --noEmit` typechecks it,
Vitest runs it. If you find yourself adding a build step, stop: that is the
wrong shape for this repo.

## Verification

From the repo root — all four must pass:

```
pnpm tsc && pnpm lint && pnpm test && pnpm cargo:check
```

Scoped to just this package:

```
pnpm --filter @cviper/ai-providers typecheck
pnpm --filter @cviper/ai-providers lint
```

## Status

Phase 0: `src/index.ts` exports a placeholder only. No real implementation yet.

## Conventions

- **Never log, persist, or serialise an API key.** Keys come from the OS
  credential store (the `keyring` crate, via Tauri commands) and stay in memory.
- Every provider needs a failure path that is visible to the user. Never swallow
  an exception — log it, propagate it, or fall back explicitly.
- The app must stay useful with no provider configured. Keyword-only analysis is
  the always-available fallback, not an afterthought.
