# CLAUDE.md — @cviper/light

The Tauri v2 desktop app: React 19 + Vite 8 + Tailwind 4 frontend, Rust backend
in `src-tauri/`.

Root rules in [../../CLAUDE.md](../../CLAUDE.md) apply in full. The HARD RULES
there are not negotiable from inside this app.

## Never

- **Never run `tauri build` or `cargo build --release`.** `cargo check` only.
- **Never run `pnpm tauri dev` in an agent session** — it opens a GUI window and
  blocks. Ask the operator to verify interactively.
- **Never edit `src-tauri/gen/` or `src-tauri/target/`.** Both are generated and
  both are gitignored.

## Capabilities, not allowlists

Permissions live in `src-tauri/capabilities/default.json` using Tauri **v2**
capability syntax. Tauri v1 `allowlist` config does not exist here and must
never be introduced.

Three permissions in that file are load-bearing and easy to delete by accident:

| Permission             | Why it is there                                                        |
| ---------------------- | ---------------------------------------------------------------------- |
| `sql:allow-execute`    | `sql:default` omits it. Without it every INSERT/UPDATE fails silently. |
| `dialog:allow-ask`     | Not in `dialog:default`, despite the docs.                             |
| `dialog:allow-confirm` | Not in `dialog:default`, despite the docs.                             |

`dialog:allow-open` and `dialog:allow-save` are **deliberately absent**. The file
and save dialogs run in Rust (`src-tauri/src/files.rs`), so JavaScript never
receives — and can therefore never supply — a path. Re-adding either permission
puts the OS picker back on the JavaScript side and re-opens that hole; the guard
`no_command_accepts_a_filesystem_path` only stops the Rust half of the
regression.

## Rust dependency traps

- `tauri-plugin-sql` **must** keep `features = ["sqlite"]`. `pnpm tauri add sql`
  omits the database backend and leaves the plugin inert.
- `keyring` is the plain crate, used directly with our own Tauri commands. There
  is no official Tauri keyring plugin; the crates.io lookalike is abandoned. Do
  not add it.
- `tauri-plugin-updater` is a desktop-only dependency, so its `.plugin(...)` call
  in `src/lib.rs` is behind `#[cfg(desktop)]`. Keep the two consistent.

## Frontend

- **Tailwind 4**: the `@tailwindcss/vite` plugin. There is no
  `tailwind.config.js` and no PostCSS step. Theme tokens go in
  `src/styles/theme.css` inside `@theme { }`. Never run `npx tailwindcss init`.
- Dev server is on **port 5173**, `strictPort: true`, and
  `src-tauri/tauri.conf.json` `devUrl` must match it. Change one, change both.
- `frontendDist` is `../dist`, relative to `src-tauri/`.

## Verification

From the repo root — all four must pass:

```
pnpm tsc && pnpm lint && pnpm test && pnpm cargo:check
```

## Design tokens are the only place a value is written down

`src/styles/theme.css` holds one `@theme` block: every colour, radius,
elevation and font. Components use SEMANTIC utilities only — `bg-navy`,
`text-ink-muted`, `rounded-card`, `shadow-raised` — never a hex literal, never
an arbitrary `rounded-[...]`/`shadow-[...]`, and never Tailwind's numeric colour
scales. `src/styles/tokens.contract.test.ts` reads every `.tsx` file and fails
the build on all four.

There are exactly three radii and two elevations. Adding a fourth or a third is
a design decision, not a styling tweak.

Fonts are self-hosted in `public/fonts/` (Inter + IBM Plex Mono, SIL OFL,
licences shipped alongside). Never link a font CDN: this app promises nothing
leaves the user's machine.

## Testing components

Vitest runs in the `node` environment by default. Component tests opt into jsdom
with `// @vitest-environment jsdom` as the first line of the file, so pure tests
are not made to pay for a browser they do not use.

`src/lib/events.contract.test.ts` knows a deferring function by its NAME —
`setTimeout`, `.then`, `queueMicrotask`, anything matching
`/debounce|throttle|defer|schedule|nextTick/i`, and single-argument
`set[A-Z]` updaters. Write a new debounce/defer/schedule-style helper under
another name and the guard cannot see through it, so add that name to those
lists in the same commit.

## Status

Built: the data model and export format, the SQLite data-access layer, CV text
extraction, the provider adapters and their Rust transport, the app shell, the
application tracker, the CV analysis view, the job search view and the API-key
setup wizard. There are no placeholder views left. See
[../../docs/FEATURE-MATRIX.md](../../docs/FEATURE-MATRIX.md).

## Two rules the search and key screens depend on

- **A key is TESTED before it is saved.** `job_test_credentials` runs a real
  one-result search with the values the user just typed and writes nothing.
  Only a green answer leads to `secret_set`. Saving first and rolling back on
  failure would have already overwritten the working key it was replacing.
- **A search happens because somebody pressed a button.** No search-as-you-type,
  no polling, no refetch on focus, nothing on mount. Reed's free tier is 100
  requests a DAY. The only debounce on the search screen writes the draft to
  `localStorage` and touches no network.
