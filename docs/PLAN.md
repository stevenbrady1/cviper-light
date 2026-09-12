<!--
  This file is the build plan, copied verbatim from the planning session that
  produced this repository. It lives here so the repository is self-contained:
  the previous version of this file pointed at a path outside version control,
  which is a plan nobody but one machine could read.

  Everything below the "Status" section is UNEDITED. Where it has been overtaken
  by events, the Status section says so rather than the plan being quietly
  rewritten — a plan edited to match what happened is a record of nothing.
-->

# CViper Light — Build Plan

## Status (2026-08-19)

**Phases 0 to 3 are built.** The verification loop, the tracker, CV analysis,
job search, the Ollama path, the updater, onboarding and the release workflows
all exist. See [FEATURE-MATRIX.md](FEATURE-MATRIX.md) for the per-feature truth
and the README for how to run it.

Two things the plan below says are no longer accurate, and both are deliberate:

1. **The verification loop is five commands, not four.** `pnpm cargo:test` was
   added because `cargo check` does not compile `#[cfg(test)]` code — without it
   every Rust test in the repository was a guard that looked green because
   nothing had ever asked it a question.
2. **Human-only task 2 (padding the icon) is done.** The artwork was 1024x1031;
   it is padded and the icon set is generated. See
   `apps/light/branding/README.md`.

The remaining human-only tasks are the ones at the very bottom of this file, and
they are the honest list: real API keys, the public repository and its remaining
secrets, store enrolment, and the first tagged release. The updater signing
keypair is done — see task 5, and do not redo it.

---

## Context

You want a second, separate product: **CViper Light** — a free desktop app running entirely
on the user's own computer. No accounts, no server of ours, no telemetry. Three features:
job search, an application tracker, and CV-vs-job-description analysis.

This is not a change to the CViper web app. It is a new codebase that shares the brand and
some hard-won logic.

**Why this needed planning rather than just running the prompt:** the session opened in
`c:\Dev\job-match-pro` — the **live CViper production repo**, 3,091 tracked files, pointed at
`github.com/stevenbrady1/CViper`, with a large uncommitted working tree. A greenfield
`git init` there would have been damaging. Beyond that, **pnpm is not installed**, the existing
app already contains working versions of several pieces Light needs, and **three items in the
locked spec do not survive contact with current reality** (below).

**Outcome:** a working Windows desktop app through Phases 0–3, with the human-only tasks
(real API keys, signing keypair, store enrolment) listed at the end.

---

## Decisions taken

| #   | Decision                   | Choice                                                                                     |
| --- | -------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | Build location             | `C:\dev\cviper` — new, empty, does not exist yet                                           |
| 2   | Reuse from existing CViper | Yes — prompts/calibration, Reed salary fix, dedupe, keyword scorer, brand tokens           |
| 3   | pnpm                       | `corepack enable pnpm`                                                                     |
| 4   | Salary period              | **Add a `salary_period` column** ('year'/'day'/'hour') — additive, free at schemaVersion 1 |
| 5   | No-key CV analysis         | **Port the keyword scorer** so analysis works with zero setup                              |
| 6   | Affiliate link tagging     | **None.** Job links open exactly as published                                              |
| 7   | Keyring                    | **Write ~30 lines of Rust** over the `keyring` crate — the specced plugin does not exist   |
| 8   | Network calls              | **From Rust**, not the web layer — keys never enter the page                               |

Items 4–8 are deliberate, approved deviations. Everything else in the spec stands as written.

### Working-directory note

`C:\dev\cviper` is outside this session's allowed folders — first action is to create it and
add it. `c:\Dev\job-match-pro` is **read-only for the entire build**: we copy _from_ it, never
write to it. No commits, no branches, no edits there.

---

## Spec corrections (verified against current docs, 2026-08)

Three things in the locked prompt are wrong today. Each was checked against source, not memory.

**1. `tauri-plugin-keyring` is not an official plugin.** The official list has 30 plugins;
keyring isn't among them. The crates.io name is one person's v0.1.0 from December 2024,
pinned to a superseded library version. → Write it ourselves over `keyring = "4.1.6"`
(published 2026-08-01, 20.8M downloads). Same OS credential store, no abandoned middleman.

