# CViper Light

A local-first desktop app for CV work and job search. Tauri v2, React, SQLite on
your own machine. No account, no sync, no telemetry.

**Status: Phase 0 (Scaffold).** The workspace, toolchain and app shell exist.
No product features are built yet — see
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md) for the honest per-feature
state, and [docs/PLAN.md](docs/PLAN.md) for the build plan.

## Requirements

- Node 22+ and pnpm 11 (`packageManager` is pinned in `package.json`)
- Rust stable with the `x86_64-pc-windows-msvc` toolchain
- The [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) for your
  platform (on Windows: MSVC build tools and WebView2)

## Setup

```
pnpm install
```

## Verify

Four commands, all of which must pass:

```
pnpm tsc          # typecheck every package
pnpm lint         # eslint, zero warnings tolerated
pnpm test         # vitest
pnpm cargo:check  # cargo check the Rust side
```

Or in one go:

```
pnpm verify
```

## Run

```
pnpm dev
```

This launches `tauri dev`, which opens a desktop window.

> Release builds (`tauri build`, `cargo build --release`) are run by a human or
> CI, never as part of routine development.

## Layout

| Path                    | What it is                                  |
| ----------------------- | ------------------------------------------- |
| `apps/light`            | The Tauri v2 desktop app                    |
| `apps/cloud`            | Stub. Nothing built.                        |
| `packages/core-types`   | Shared domain types                         |
| `packages/ai-providers` | BYO-key and local Ollama adapters           |
| `packages/job-apis`     | Adzuna / Reed clients, keyless search links |
| `packages/cv-parsing`   | CV ingestion and extraction                 |
| `packages/ui`           | Shared presentational components            |
| `docs/`                 | Plan and feature matrix                     |

Everything under `packages/` is **source-only** — no build step, no `dist`.
Vite compiles these from source and TypeScript typechecks them in place.

## Contributing

Read [CLAUDE.md](CLAUDE.md) first. It holds the non-negotiable rules and the
handful of toolchain traps that will otherwise cost you an afternoon.
