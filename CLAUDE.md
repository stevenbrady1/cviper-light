# CLAUDE.md — CViper Light

Tauri v2 desktop app in a pnpm + Turborepo monorepo. Local-first CV and
job-search tool. See [docs/PLAN.md](docs/PLAN.md) and
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md).

## HARD RULES — violating any of these fails the task

1. **NEVER run `tauri build` or `cargo build --release`.** Verify with
   `cargo check` only. Full builds are human/CI-only.
2. **NEVER edit `src-tauri/gen/` or any `target/` folder.** They are generated.
3. **pnpm only.** Never npm or yarn for project operations.
4. **TypeScript strict mode.** Never weaken `tsconfig.base.json` to make a check
   pass.
5. **Conventional commits.**
6. **Tauri v2 CAPABILITIES** (`src-tauri/capabilities/*.json`). Never v1
   allowlist syntax.

## Verification loop

All six must pass before anything is called done. Run from the repo root:

```
pnpm format:check # prettier --check .   — `pnpm format` fixes what it reports
pnpm tsc          # turbo run typecheck  — tsc --noEmit in every package
pnpm lint         # turbo run lint       — eslint, --max-warnings 0
pnpm test         # vitest run
pnpm cargo:check  # cargo check on apps/light/src-tauri
pnpm cargo:test   # cargo test --lib on apps/light/src-tauri
```

`pnpm verify` runs all six in sequence, cheapest first.

That list is exactly what the CI `verify` job runs, and it is kept that way by
`apps/light/src/lib/verify-loop-matches-ci.contract.test.ts`, which reads
`.github/workflows/ci.yml` and the root `package.json` and fails if the job runs
a check the script does not. This said five for months while CI quietly ran a
sixth: all five green locally, then a five-minute build lost to `format:check`
(L-98). A loop that under-reports is worse than no loop, because it is believed.

`cargo:check` does NOT compile `#[cfg(test)]` code, so it cannot run — or even
typecheck — a single Rust test. Without `cargo:test` in the loop, every Rust
test in the repo is a guard that looks green because nothing ever asked it a
question.

Never commit red. Never skip a check. Never weaken a config to make a check
pass — if a guard fails, fix the thing it is protecting.

## Layout

```
apps/light           Tauri v2 desktop app (React + Vite + Tailwind 4)
apps/cloud           Stub. Nothing here. Do not build anything in it.
packages/core-types  Shared domain types
packages/ai-providers  BYO-key and local Ollama adapters
packages/job-apis    Adzuna / Reed clients, keyless search links
packages/cv-parsing  CV ingestion and extraction
packages/ui          Shared presentational components
docs/                Plan and feature matrix
```

## Conventions that bite

- **Packages are source-only and are NEVER built.** No `build` script, no
  `dist`, no compiled output. Vite compiles them from source, `tsc --noEmit`
  typechecks them, Vitest runs them directly. Only `apps/light` has a `build`.
- **`turbo.json` v2 uses the top-level key `tasks`, not `pipeline`.**
- **Tailwind 4 has no `tailwind.config.js` and no PostCSS step.** It is the
  `@tailwindcss/vite` plugin. Theme tokens live in
  `apps/light/src/styles/theme.css` under `@theme { }`. Never run
  `npx tailwindcss init`.
- **`tauri-plugin-sql` needs `features = ["sqlite"]`.** `pnpm tauri add sql`
  does NOT add a database backend, and the plugin is inert without one.
- **`sql:default` does not include `sql:allow-execute`.** Without it every
  INSERT/UPDATE fails. Likewise `dialog:default` excludes `dialog:allow-ask` and
  `dialog:allow-confirm`. All three are pinned in
  `apps/light/src-tauri/capabilities/default.json` — do not remove them.
- **There is no official Tauri keyring plugin.** We use the `keyring` crate
  directly and write our own commands. The crates.io lookalike is abandoned.
- **`pnpm tauri add <x>` edits three places**: `Cargo.toml`, `src-tauri/src/lib.rs`
  and `capabilities/default.json`. Inspect every diff — it does not always get
  them consistent with each other.
- **Do not run `pnpm tauri dev` in an agent session.** It opens a GUI window and
  blocks.

## Testing

TDD. Write the failing test first, then the minimal code to pass. Bug fixes
start with a reproducing test — no exceptions. Code that handles user input
ships with at least one negative test and one boundary test, never happy-path
only.

Vitest still runs with `passWithNoTests: true`. It is no longer a vacuous gate —
every package with logic has tests, and `packages/ui` is the only one left
without — but the flag means a package whose tests stop being COLLECTED reports
green rather than red. If a suite's count drops, look at the collection glob
before believing the tests were deleted.
