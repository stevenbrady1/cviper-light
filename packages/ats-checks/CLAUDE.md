# CLAUDE.md — @cviper/ats-checks

Text-only ATS readiness checks: standard section headings, CV length, contact
details and bullet strength. Pure, synchronous and offline — no model, no
network, no Tauri. The ATS Score step (L-198) runs them on the original CV and
on the tailored one and shows before → after.

Root rules in [../../CLAUDE.md](../../CLAUDE.md) apply in full. The HARD RULES
there are not negotiable from inside this package.

## These are PORTS, held to the Python by measurement

Every check is a fidelity port of the CViper web app's Python, and each file's
header names the source and the commit it was taken from. `src/parity.test.ts`
holds the port to the Python case for case; its expectations were produced by
RUNNING the Python, not by predicting it. If a case starts failing, the port has
drifted: re-measure against the Python before changing a single expectation.

Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`. When the
Python changes, that guard fails there, which is the signal to re-measure here.

Python's `re` is Unicode-aware by default and JavaScript's is not, so `\d`,
`\w`, `\b` and `\s` are spelled out (`\p{Nd}`, `\p{L}\p{N}_`, an explicit
boundary, Python's own whitespace set). `round()` is Python's half-to-even,
via `pythonRound`. The parity cases include probes for each of these.

## This package is source-only

No `build` script. No `dist`. Consumers import `src/index.ts` directly.

## Verification

From the repo root: `pnpm verify`. Scoped to this package:

```
pnpm --filter @cviper/ats-checks typecheck
pnpm --filter @cviper/ats-checks lint
npx vitest run packages/ats-checks
```