**2. "Every `#[tauri::command]` must be granted a capability" is false.** Your own Rust
commands are **allow-by-default**; the permissions system gates _plugin_ commands only. Good
news, and it makes the hand-rolled keyring cheaper still. Registration in `generate_handler!`
is still required.

**3. Anthropic's `tool_choice` forcing for JSON is obsolete.** Use `output_config.format` with
`type: "json_schema"`. The old assistant-prefill trick now returns a hard 400 on current
models. Header stays `anthropic-version: 2023-06-01`. Default model `claude-opus-5`.
Schemas need `additionalProperties: false` on **every** object, and cannot use `minimum`/
`maxLength`/recursion — clamp those in Zod instead.

**Traps found that would each have cost an afternoon:**

- `sql:default` does **not** include `allow-execute` → every INSERT/UPDATE fails silently.
  Must add `sql:allow-execute` on day one.
- `dialog:default` does **not** include `allow-ask`/`allow-confirm`, despite the docs saying so.
- `tauri add sql` omits the `sqlite` feature from `Cargo.toml` — hand-edit immediately.
- `MigrationKind::Down` is a **silent no-op** — the plugin filters it out. Append-only `Up`
  isn't a convention here, it's the only thing that works.
- `pdfjs-dist` v6 is ESM-only and moved image decoding to WASM; the worker needs `?url`
  (not `?worker`), and cMap/WASM assets must be copied into `public/` or it works in dev and
  breaks when packaged.
- Ollama's OpenAI-compat endpoint doesn't support `tool_choice`. Use native `/api/chat` with
  `format` set to the schema object directly (not nested under a `schema` key).

---

## Machine readiness (verified)

| Component                                                  | Status                                              |
| ---------------------------------------------------------- | --------------------------------------------------- |
| Rust 1.93.0, `x86_64-pc-windows-msvc` (Tauri MSRV is 1.90) | ready                                               |
| VS 2022 Community MSVC 14.44 + Windows SDK 10.0.26100      | ready                                               |
| WebView2 151.0.4129.93                                     | ready                                               |
| Node v24.18.0, corepack 0.35.0                             | ready                                               |
| pnpm                                                       | **missing** — first step                            |
| Ollama at `localhost:11434`                                | **running** — `llama3.2:latest`, `qwen2.5-coder:7b` |
| git 2.55, gh 2.85, ~440 GiB free                           | ready                                               |

Ollama being live matters: the Phase 3 integration test can **actually run**, not skip.

---

## What gets ported

Copied from `c:\Dev\job-match-pro` (read-only), translated to TypeScript.

