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

From the repo root — all five must pass:

```
pnpm verify
```

Scoped to just this package:

```
pnpm --filter @cviper/job-apis typecheck
pnpm --filter @cviper/job-apis lint
```

## Status

Built: Adzuna and Reed request building and response normalisation, cross-post
fingerprinting, keyless browser links, the daily request budget, and the
`searchJobs` orchestrator. No UI renders any of it yet.

## What is a PORT and what is not

`params.ts`, `normalise.ts`, `reed-salary.ts`, `reed-contract.ts` and
`fingerprint.ts` are ports from `backend/job_sites_api.py` and
`backend/helpers/dedupe_fingerprint.py` in the CViper web application. Comments
copied verbatim from the source are marked as such — they explain why a rule is
shaped the way it is, and they are what stops the next reader "fixing" a
deliberate decision back into a bug. Three in particular:

- the bare word "contract" is ABSENT from `REED_CONTRACT_SIGNALS` on purpose;
- `normaliseTokens` lowercases TWICE on purpose;
- `salary_period` is data, not prose, on purpose.

Deliberately not ported: `_tag_affiliate_url` (no tracking on outbound links),
the `LinkedInAPI` guest-endpoint scraper (URL construction only), and the
`_LANE_TABLES` accumulator (a CPython loop-speed workaround).

Deliberately changed: duplicates are FLAGGED, never merged. See
`clusters.ts` and docs/FEATURE-MATRIX.md.

## Conventions

- Keyless search links must work with no credentials at all. That path is the
  default, not the degraded mode.
- Treat every API response as untrusted: validate shape before use. These are
  third-party feeds and they change without notice.
- Rate limits and quota errors are expected states, not crashes.
