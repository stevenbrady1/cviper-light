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

## Status

Phase 0: this is the unmodified scaffold screen plus wiring. No CViper features
are implemented. See [../../docs/FEATURE-MATRIX.md](../../docs/FEATURE-MATRIX.md).