| Source                                                                                                   | Decision                                  | Why                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/ai/prompts/constants.py` — `FIT_SCORE_ANCHORS`                                                  | **Port, near-verbatim**                   | The five score bands + three worked calibration examples are the difference between a model scoring everything 75–85 and one that discriminates. **One edit:** each example ends with `Sub-scores: skills=88, …` — fields our flat schema doesn't return. Rewrite as prose so the calibration survives without implying a field. |
| `FIT_SCORE_WEIGHTS`, proficiency ladder                                                                  | **Adapt**                                 | Keep 35/25/20/10/10 and expert 100 / advanced 80 / intermediate 50 / basic 25 as guidance. **Delete "match_score MUST equal the weighted sum of sub-scores"** — instructing a model to sum fields it isn't returning is exactly what makes small models emit extra keys.                                                         |
| `FAIRNESS_GUARDRAIL`                                                                                     | **Port verbatim**                         | Free, correct, embarrassing to lack.                                                                                                                                                                                                                                                                                             |
| `ATS_SCORE_ANCHORS` + the 7-factor ATS rubric in `scoring.py`                                            | **Adapt — fold in**                       | Feeds `ats_notes[]` and `keyword_gaps[]`. Fold into the single match prompt as one more step; do not make a second AI call.                                                                                                                                                                                                      |
| `job_matching.py` 5-step reasoning chain                                                                 | **Port the skeleton**                     | SKILL AUDIT → EXPERIENCE FIT → INDUSTRY & TRAJECTORY → COMPETENCY FIT → SYNTHESISE works fine with flat output. Discard `_FIT_SCORE_FIELDS` (the nested schema).                                                                                                                                                                 |
| `gateway.py` → `extract_json` / `safe_parse_json` repair ladder                                          | **Port**                                  | Strip trailing commas → strip `//` comments → quote bare keys → substring between first `{` and last `}`. Its own comment says "common in Ollama output" — and we target Ollama.                                                                                                                                                 |
| `gateway.py` → `sanitize_for_prompt`                                                                     | **Port, retarget**                        | Job descriptions are untrusted text entering a prompt. Keep the injection patterns; point the delimiter regex at _our_ fences.                                                                                                                                                                                                   |
| `job_sites_api.py` → `_DAY_RATE_CEILING = 2000`                                                          | **Port the reasoning, not the formatter** | The flagged real bug. Port as `classifyReedSalaryPeriod(min,max)` returning structured data — **not** as a string formatter, because re-encoding the unit in prose is what caused the bug. Copy the explanatory comment verbatim.                                                                                                |
| `_classify_reed_contract_type` + signals                                                                 | **Port verbatim**                         | The deliberate omission of the bare word "contract" (permanent ads say "permanent contract") is a day of rediscovery.                                                                                                                                                                                                            |
| `ReedAPI` / `AdzunaJobsAPI` transport                                                                    | **Adapt**                                 | Auth + endpoints → Rust; response mapping → TS. Adzuna needs **two** secrets. Drop `_tag_affiliate_url` (decision 6).                                                                                                                                                                                                            |
| `dedupe_fingerprint.py`                                                                                  | **Port algorithm + constants**            | SimHash, `SHINGLE_SIZE 3`, `MIN_FINGERPRINT_TOKENS 20`, `MERGE_MAX_HAMMING 3`, decimal-string persistence. Skip the `_LANE_TABLES` accumulator — a Python-speed workaround JS doesn't need. **Change policy: flag, never auto-merge** (no server-side undo in a local app).                                                      |
| `keywords.py` (450 lines) + `data/lexicons/` (15 JSON, 76 KB)                                            | **Port**                                  | Powers the no-key mode. Rarity-weighted, not naive counts. Data copies verbatim.                                                                                                                                                                                                                                                 |
| `fallbacks.py` → `matching()` (L398), `ats_score()` (L965)                                               | **Adapt**                                 | Two functions, not the 1,743-line file.                                                                                                                                                                                                                                                                                          |
| `jobStatuses.js`                                                                                         | **Adapt — take the shape**                | Light's 5 statuses _are_ its columns, so the indirection collapses. Port the module's discipline (one file owns options, labels, colours) and `PIPELINE_COLORS`.                                                                                                                                                                 |
| `tokens.css` / `theme.css` `:root`                                                                       | **Port values, discard structure**        | Hexes, 3 radii, 2 elevations, fonts → one Tailwind `@theme` block. The two-file cascade exists to retrofit ~800 call sites; greenfield has no such problem. **Do port verbatim:** `button,input,select,textarea{font:inherit}` (WebView2 has the same bug) and the `:focus-visible` ring.                                        |
| `cviper-icon-source.png`                                                                                 | **Port + preprocess**                     | 1024×1031 — **not square**, `tauri icon` will reject or distort. Pad to 1024×1024 first.                                                                                                                                                                                                                                         |
| `schemas.py` → `FitScore`                                                                                | **Do NOT port**                           | Nested `sub_scores{}`. The flat schema exists precisely because a 3B Q4 model on a laptop cannot hold it. Reuse _field names_ that overlap; never the shape.                                                                                                                                                                     |
| `LinkedInAPI` guest scraper                                                                              | **Skip — hard no**                        | Shipping a scraper in a user-installed binary points LinkedIn's rate limiting at the user's home IP, from something they can't patch. Port only the URL construction.                                                                                                                                                            |
| `helpers/cv.py`, `ollama_relay.py`, `CATEGORY_MAP`, `detect_locale`, batch scoring, `_SENIORITY_WEIGHTS` | **Skip**                                  | Python-only, browser-SSRF workaround, dead code, UK-only build, server cost optimisation, needs a second AI call. Note the last as deferred so the reasoning isn't lost.                                                                                                                                                         |

