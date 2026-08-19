# CLAUDE.md — @cviper/core-types

Shared domain types for CViper Light. The single source of truth for the data model.

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
pnpm --filter @cviper/core-types typecheck
pnpm --filter @cviper/core-types lint
```

## Status

Phase 0: `src/index.ts` exports a placeholder only. No real implementation yet.

## Conventions

- Types only. No runtime logic, no I/O, no dependencies on other `@cviper/*`
  packages — this is the bottom of the dependency graph and must stay there.
- Every other package may depend on this one. This one depends on nothing.
