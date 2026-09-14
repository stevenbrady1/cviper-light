# CViper Light

A desktop app for running a job hunt: search adverts, track what you have
applied for, and check a CV against a job description. It runs on your own
computer and keeps everything there.

Windows, with an iPhone build target checked in CI. Tauri v2, React, SQLite.

## Who made this, and why

CViper Light is made by one person, in the UK. It began as the free, local
companion to CViper, a hosted job-search product by the same author. That
hosted service was mothballed in September 2026 and no longer runs; Light was
built to stand on its own and does. There is no server behind it, no account
and no payment — it is free and MIT-licensed, for anyone, now and later — and
the tracker, the CV text extraction and the basic keyword match work with no
internet connection at all.

It is early. There is a version tag, `light-v0.1.0`, and a release workflow
that builds and signs installers from it, but no release has been published
yet, so the way to run it today is to build it yourself (below). There are no
screenshots in this repository either;
[docs/app-store/SCREENSHOTS.md](docs/app-store/SCREENSHOTS.md) says which
screens get captured and how.

## What it checks itself for

The promises in this file are not a policy document. Each one is held by a
test that fails the build: `pnpm test` runs every guard below, and CI runs the
same loop on every push. Every guard is a forbid-list — it says what must be
absent, never what must be present — so a new file, a new dependency or a new
workflow is in scope the day it is written, without anyone remembering to
register it. One row per guard, in the words of the promise:

| The promise                                                                                                                                                                          | The guard that fails the build if it stops being true         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| The telemetry switch is off, and no code anywhere reads it.                                                                                                                          | `features/settings/telemetry.contract.test.ts`                |
| Every module that can build the AI transport asks for your consent first, or says in writing why it does not need to.                                                                | `lib/ai-call-sites-consent.contract.test.ts`                  |
| The Rust test command runs every Rust test, doc-tests included; no flag narrows it.                                                                                                  | `lib/cargo-test-runs-doctests.contract.test.ts`               |
| The web view's Content-Security-Policy reaches no external host, allows no `eval` and no wildcard, and every asset the bundle loads is same-origin.                                  | `lib/csp.contract.test.ts`                                    |
| No React event is read after its handler has yielded — a crash that shipped here twice.                                                                                              | `lib/events.contract.test.ts`                                 |
| The updater stays an optional, desktop-only dependency, so the iPhone build cannot break while every desktop check stays green.                                                      | `lib/ios-target.contract.test.ts`                             |
| The Microsoft Store flavour cannot contain the updater, and cannot be built without telling the frontend.                                                                            | `lib/msix-store-build.contract.test.ts`                       |
| No analytics, crash-reporting or session-recording SDK is a dependency of any package, in TypeScript or in Rust.                                                                     | `lib/no-analytics-dependencies.contract.test.ts`              |
| The embedded WebDriver server is compiled into the CI smoke build and into nothing else.                                                                                             | `lib/no-automation-server-in-shipped-builds.contract.test.ts` |
| No API key, secret or token is compiled in, read from the build environment, or defaulted in code.                                                                                   | `lib/no-baked-in-key.contract.test.ts`                        |
| No copy claims the app contacts a service only on a button press without also saying the launch update check can run on its own.                                                     | `lib/no-bare-request-absolutes.contract.test.ts`              |
| Every schema imports its validator through the one configured entry point, so the packaged app never violates its own policy at launch.                                              | `lib/no-direct-zod-imports.contract.test.ts`                  |
| Nothing is gated on payment, a licence, a tier or a trial — in code or in copy.                                                                                                      | `lib/no-paywall.contract.test.ts`                             |
| Product-level copy — the welcome screen, the privacy summary, the generated policy and this README — names no AI provider's brand.                                                   | `lib/no-provider-brand-in-product-copy.contract.test.ts`      |
| The marketing copy in the store-listing documents names no AI provider's brand.                                                                                                      | `lib/no-provider-brand-in-store-listings.contract.test.ts`    |
| Shipped code names no network host the registry does not list, and the web page cannot reach the network at all.                                                                     | `lib/outbound-hosts.contract.test.ts`                         |
| The privacy-policy address is spelled one way everywhere, and no document claims that Fetch loads nothing.                                                                           | `lib/policy-url.contract.test.ts`                             |
| No screen or page over-claims: the privacy promise is about your data, and a wording that widens it to all activity fails the build.                                                 | `lib/privacy-promise.contract.test.ts`                        |
| No release step reaches Apple's signing tools with secrets nobody checked, macOS bundles are universal, and a release starts only from a pushed tag or a person pressing the button. | `lib/release-signing-gate.contract.test.ts`                   |
| The updater asks an address that can answer, over `https`, at a registered host; release drafts stay drafts; the manifest is verified in the job that uploads it.                    | `lib/updater-endpoint.contract.test.ts`                       |
| Nothing in the repository describes the real updater signing key as a stand-in still to be replaced — regenerating it would cut every installed copy off from updates, permanently.  | `lib/updater-key.contract.test.ts`                            |
| `pnpm verify` runs everything the CI `verify` job runs — the loop cannot quietly under-report.                                                                                       | `lib/verify-loop-matches-ci.contract.test.ts`                 |
| The WebKit check on pdf.js actually runs in CI, and stays out of `pnpm test` so a contributor never needs a browser download.                                                        | `lib/webkit-check-runs-in-ci.contract.test.ts`                |
| Every `curl` in a workflow that writes a file carries `--fail`, so a failed download fails as a failed download and never as a checksum alarm.                                       | `lib/workflow-curl-fails-loudly.contract.test.ts`             |

