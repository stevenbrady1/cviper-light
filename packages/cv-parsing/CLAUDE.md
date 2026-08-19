# CLAUDE.md — @cviper/cv-parsing

CV ingestion and structured extraction. Runs fully locally.

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
pnpm --filter @cviper/cv-parsing typecheck
pnpm --filter @cviper/cv-parsing lint
```

## Status

Phase 0: `src/index.ts` exports a placeholder only. No real implementation yet.

## Conventions

- Parsing is entirely local. A CV must never leave the machine from this package.
- User-supplied files are hostile input: malformed, truncated, wrong-format and
  enormous files all need explicit handling. This package ships negative and
  boundary tests by default.