**The one thing to get right:** the temptation to adopt `FitScore` is real — it's richer and
`sub_scores` would make a lovely radar chart. Resist. The valuable portable thing was never
the schema; it's the _calibration_ — bands, worked examples, proficiency ladder, reasoning
chain, ATS rubric, fairness guardrail, JSON repair ladder. All prose and constants. Port them
all, pour them into the flat schema.

### An alignment worth preserving

Light's five statuses map **1:1** onto the web app's five board columns:
`saved`→`not_applied`, `applied`→`applied`, `interviewing`→`in_progress`, `offer`→`offer`,
`rejected`→`rejected`. Keep these exact strings and a Light export folds into the web app —
and back — with no translation table. That makes the export a genuine funnel, not a dead end.

---

## Architecture: Rust owns transport, TypeScript owns logic

The locked plugin list has no HTTP plugin, and that's correct — but it means the web layer
can't call the APIs. Reed sends no CORS headers at all, and a key held in the page is visible
in DevTools, so "never log a key" becomes discipline rather than structure.

So: **narrow, purpose-built Rust commands own the network; TS owns request bodies,
normalisation and validation.**

```rust
provider_chat(provider, body)        // Rust injects auth from keyring
provider_list_models(provider)
ollama_probe()                       // 500ms timeout, Ok(None) on any failure
job_search(provider, params)
secret_set / secret_delete / secret_status    // NOTE: no secret_get exposed to JS
```

No generic `http_request(url)` command — that's an SSRF footgun letting injected JS proxy
anywhere. `secret_get` stays Rust-internal, so **the key never crosses into the page in
either direction after being set once.** Settings shows "key set / not set" and offers no
reveal. `SecretKey` is a Rust enum, so JS can't address arbitrary credential entries.

**Internal packages are source-only** — `"private": true`, `main: "./src/index.ts"`, no build
step on any package. Vite compiles them as source, `tsc --noEmit` typechecks, Vitest runs them
directly. This deletes stale-`dist/` and project-reference-ordering pain for free, since we
never publish. "core-types BUILD FIRST" therefore means **implement first**, which it is.

---

## Repo layout

```
C:\dev\cviper\
├─ apps/light/              # Tauri app: src/ + src-tauri/
├─ apps/cloud/README.md     # stub only — do not build
├─ packages/core-types/     # types, Zod schemas, export format  ← FIRST
├─ packages/ai-providers/   # interface + anthropic/openai/ollama adapters
├─ packages/job-apis/       # normalisation, Reed salary/contract, dedupe, browse URLs
├─ packages/cv-parsing/     # pdf.js + mammoth pure functions + sanitise
├─ packages/ui/
├─ docs/PLAN.md             # this prompt verbatim
├─ docs/FEATURE-MATRIX.md   # incl. the export-format v1 contract
└─ .github/workflows/       # ci.yml, release.yml, monorepo-split.yml
```

---

## Phase 0 — Scaffold

1. `corepack enable pnpm`. _If it fails with EPERM (Node lives in Program Files), fall back to
   `corepack prepare pnpm@latest --activate`._ Pin via `packageManager` in root `package.json`.
2. `mkdir C:\dev\cviper` → `git init -b main` → `.gitattributes` with `* text=auto eol=lf`
   **in the first commit** (otherwise the export-determinism test passes locally and fails in CI).
3. Root config: `pnpm-workspace.yaml`, `turbo.json` (**v2 key is `tasks`, not `pipeline`**),
   `tsconfig.base.json`, ESLint 9 flat config, Vitest, Changesets, `.gitignore`
   (incl. `**/src-tauri/target/`, `**/src-tauri/gen/`).
4. **Scaffold the app before registering `apps/*` in the workspace**, or the scaffolder's own
   install hoists mid-run:
   `cd apps && pnpm create tauri-app light -t react-ts -m pnpm --identifier com.cviper.light -y`
   Then add `apps/*` to `pnpm-workspace.yaml` and run root `pnpm install`.
5. Add plugins one at a time with `cargo check` between each — `tauri add` edits `Cargo.toml`,
   `lib.rs` **and** `capabilities/default.json`; inspect every diff. Immediately fix
   `tauri-plugin-sql` to `features = ["sqlite"]`. Add `keyring = "4.1.6"`.