All of those live under `apps/light/src/`. Three more guards are Rust tests,
run by `pnpm cargo:test`: the Fetch command cannot reach the credential store
(`this_command_cannot_reach_the_credential_store` in `fetch_page.rs`); no
command exposed to JavaScript returns any part of a stored key
(`no_registered_command_returns_any_part_of_a_stored_secret` in `secrets.rs`);
and neither the AI transport nor the job-board transport accepts a
caller-supplied address (`there_is_no_generic_url_taking_command` in
`providers.rs` and `jobs.rs`).

If you find a promise here that the code does not keep, treat it as a security
issue and report it the way [SECURITY.md](SECURITY.md) asks.

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

**Browse and search jobs.** _Needs nothing to start._ Two free feeds are read
straight from the web with no key and no account — Arbeitnow, which is mostly
Germany and the rest of Europe with a growing London list, and Guardian Jobs,
which is the twenty most recent UK posts. CViper reads what they have just
published and narrows it down on your computer, so it is a browse of recent
jobs rather than a look at the whole market, and each feed says so on screen if
it stops working. Add your own free Adzuna and Reed keys and the same screen
searches those two boards properly as well. Either way, what you find saves
straight onto the tracker board. The browser links cover nine UK boards and open
in your own browser; Settings lets you turn any of them off, put them in the
order you use them, and add your own.

**Paste a job.** _Needs an AI provider._ Copy the text of a job advert, paste it
in, and a model fills in the form for you — title, company, location, salary,
link and dates. **Nothing is saved until you have checked every field.** Every
box is yours to edit first, anything the advert did not actually say is left
empty rather than guessed at, and the job is only written down when you press
save. Pay quoted by the hour or by the day leaves the salary boxes empty on
purpose, with the wording kept in the description, because turning a day rate
into a yearly figure is how a good contract ends up looking like a bad
permanent job.

Paste a web link starting with `http` or `https`, and nothing else, into that
box instead of the advert, and the app says so rather than asking a model: a
model cannot open a link, and given one it invents a job from the words in the
address. Anything else — a link with words beside it, or an address without
`http` — is read as an ordinary advert. The link-only paste is moved up to the
link box, where Fetch can do something with it.

