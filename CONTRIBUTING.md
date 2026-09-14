# Contributing

CViper Light is a pnpm + Turborepo monorepo around a Tauri v2 desktop app.
Read [CLAUDE.md](CLAUDE.md) first — it is short, it is enforced, and it names
the toolchain traps that will otherwise cost you an afternoon. This file is
the working agreement: how a change is verified, how a work item gets its
number, and what a commit looks like.

## Setup

- Node 22+ and pnpm 11 (`packageManager` is pinned in `package.json`), Rust
  stable, and the [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/)
  for your platform.
- `corepack enable pnpm`, then `pnpm install`.
- **pnpm only.** Never `npm` or `yarn` for anything in this repository.

## The hard rules

Violating any of these fails the task, whoever or whatever is doing it:

1. Never run `tauri build` or `cargo build --release` as part of routine work.
   Verify with `cargo check`; full builds are for humans and CI.
2. Never edit `src-tauri/gen/` or any `target/` folder. They are generated.
3. pnpm only.
4. TypeScript strict mode. Never weaken `tsconfig.base.json` to make a check
   pass.
5. Conventional commits (below).
6. Tauri v2 capabilities (`src-tauri/capabilities/*.json`), never v1 allowlist
   syntax.

And one that is not a rule about code: **never generate or regenerate the
updater signing key.** It is real, its private half is in the repository
secrets, and the app has no revocation path — a new key would cut every
installed copy off from every future update, permanently.

## The verification loop

All seven must pass before anything is called done, run from the repo root:

```
pnpm tsc          # turbo run typecheck  — tsc --noEmit in every package
pnpm lint         # turbo run lint       — eslint, --max-warnings 0
pnpm test         # vitest run
pnpm cargo:check  # cargo check on apps/light/src-tauri
pnpm cargo:test   # cargo test on apps/light/src-tauri — unit AND doc tests
pnpm build        # the production Vite bundle — NOT `tauri build`
pnpm format:check # prettier --check .   — `pnpm format` fixes what it reports
```

`pnpm verify` runs all seven in CI's order. That list is exactly what the CI
`verify` job runs, and `verify-loop-matches-ci.contract.test.ts` fails the
build if the two drift apart — the loop once said five while CI ran seven, and
a loop that under-reports is worse than none because it is believed.

Two checks are deliberately outside the loop because they need something a
contributor may not have: `pnpm smoke` drives the built Windows binary
(CI: `smoke.yml`), and `pnpm webkit` drives the app's pdf.js under Playwright's
WebKit after a ~60 MB browser download (CI: the `webkit` job). Both run in CI,
and both have a contract test that fails if their job disappears.

Never commit red. Never skip a check. Never weaken a config to make a check
pass — if a guard fails, fix the thing it is protecting.

## Tests come first

TDD is the rule, not the aspiration:

- Write the failing test first, then the minimal code that makes it pass.
- Bug fixes start with a reproducing test. No exceptions.
- Code that handles user input ships with at least one negative test and one
  boundary test, never happy-path only.
- Guards are forbid-lists: a check encodes "Y must be absent", never "X must
  be present", so it stays true as the product changes instead of rotting into
  a shape somebody satisfies with a comment. The docblock at the top of any
  `*.contract.test.ts` under `apps/light/src/lib/` shows the house style.
- Vitest runs with `passWithNoTests: true`. If a suite's count drops, look at
  the collection glob before believing the tests were deleted.

The documentation is tested too. Several guards read `README.md` and the files
under `docs/` — for a privacy claim that is wider than the code keeps, for an
AI provider's brand name on a product-level surface, for the privacy-policy
address being spelled two ways. If a doc-reading test goes red after you edit
prose, your wording contradicts the code: fix the wording, not the test.

## Claiming a work-item number

Work items are numbered `L-NNN`. A number is claimed by creating a GitHub
issue whose title **starts** with it in square brackets:

```
gh issue create --title "[L-104] One line saying what it is"
```

- The issue's own number is not the L-number. GitHub hands issue numbers out
  in the order things happen and shares them with pull requests; an L-number
  is a planning identifier a person chooses.
- The next free number is the highest already claimed, plus one — read from
  the issue list, not from a file.
- A pull request _references_ a number; only the bracketed form at the start
  of an issue title _claims_ one. PR titles end `(L-NNN)`.
- Nothing prevents two people claiming the same number in the same minute.
  What is prevented is the collision going unnoticed: `pnpm check:l-numbers`
  runs in its own CI job on every push and fails on any duplicate, so the
  loser renames and moves their branch and pull request with them. The logic
  and the reasoning live in `apps/light/src/numbering/lNumbers.ts`; the full
  account is in [docs/PLAN.md](docs/PLAN.md) under "Item numbers".

## Branches and commits

Branches are named after the item — `feat/L-164-readme-proof`,
`fix/L-107-cargo-test-doctests`. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/) with the item
number as a suffix in parentheses:

```
feat: consent gate before a CV reaches a cloud provider (L-97)
fix: cargo:test runs doc-tests as well as unit tests (L-107)
docs: README opens with who made it and what it proves (L-164)
```

One concern per pull request. Say in the description what was verified and
how; a change whose only demonstration is an input the real code path never
receives will be asked for a real one.

## Layout, and the conventions that bite

```
apps/light             Tauri v2 desktop app (React + Vite + Tailwind 4)
apps/cloud             Stub. Nothing here. Do not build anything in it.
packages/core-types    Shared domain types, export/import format
packages/ai-providers  BYO-key and local Ollama adapters
packages/job-apis      Adzuna / Reed clients, keyless feeds and links
packages/cv-parsing    CV ingestion and extraction
packages/keyword-scoring  The no-AI CV match
packages/resume-schema JSON Resume: read, flatten, write back
packages/ui            Shared presentational components
docs/                  Plan and feature matrix
```

- **Packages are source-only and are never built.** No `build` script, no
  `dist`, no compiled output. Vite compiles them from source, `tsc --noEmit`
  typechecks them, Vitest runs them directly. Only `apps/light` has a build.
- Tailwind 4 has no `tailwind.config.js` and no PostCSS step; theme tokens
  live in `apps/light/src/styles/theme.css`.
- `pnpm tauri add <x>` edits three places (`Cargo.toml`, `lib.rs`, the
  capability file) and does not always keep them consistent. Inspect every
  diff.
- Do not run `pnpm tauri dev` in an unattended session: it opens a window and
  blocks.

The rest of the traps are in [CLAUDE.md](CLAUDE.md), each with the incident
that earned it a line.

## Security findings

Not the issue tracker. [SECURITY.md](SECURITY.md) has the private reporting
route and the threat model.