6. Tailwind 4 via `@tailwindcss/vite` — **not** PostCSS + `tailwind.config.js`.
7. Five packages with stub exports; **core-types first**.
8. `docs/PLAN.md`, `docs/FEATURE-MATRIX.md`, root + per-package `CLAUDE.md`.

**`tsconfig.base.json`** turns on `strict`, plus `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes` — the two that catch real round-trip bugs (`parsed.jobs[0]` is
`Job | undefined`). Enable at scaffold; retrofitting them later is a multi-hour slog.

**Root scripts** — the verification loop must actually work:

```json
"tsc": "turbo run typecheck",
"lint": "turbo run lint",
"test": "vitest run",
"cargo:check": "cargo check --manifest-path apps/light/src-tauri/Cargo.toml",
"verify": "pnpm tsc && pnpm lint && pnpm test && pnpm cargo:check"
```

Turbo owns typecheck and lint (where caching pays); Vitest owns test discovery from the root,
because the export tests span core-types and the app's data layer.

**Done when:** `pnpm install` clean, `pnpm tauri dev` opens a window, all four green, committed.

---

## Phase 1 — Tracker + CV analysis

### 1a. RED first — the export round-trip

Written, run, **confirmed failing, and committed red** before any implementation. Then made
green **without editing the tests**. In `packages/core-types/src/backup.test.ts`:

1. round-trips a fully populated backup unchanged — fixture deliberately includes `£`, a
   newline and a non-ASCII char in `extracted_text`, and one job with every nullable null
2. round-trips an empty backup
3. **rejects `schemaVersion: 2`** with `SCHEMA_VERSION_TOO_NEW` — does not throw, imports nothing
4. **preserves unknown extra fields** through import→export — _the funnel test_. Implemented
   with an internal `__extra` bag, never itself serialised
5. rejects missing `schemaVersion`; rejects malformed JSON legibly
6. writes `schemaVersion` as the **first key** of the file
7. atomic: one malformed record aborts the whole import, zero rows written
8. deterministic: two exports of identical data are byte-identical (forces stable key order
   and `ORDER BY id`)

Export shape carries `schemaVersion`, `exportedAt`, `app{name,version}`, then the four
collections. **`app` is metadata the importer must never read** — the version gate is
`schemaVersion` alone. Write that as a comment; it's the mistake a future contributor makes.
`docs/FEATURE-MATRIX.md` gets the "Export v1 — additive only, forever" field list **in the
same commit**. That document is the contract with Cloud.

Conventions fixed now: all timestamps ISO-8601 UTC **strings**, all dates `YYYY-MM-DD`
**strings**. No `Date` objects in the persisted or exported layer — they don't survive JSON or
SQLite and are the top cause of round-trip failures.

### 1b. Data layer

`apps/light/src-tauri/migrations/0001_init.sql`, pulled in with `include_str!` so it's
reviewable. `id TEXT PRIMARY KEY` holding UUIDs (`crypto.randomUUID()`) — autoincrement
integers collide when importing from another machine. `jobs` includes **`salary_period`**.
`UNIQUE(source, external_id) WHERE external_id IS NOT NULL` gives the free, exact half of
dedupe. `PRAGMA foreign_keys = ON` issued after `Database.load()` (it's per-connection, not
per-migration). The db URL is a **single shared constant** used by both `add_migrations` and
`Database.load` — a mismatch means migrations silently never run.
Lands at `%APPDATA%\com.cviper.light\cviper.db`.

`apps/light/src/db/` — `client.ts`, `rows.ts` (the **only** place SQLite↔TS coercion lives),
then `jobs/applications/cvs/analyses.ts`, plus `backup.ts` exposing `readAll()`/`writeAll()`.
Every function returns `Result<T, DbError>`; none throw. The split between `db/backup.ts` (I/O)
and `core-types/backup.ts` (pure) is what lets the RED tests run with zero Tauri runtime.

### 1c. Tracker UI + the zero-keys test

Five-column board, cards, a **persistent right detail pane** (not modals — see Design),
status, notes, next-action date with overdue derivation, manual add.

`tracker.zeroKeys.test.tsx` renders the whole tracker with `secret_status` false for every key
and `ollama_probe` returning none, then drives add → status → next action → note → export,
asserting no error surface appears and no transport is invoked. **That single test is what
keeps "works with zero keys" honest** as features 1 and 3 land.

