# CViper Light

A desktop app for running a job hunt: search adverts, track what you have
applied for, and check a CV against a job description. It runs on your own
computer and keeps everything there.

Windows, with an iPhone build target checked in CI. Tauri v2, React, SQLite.

## Your privacy, in plain words

**Your data stays on your machine. No accounts. We collect nothing.**

There is no sign-up, no login and no server belonging to us. Your CVs, your
applications and your notes are in one database file on your own disk. Nobody
else can read it, including us — there is nowhere for it to go.

Five more things worth saying out loud:

- **No telemetry.** Not "anonymous statistics", not "crash reports", none. The
  Settings screen has a switch showing this, permanently off, and there is a
  test that fails the build if any code ever reads it as on.
- **Almost nothing happens when you open the app.** It does not phone home, and
  it has no account to sign you in to. It does ask GitHub once whether there is
  a newer version — a request for a version number, carrying nothing about you —
  and Settings → Updates switches that off, after which it makes no update
  request at all until you press the button.
- **Your API keys go to the operating system's credential store**, never to a
  file in this app and never into the page. There is no way to read one back
  out — if you forget a key you paste a new one.
- **One button deletes everything.** Settings → Delete everything empties the
  database, removes every key from the credential store and forgets every
  preference. A test fails the build if a new table or store is left out.
- **The privacy notice is generated, not written.** Settings lists every
  address the app can contact, straight from the same list the build is held
  to; a test fails if the code names one the notice does not show.
- **Links open in your own browser, untouched.** No tracking parameters are
  added to a job advert's URL when you click it.
- **"Fetch" opens one page, and only when you press it.** See below.

The only requests this app ever makes are ones you start or switched on: a job
search, a CV check against a provider you chose, a job advert you ask it to
fetch, and an update check — when you press the button, and once at startup
unless you turn that off in Settings → Updates.

### When you press "Fetch" on a job advert

This is the one place the app goes and gets something from the open web, and it
only happens when you press the button.

- **It opens that one page, the same as your browser would.** The site sees your
  IP address, exactly as it would if you had clicked the link yourself. The app
  says so on screen, next to the button, before you press it.
- **Nothing is sent to us.** There is still no server belonging to us. The page
  comes straight from the site to your computer.
- **Exactly one page.** It does not follow links, it does not crawl, and it does
  not load images, adverts or trackers. It asks for the page and reads the text.
- **It carries nothing that identifies you.** No cookies, no sign-in, no API key.
  It cannot even reach your saved keys — that is enforced in the app's Rust code
  and there is a test that fails the build if anyone changes it.
- **It cannot be pointed at your own network.** Addresses on your computer or
  your home network — `localhost`, `127.0.0.1`, `192.168.x.x` and the rest — are
  refused before anything is sent, and refused again if the site tries to
  redirect there. Only `http` and `https` addresses are opened at all.
- **You still check every field.** The fetched text lands in the box you can
  read and edit. Nothing is saved until you have been through the form.
- **Some sites are skipped without asking them.** LinkedIn and Indeed only show
  their adverts to a signed-in browser, so the app does not bother them — it
  tells you to copy the text across instead. The list is a plain file at
  `apps/light/src/config/fetch-blocklist.json`.

If a fetch does not work, for any reason, you get the same short message asking
you to open the page and paste the text, and your link stays where you typed it.

## What it does

**Track applications.** _Works now, no setup._ A board of everything you have
applied for. Every card carries a coloured edge showing how long it has sat
still, because the thing a job hunt loses track of is age, and age is what tells
you who to chase.

**Analyse your CV.** _Needs nothing to start._ Paste a job advert next to your CV
and see which of its words you already use and which you are missing. The basic
match is a word comparison that runs instantly on your machine with nothing
installed. A model reads it properly and explains itself — either a free local
one, or your own API key.

**Search jobs.** _Needs free Adzuna/Reed keys — or use the browser links, which
need no key._ Search two UK job boards from inside the app and save what is
worth chasing straight onto the board. The browser links cover nine UK boards
and open in your own browser; Settings lets you turn any of them off, put them
in the order you use them, and add your own.

**Paste a job.** _Needs an AI provider._ Copy the text of a job advert, paste it
in, and a model fills in the form for you — title, company, location, salary,
link and dates. **Nothing is saved until you have checked every field.** Every
box is yours to edit first, anything the advert did not actually say is left
empty rather than guessed at, and the job is only written down when you press
save. Pay quoted by the hour or by the day leaves the salary boxes empty on
purpose, with the wording kept in the description, because turning a day rate
into a yearly figure is how a good contract ends up looking like a bad
permanent job.

Paste the advert's **link** into that box instead of the advert and the app
says so rather than asking a model: a model cannot open a link, and given one
it invents a job from the words in the address. The link is moved up to the
link box, where Fetch can do something with it.

