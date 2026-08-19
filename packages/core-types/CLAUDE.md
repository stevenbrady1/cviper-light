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

Phase 1a: the four entity types and their Zod schemas (`entities.ts`), the flat
analysis schema in both representations (`analysis.ts`), `Result` (`result.ts`)
and the v1 export/import format (`backup.ts`). Covered by 37 tests.

## Conventions

- Types, schemas and pure functions. **No I/O of any kind** — no filesystem, no
  network, no database. Callers do the reading and writing; this package only
  transforms values.
- No dependencies on other `@cviper/*` packages: this is the bottom of the
  dependency graph and must stay there. `zod` is the only external dependency.
- Every other package may depend on this one.
- **Nothing throws across a boundary.** Anything that can fail returns
  `Result<T, E>` so the caller cannot forget the failure path.
- **The export format is additive-only, forever.** Read the rules in
  [../../docs/FEATURE-MATRIX.md](../../docs/FEATURE-MATRIX.md) before touching
  `backup.ts` or any entity field.