### 1d–1g. Secrets, providers, parsing, analysis, export

- **Secrets:** `secrets.rs` as described above. Errors sanitised — `e.kind()`, never `{:?}`.
- **ai-providers:** one `AiProvider` interface, transport injected so every path is testable
  against a fake. `temperature: 0` typed as the **literal** so turning creativity up on a
  scoring model is a compile error. Anthropic uses `output_config.format`; OpenAI uses
  `response_format: json_schema, strict: true`; Ollama uses native `/api/chat` + `format`.
  `analyzeCv()` owns the **single** retry: validate → on failure append a plain-prose repair
  turn quoting the Zod error → parse again → ok or error. No loop, no backoff.
  **Clamp near-miss values before validating** (`match_score: 105` → 100, `verdict: "moderate"`
  → nearest) — a 3B model will get these wrong in a new way every time.
- **cv-parsing:** pure functions returning `{ text, pageCount, warnings }`. `warnings` is where
  "this PDF appears to be a scan" lands — a real, common failure the UI must surface rather
  than analysing an empty string. pdf.js worker via `?url` + `GlobalWorkerOptions.workerSrc`;
  cMap/WASM assets copied into `public/`. **Fixtures generated in-test, no binaries in git:**
  a ~700-byte hand-built uncompressed PDF and an `fflate`-zipped minimal DOCX with `mtime: 0`
  so bytes are identical on every machine.