This one needs an AI provider: free with [Ollama](https://ollama.com) on your
own machine, or your own AI provider's key. Without one you add jobs by
typing them in, and everything else carries on as normal — the tracker and the
browser job-search links never needed a key and still do not.

**Tell it who you are.** _Works now, no setup._ The Profile view — the first
screen on the rail — holds the things a CV does not say: the languages you
work in and how well, your right to work, the deal-breakers, the sectors you
want, what energises you and what drains you, and a few STAR examples. It is
kept in the same database file as everything else and travels in the backup.

**Check the gates before the score.** _Needs nothing to start._ Before an
analysis puts a number on screen it reads the advert for citizenship,
residency, clearance and language requirements and holds them against your
profile — as a pass, a "check this", or a hard stop that quotes the advert's
own line. A gate never moves the score; it sits above it.

**Rank what you find.** _Needs nothing to start._ Every search result is
matched against your newest CV by the same word comparison the basic check
uses, and any deal-breaker from your profile is called out on the card. A
"Best match first" toggle sorts the page.

**See what the market keeps asking for.** _Needs nothing to start._ The Profile
view lists the skills the adverts on your board ask for that your CV does not
mention, ranked by how many of them want each one.

**Know where you stand.** _Works now, no setup._ A strip under the tracker
header counts sent, interviewing, offers and rejected, with the interview and
offer rates.

**Chase what has gone quiet.** _Needs an AI provider._ An application quiet for
ten days is offered a follow-up draft, written only from the advert and the
documents you actually sent — no new claims — at most twice, and logged in the
notes when you mark it sent. Moving a card to Interviewing offers a thank-you
note. These are drafts in a box for you to copy; the app never sends anything.

**Prepare for the interview.** _Needs an AI provider._ From the archived
advert, the CV and letter you sent, and the STAR examples in your profile:
likely questions with suggested answers, talking points, questions to ask, and
the gaps to bridge honestly. Save the pack against the application.

**Rewrite your CV for one advert, and draft the letter.** _Needs an AI
provider._ The Tailor view rewrites your CV for a single advert using only
what the CV already says — a rule the prompt states and a check enforces:
every new number, employer, year or certification that is not in the original
is flagged before you see the text. You get the rewrite as a diff against the
original, a second read that lists problems without rewriting, and a cover
letter drawn from the same facts. Save both against the application, or as a
text file.

**About us, briefly.** Settings → Privacy carries one sentence that opens this
app's own privacy policy at `https://cviper.ai/privacy/`, and Settings → About says
where Light was made and links to its page and its source. Each opens your own
browser only when you tap it. There is no badge, no count, no timer and no
nag: the same sentence every time, and a test fails the build if one of those
lines ever reads or writes any state.

## What needs a key, and what does not

| Feature                             | Key needed?                                                            |
| ----------------------------------- | ---------------------------------------------------------------------- |
| Application tracker                 | **No.** Works completely offline.                                      |
| CV upload and text extraction       | **No.** PDF, Word and JSON Resume are read on your machine.            |
| Save a CV back out as JSON Resume   | **No.** The file it arrived as, written where you choose.              |
| Basic keyword CV match              | **No.** Runs locally, instantly.                                       |
| CV analysis with a local model      | **No key** — needs [Ollama](https://ollama.com) installed and running. |
| CV analysis with your own AI key    | Yes — your own key, billed to you by your provider.                    |
| Browse recent jobs inside the app   | **No.** Two free feeds, read with no key and no account.               |
| Full job search inside the app      | Yes — free Adzuna and/or Reed keys.                                    |
| Job search in your browser          | **No.** One click, no key at all.                                      |
| Paste a job advert into the tracker | Yes — a local Ollama model, or your own key.                           |
| Export and import your data         | **No.**                                                                |
| Candidate profile                   | **No.** Kept in the same local database.                               |
| Eligibility and language gates      | **No.** Read from the advert and your profile, on your machine.        |
| Rank search results against your CV | **No.** The same word comparison, run locally.                         |
| Skills-gap heatmap                  | **No.** Counted from the adverts on your board.                        |
| Funnel strip                        | **No.**                                                                |
| Follow-up and thank-you drafts      | Yes — a local Ollama model, or your own key.                           |
| Interview prep pack                 | Yes — a local Ollama model, or your own key.                           |
| Tailored CV and cover letter        | Yes — a local Ollama model, or your own key.                           |

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

Seven commands, all of which must pass:

```
pnpm tsc          # typecheck every package
pnpm lint         # eslint, zero warnings tolerated
pnpm test         # vitest
pnpm cargo:check  # cargo check the Rust side
pnpm cargo:test   # cargo test the Rust side
pnpm build        # the production Vite bundle — not `tauri build`
pnpm format:check # prettier; `pnpm format` fixes what it reports
```

Or in one go:

```
pnpm verify
```

`cargo:check` does not compile `#[cfg(test)]` code, so it cannot run — or even
typecheck — a single Rust test. `cargo:test` is in the loop for that reason.
`build` is in it because `tsc`, `lint` and `test` all exercise source, not the
bundle, so a change that breaks the production build is green on all three.
The list is exactly what CI's `verify` job runs, and a test fails the build if
the two ever drift apart.

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
| `packages/job-apis`        | Adzuna / Reed clients, keyless feeds, links |
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
into any tool that reads the format. The format is documented in
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md) and is additive-only: a file
exported today still imports in five years.

Import **merges**. Records with the same id are updated and nothing is ever
deleted, which the confirmation screen says before it writes anything.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md): the verification loop, the test-first
rule, how a work-item number is claimed and what a commit message looks like.
[CLAUDE.md](CLAUDE.md) holds the non-negotiable rules and the handful of
toolchain traps that will otherwise cost you an afternoon.
[docs/PLAN.md](docs/PLAN.md) is the build plan, unedited, including the
human-only tasks that remain. [CHANGELOG.md](CHANGELOG.md) lists what is built.
Security reports go the way [SECURITY.md](SECURITY.md) describes, not to the
issue tracker.

## Licence

MIT — see [LICENSE](LICENSE). Free to use, copy, change and redistribute, for
anyone, with no account and no payment, now or later. The hosted CViper
service was a separate product with its own repository and terms; it no longer
runs, and nothing here depends on it.