This one needs an AI provider: free with [Ollama](https://ollama.com) on your
own machine, or your own OpenAI key. Without one you add jobs by
typing them in, and everything else carries on as normal — the tracker and the
browser job-search links never needed a key and still do not.

**Point at the full CViper, three times, in one line each.** After a CV check,
under the tracker and in Settings → Privacy there is a single sentence saying
what the full CViper at cviper.ai adds, and Settings → About says who made
Light. Each opens your own browser only when you tap it. There is no badge, no
count, no timer and no nag: the same sentence every time, and a test fails the
build if one of those lines ever reads or writes any state.

## What needs a key, and what does not

| Feature                             | Key needed?                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Application tracker                 | **No.** Works completely offline.                                      |
| CV upload and text extraction       | **No.** PDF, Word and JSON Resume are read on your machine.            |
| Save a CV back out as JSON Resume   | **No.** The file it arrived as, written where you choose.              |
| Basic keyword CV match              | **No.** Runs locally, instantly.                                       |
| CV analysis with a local model      | **No key** — needs [Ollama](https://ollama.com) installed and running. |
| CV analysis with OpenAI             | Yes — your own key, billed to you.                                     |
| Job search inside the app           | Yes — free Adzuna and/or Reed keys.                                    |
| Job search in your browser          | **No.** One click, no key at all.                                      |
| Paste a job advert into the tracker | Yes — a local Ollama model, or your own key.                           |
| Export and import your data         | **No.**                                                                |

Getting the free keys takes a few minutes; Settings links to both signup pages
and tests a key before it saves it.

### Using a free local model

Install [Ollama](https://ollama.com), then in a terminal:

```
ollama pull llama3.2
```

CViper Light finds it by itself — the analysis screen and the introduction both
show what they detected. Nothing you check leaves your PC. The first run after
starting your computer takes 5 to 30 seconds while the model loads into memory;
the app says so while it waits.

Note that an embedding model such as `nomic-embed-text` cannot hold a
conversation and is not offered as an analysis option.

## Building it yourself

### Requirements

- Node 22+ and pnpm 11 (`packageManager` is pinned in `package.json`)
- Rust stable
- The [Tauri v2 prerequisites](https://tauri.app/start/prerequisites/) for your
  platform — on Windows, MSVC build tools and WebView2

### Setup

```
corepack enable pnpm
pnpm install
```

### Verify

Five commands, all of which must pass:

```
pnpm tsc          # typecheck every package
pnpm lint         # eslint, zero warnings tolerated
pnpm test         # vitest
pnpm cargo:check  # cargo check the Rust side
pnpm cargo:test   # cargo test the Rust side
```

Or in one go:

```
pnpm verify
```

`cargo:check` does not compile `#[cfg(test)]` code, so it cannot run — or even
typecheck — a single Rust test. `cargo:test` is in the loop for that reason.

### Run it

```
pnpm dev
```

This launches `tauri dev`, which opens a desktop window.

### Release builds

```
pnpm --filter @cviper/light tauri build
```

Run by a human or by CI, never as part of routine development. A signed release
that existing installs can update to also needs a signing key — see
[`apps/light/src-tauri/RELEASE-SIGNING.md`](apps/light/src-tauri/RELEASE-SIGNING.md).

### The built-app smoke test

```
pnpm smoke
```

Four questions asked of the real built executable — the window opens, the
first-run welcome is shown, Settings opens, the Privacy section is visible.
Everything else in this repository tests jsdom or a pure function; this is the
only check that can fail because of the WebView2 runtime, the Tauri IPC bridge,
the capability file or the bundled frontend.

The app serves WebDriver itself, from `tauri-plugin-wdio-webdriver` behind the
**test-only `wdio` Cargo feature**. There is no external driver to install and
nothing to keep in version step. That feature must never be on in anything a
person installs — it opens an HTTP automation server on a local port — so it is
gated three ways: the dependency is `optional`, `src-tauri/src/lib.rs` fails to
compile if the feature is enabled without debug assertions, and
`src/lib/no-automation-server-in-shipped-builds.contract.test.ts` fails if it
joins a default feature list or if any workflow but the smoke job enables it.

It does **not** build the app, deliberately: run it without a build and it says
so rather than starting one. CI does the build in its own step
(`.github/workflows/smoke.yml`, on every pull request), which is also the only
place the build is allowed to happen — see the hard rules in
[CLAUDE.md](CLAUDE.md). To run it on your own machine, build once with
`pnpm --filter @cviper/light tauri build --debug --features wdio`, then
`pnpm smoke`.

## Layout

| Path                       | What it is                                  |
| -------------------------- | ------------------------------------------- |
| `apps/light`               | The Tauri v2 desktop app                    |
| `apps/cloud`               | Stub. Nothing built.                        |
| `packages/core-types`      | Shared domain types, export/import format   |
| `packages/ai-providers`    | BYO-key and local Ollama adapters           |
| `packages/job-apis`        | Adzuna / Reed clients, keyless search links |
| `packages/cv-parsing`      | CV ingestion and extraction                 |
| `packages/keyword-scoring` | The no-AI CV match                          |
| `packages/resume-schema`   | JSON Resume: read, flatten, write back      |
| `packages/ui`              | Shared presentational components            |
| `docs/`                    | Build plan and feature matrix               |

Everything under `packages/` is **source-only** — no build step, no `dist`. Vite
compiles them from source and TypeScript typechecks them in place.

## Your data, and getting it out

Everything lives in one SQLite file in the app's own data directory. Settings
exports the whole thing as a single readable `.json` file wherever you choose to
put it, and imports it back. A CV that arrived as a JSON Resume can also go
back out on its own — Analysis → Save as JSON Resume writes the file it came in
as, unchanged except for a `meta.cviper` note of when it left — so it can go
into any tool that reads the format, the full CViper included. The format is documented in
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md) and is additive-only: a file
exported today still imports in five years.

Import **merges**. Records with the same id are updated and nothing is ever
deleted, which the confirmation screen says before it writes anything.

## Contributing

Read [CLAUDE.md](CLAUDE.md) first. It holds the non-negotiable rules and the
handful of toolchain traps that will otherwise cost you an afternoon.
[docs/PLAN.md](docs/PLAN.md) is the build plan, unedited, including the
human-only tasks that remain.

## Licence

MIT — see [LICENSE](LICENSE). Free to use, copy, change and redistribute, for
anyone, with no account and no payment, now or later. The hosted CViper
service is a separate product with its own repository and terms; nothing here
depends on it.