- **Analysis UI:** `RunAnalysisButton` explains its own disabled state ("no provider configured
  — set up a key or start Ollama", with an inline link). A free local app has no support
  channel; the UI _is_ the support channel. The keyword fallback renders as _"Basic match —
  add an AI key for a full analysis."_
- **Export/import:** dialog plugin save/open. Import is additive upsert-by-id in one
  transaction, and **states counts before writing** ("This will add 43 jobs, 12 applications").

**HUMAN-ONLY:** paste a real Anthropic/OpenAI key and judge analysis quality.

---

## Phase 2 — Job search

`packages/job-apis`: normalisation for both providers, `reed/salary.ts`, `reed/contract.ts`,
`dedupe/`, `browse/urls.ts`, `quota.ts`. All pure, unit-tested against recorded fixture
payloads (checked in, trimmed to 3 results, IDs scrubbed). Rust holds the transport with 10s
Reed / 15s Adzuna timeouts. `description` truncates at 8000 chars, not the web app's 4000 —
that number was tuned for batch scoring and loses real requirements in a single analysis.

**Key wizard:** one card per provider with its free-tier limit stated, a signup link, and a
**"Test key"** button that does a real 1-result search. **Never persist an untested key** — a
typo'd key that fails silently three days later is the worst possible first experience.
Adzuna needs **two** fields; a single-field form is a bug waiting to happen.

**Keyless fallback is always visible**, not an error state. LinkedIn and Indeed buttons built
from the same form state and opened with the opener plugin. A user with zero keys gets working
job search on day one — that's the honest framing, not an apology.

**Rate-limit safety.** Reed's free tier is 100/day with no way to query remaining quota, so:
a pure `quota.ts` persisted in `tauri-plugin-store`, reset on UTC date change; **warn at 75,
hard-block at 90** (reserving 10 for a key test and one urgent search); no search-as-you-type,
no polling, no auto-refresh; a 1500 ms minimum between submits enforced in **Rust**, not just
in a disabled button. A failed provider degrades to an inline per-provider error while the
other's results still render. Visible **"Jobs from Adzuna"** attribution wherever its data appears.

**HUMAN-ONLY:** register free Adzuna + Reed keys, confirm real results.

---

## Phase 3 — Ollama, updater, polish

**Run the Ollama integration test FIRST, not last.** It is the highest-uncertainty component
and it is the whole justification for the flat schema. `ollama.integration.test.ts`, gated on
an env var so CI stays green without Ollama, run locally where it _is_ live: a real analysis
against `llama3.2:latest` asserting first-attempt schema validity. **If a 3.2B Q4 model can't
hold the flat schema at temperature 0 with `format` set, that's a finding for you immediately**
— the schema may need to shed `keyword_gaps` or flatten `suggestions[]` further. Set `num_ctx`
explicitly and truncate to ~6000 chars CV / ~4000 chars JD; a 131k context window is not the
same as 131k of comprehension. Filter `nomic-embed-text` out of the chat-model picker.
The probe gets 500 ms; **the first chat gets 180 s** with a "loading model — first run is slow"
indicator, because cold VRAM load takes 5–30 s and silence reads as a hang.

**Updater:** `createUpdaterArtifacts: true`, GitHub Releases `latest.json` endpoint,
and a pubkey — which since `ce13a96` is the real minisign key, id `7029FCBC6B4F158F`,
and must never be regenerated. A **"Check for updates"
button only — no automatic check on launch.** A silent network call at startup in a product
advertising "no telemetry" is a broken promise however benign the payload. Say so in About.

**Telemetry:** a **disabled** switch reading "Anonymous usage statistics — not implemented.
CViper Light sends no data", plus a contract test asserting nothing reads it as true. The point
is to make the absence auditable.

**Onboarding:** three cards matching the three features, each stating its key requirement
honestly, with live Ollama detection shown inline. Card 1 (tracking) is unconditionally
actionable — the correct first impression for a zero-key product.

**Workflows:** `ci.yml` on **windows-latest** (catches the path/line-ending/MSVC issues Ubuntu
hides) running the four verification commands with `Swatinem/rust-cache` — and **never
`tauri build`**. `release.yml` on `light-v*` tags via `tauri-action`, matrix windows + macOS
`aarch64-apple-darwin`, `releaseDraft: true` always, secrets by name only. Plus the
monorepo-split workflow with placeholder org/repo.

---

## Design direction

**Same product family as the web app, but shaped for a window rather than a browser tab.**

**Tokens in one `@theme` block** (`apps/light/src/styles/theme.css`). Tailwind 4's `@theme`
emits real CSS custom properties _and_ generates utilities, which dissolves the
"theme extension vs CSS variables" question — it's both. Semantic names only: `bg-navy`,
`text-ink-muted`, `rounded-card`, `shadow-raised`. Values ported verbatim: navy `#0F2044`,
blue `#1A56DB`, teal `#0E9F6E`, gold `#C27803`; canvas `#F8FAFC`, sunken `#F1F5F9`, card
`#FFFFFF`, line `#CBD5E1`; ink `#0F172A` / `#475569` / `#64748B`; success `#059669`, warning
`#D97706`, danger `#DC2626`. Inter + IBM Plex Mono **self-hosted** in the bundle (offline app;
a Google Fonts call would also be an outbound request in a no-telemetry product), with
`font-display: block` — there's no first-paint latency locally, and a flash of Arial in a
native window reads as broken.

**Enforce the budget with a lint rule, not discipline.** Port the spirit of the web app's
`tokens.contract.test.js`: a Vitest test globbing every `.tsx` that fails on any hex literal,
any `rounded-[...]`/`shadow-[...]` arbitrary value, or any radius/shadow outside the allowed
three and two. **This is the highest-leverage design decision here** — it's why the web app
still looks coherent after ~800 call sites, and it costs about 30 lines.

**Character: a ledger, not a dashboard.** Every number a user compares — scores, salaries,
quota, dates, counts — renders in IBM Plex Mono with `tabular-nums`. That one choice does more
to make this feel like a professional tool than any amount of styling; prose stays in Inter.
Cards are `bg-card` + `border-line`, flat — shadows are reserved for things genuinely floating.
**Navy is structure, blue is action, and they never swap:** navy for sidebar and chrome, blue
for exactly one primary button per view plus links and focus rings. Teal means matched, gold
means gap, red is destructive and `rejected` only. **No gradients** — a desktop app has no hero,
and gradients in native chrome read as web-app-in-a-box, which is precisely what we're avoiding.

**One moment of drama:** `ScoreGauge` — a 120px SVG arc, navy track, colour from verdict (teal
strong / gold possible / **slate weak — not red**, because a weak match is information, not an
error), number in Plex Mono at 38px. One animated element in the whole app, 400 ms, respecting
`prefers-reduced-motion`. Everything else is still.

**Layout:** fixed 240px navy rail — no hamburger, since the window minimum is 1000×700 and a
collapsible sidebar solves a mobile problem we don't have. Search → Tracker → Analysis in
workflow order (`Ctrl+1/2/3`), Settings pinned bottom. Below it, a **permanent status strip**:
`● Ollama`, `● Adzuna · Reed`, and today's quota `12/100` — so "what is configured" never has
to be asked, and the zero-keys state is honest rather than hidden.

**A persistent 380px right detail pane instead of modals** — the biggest departure from the web
app and the most important. The tracker's loop is "look at a card, change something, look at
the next one"; a modal forces open-edit-close-reopen. A pane that updates on selection is the
desktop pattern (mail clients, IDEs) and makes the app feel faster with no actual speed change.
Modals stay for blocking, destructive or wizard-shaped things only.

Global `:focus-visible` ring is non-negotiable — a keyboard-driven desktop tool that loses the
indicator on tab is unusable. No custom titlebar: WebView2 custom titlebars have persistent
snap-layout and drag-region issues on Windows 11 and buy nothing here.

---

## Risks

| #   | Risk                                                                                                | Mitigation                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **pdf.js worker/WASM under Vite + pnpm** — most likely multi-hour sink                              | `?url` first, then copy to `public/`. Timebox 60 min. Prototype with a CJK and a scanned PDF **before** committing to the approach.                        |
| 2   | **`corepack enable` may need an elevated shell** (Node in Program Files)                            | `corepack prepare --activate` fallback; checkpoint before `npm i -g pnpm`.                                                                                 |
| 3   | **Windows Defender scanning `target/`** turns a 20 s verification loop into 90 s                    | Add `C:\dev\cviper\apps\light\src-tauri\target` + the pnpm store to exclusions. First hour, human step. Materially affects velocity for the whole project. |
| 4   | **MAX_PATH (260)** — `.pnpm` store + `target/debug/build/<crate>-<hash>/out/…` genuinely exceeds it | `C:\dev\cviper` is deliberately short — keep it. Enable `LongPathsEnabled=1` once.                                                                         |
| 5   | **Capability gaps fail silently** (`sql:allow-execute`)                                             | Add on day one; see Spec Corrections.                                                                                                                      |
| 6   | **SQLite WAL + OneDrive-synced folders** corrupts                                                   | Use `app_data_dir()` (`%APPDATA%`), never `Documents`.                                                                                                     |
| 7   | **Rust first build is slow** (minutes, hundreds of crates)                                          | Expected, not a hang.                                                                                                                                      |
| 8   | **Reed's 100/day** is easy to burn during manual testing                                            | The quota guard, and be sparing by hand.                                                                                                                   |

**Sequencing traps:** don't build tracker UI before the export tests are green (the format
constrains the model, and the format can never change afterwards). Don't do Ollama last. Don't
add the second AI provider before the first is fully green — the retry/validate/clamp
orchestration is provider-independent and that's where the bugs live; get it right once with
Anthropic, then Ollama (hardest), then OpenAI (mechanical).

