# CLAUDE.md — @cviper/ui

Shared presentational components.

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
pnpm --filter @cviper/ui typecheck
pnpm --filter @cviper/ui lint
```

## Status

Phase 0: `src/index.ts` exports a placeholder only. No real implementation yet.

## Conventions

- Styling is Tailwind 4 utilities plus tokens from
  `apps/light/src/styles/theme.css`. No new UI libraries. No inline styles.
- Presentational only — no data fetching, no Tauri `invoke` calls. Components
  take props and render.
- Any component with an event handler needs at least one interaction test that
  asserts the side effect. A render-only test is not enough.
