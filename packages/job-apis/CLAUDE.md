# CLAUDE.md — @cviper/job-apis

Job board clients (Adzuna, Reed) and keyless browser search links.

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
pnpm --filter @cviper/job-apis typecheck
pnpm --filter @cviper/job-apis lint
```

## Status

Phase 0: `src/index.ts` exports a placeholder only. No real implementation yet.

## Conventions

- Keyless search links must work with no credentials at all. That path is the
  default, not the degraded mode.
- Treat every API response as untrusted: validate shape before use. These are
  third-party feeds and they change without notice.
- Rate limits and quota errors are expected states, not crashes.