---

## Verification

After every meaningful change, all four green before committing — never commit red:

```
pnpm tsc      # TypeScript, strict
pnpm lint     # ESLint
pnpm test     # Vitest
pnpm cargo:check
```

**End to end:** `pnpm tauri dev` opens the window; add a job and change its status with **no
keys set at all**; run a CV analysis against the mocked provider _and_ against your live
Ollama; export the data file and re-import it unchanged; check the exported JSON opens in a
text editor and starts with `"schemaVersion": 1`.

**Never** `tauri build` or `cargo build --release` — human/CI only, per your hard rules.

---

## HUMAN-ONLY tasks

1. Add Defender exclusions and enable long paths _(first hour — affects everything after)_.
2. Pad `cviper-icon-source.png` to a square 1024×1024.
3. Paste a real Anthropic or OpenAI key; judge analysis quality _(end of Phase 1)_.
4. Register free Adzuna + Reed keys; confirm real results _(end of Phase 2)_.
5. ~~Generate the updater signing keypair; add the public key.~~ **Done** in `ce13a96` —
   key id `7029FCBC6B4F158F`, private half in the Actions secrets.
   **An agent must never generate or handle a release signing key, and this one must never
   be regenerated: every installed copy would stop accepting updates, permanently.**
6. Create the public mirror repo; add all GitHub secrets.
7. Apple / Microsoft Store enrolment.
8. First tagged release and macOS notarization.
