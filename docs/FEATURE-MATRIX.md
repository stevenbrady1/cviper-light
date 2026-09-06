# Feature Matrix — Light vs Cloud

Where each feature lives. The Light column records the _intent_; the State
column records the truth.

**Built**: everything in the Light column below that is not marked otherwise —
the shared data model and export/import format, the local SQLite data-access
layer, CV text extraction, the provider adapters and their Rust transport, the
keyword-only scorer, JSON Resume import, the app shell, the application tracker, the CV analysis
view, the job-board clients (Adzuna and Reed request building, response
normalisation, cross-post detection, the nine configurable keyless browser
links and the daily request budget), the job search view, the API-key setup
wizard, pasted-advert extraction and the review form it fills, fetching one
advert from a link and the guards around it, the manual update check, the
first-run introduction and the app icon. There are no placeholder views left.

**Not built, and marked as such below**: accounts, sync and telemetry — all
three deliberate — and the CV parsing column, where extraction is done and
structured parsing is not.

**Needs a human before it ships**: the updater is wired and tested but the
signing key in `tauri.conf.json` is a placeholder, so no release can currently
be verified by an installed copy. See
[`apps/light/src-tauri/RELEASE-SIGNING.md`](../apps/light/src-tauri/RELEASE-SIGNING.md).

`apps/cloud` is an empty stub directory. There is no cloud code of any kind.

| Feature                         | Light                                      | Cloud (future)                     | State            |
| ------------------------------- | ------------------------------------------ | ---------------------------------- | ---------------- |
| Job search (Adzuna/Reed)        | Yes — user's own API keys, direct calls    | Yes — server-side, shared keys     | Built            |
| Cross-post detection            | Yes — flags duplicates, never merges       | Yes — merges, with a server undo   | Built            |
| Keyless browser search links    | Yes — nine UK boards, opens in browser     | Not applicable                     | Built            |
| Job-board list, user-edited     | Yes — enable, reorder, add your own        | Not applicable                     | Built            |
| API key setup                   | Yes — tested before saved, never read back | Not applicable                     | Built            |
| Application tracker             | Yes — local SQLite                         | Yes — synced                       | Built            |
| Paste a job advert              | Yes — AI reads it, you check every box     | Yes — server-side                  | Built            |
| Fetch an advert from a link     | Yes — one page, on request, no credentials | Yes — server-side, no user IP      | Built            |
| A link pasted in the advert box | Yes — spotted, never sent to a model       | No — not built there               | Built            |
| CV parsing                      | Yes — fully local                          | Yes — server-side                  | Extraction built |
| JSON Resume import              | Yes — any JSON Resume 1.0 file, read here  | Yes — server-side                  | Built            |
| CV analysis (BYO key)           | Yes — user's own provider key              | Not applicable                     | Built            |
| CV analysis (local Ollama)      | Yes — offline, no key, no network          | No                                 | Built            |
| Keyword-only analysis           | Yes — no AI, no key, always available      | Yes                                | Built            |
| Data export/import              | Yes — user-initiated file in/out           | Yes — plus migration to/from Light | Built            |
| Delete everything               | Yes — database, keys and preferences       | Yes — account deletion             | Built            |
| Privacy notice                  | Yes — generated from the host registry     | Policy page                        | Built            |
| App updates                     | Yes — manual check only, never on launch   | Not applicable                     | Built, unsigned  |
| First-run introduction          | Yes — three cards, reopenable in Settings  | Not applicable                     | Built            |
| Accounts                        | No — no login, no identity                 | Yes                                | Not built        |
| Sync                            | No — single device by design               | Yes                                | Not built        |
| Telemetry                       | No — none, ever                            | Opt-in                             | Absent, guarded  |

## Notes

- **Light is local-first.** Data lives in SQLite on the user's machine. Secrets
  go to the OS credential store via the `keyring` crate, never to a file.
  "Local-first" is not "never uses the network": a job search, a cloud CV
  analysis, an update check and a link fetch are all outbound requests. Every
  one of them is started by the user, none of them reaches a server of ours
  because there is not one, and the app says which is which at the point of
  use rather than in a policy page.
- **Keyless first.** Every capability that can work without an API key has a
  keyless path, so the app is useful before the user configures anything.
- **"No" in the Light column is a product decision, not a gap** — accounts,
  sync, and telemetry are deliberately absent.
- **"Absent, guarded" is stronger than "not built".** There is one telemetry
  flag, it is the literal `false`, and `telemetry.contract.test.ts` fails the
  build if any code branches on it, if anything that can reach a network so much
  as names it, or if the Settings copy stops saying no data is sent. Saying
  nothing about telemetry is also what an app WITH telemetry does; this is
  checkable in a second instead.
- **"Built, unsigned" means the feature works and the key does not exist yet.**
  The updater checks, reports and installs, and every state is tested against a
  fake port. `plugins.updater.pubkey` is a placeholder, so a real check against a
  real release fails signature verification — which is the correct outcome for
  an unsigned build, and is shown to the user as a sentence rather than a
  silence.
- **Nothing is checked at launch.** No update check, no version ping, no
  analytics. Two guards keep it that way: one asserts the updater plugin has a
  single import site, and one mounts the whole app and asserts zero calls before
  a button is pressed.
- **An embedding model is never offered as a chat model.** Current daemons say
  so themselves — `/api/tags` returns `capabilities: ["embedding"]`, verified
  against a live daemon — and that answer always wins. Older daemons omit the
  field entirely, so the filter falls back to the architecture, which has always
  been reported: every Ollama embedding model is a BERT derivative and no chat
  model is one. That is what catches `all-minilm` and `bge-m3`, whose names say
  nothing. A daemon running with nothing chat-capable installed gets a sentence
  naming the command that fixes it; a machine with no Ollama at all is told
  nothing, because that would be an advert rather than an answer.
- **Outbound apply links carry no tracking.** The CViper web application appends
  `utm_source` / `utm_medium` / `utm_campaign` to every job URL it hands out
  (`_tag_affiliate_url` in `backend/job_sites_api.py`). Light deliberately does
  not port that. The product promise is that nothing leaves the user's machine,
  and a tagged link announces them to a third party the moment they click it —
  from a desktop binary they cannot inspect or patch. The omission is asserted
  by a test in `packages/job-apis/src/normalise.test.ts` so it cannot creep back
  in as a "missing feature".
- **Duplicate adverts are flagged, never merged.** The web application
  auto-merges two postings whose descriptions fingerprint within three bits.
  Light shows them as a group and keeps every advert and every apply link. The
  web app can afford a wrong merge because a support engineer can undo it
  server-side; a local SQLite file on one machine has no undo, and a wrong merge
  deletes a real job with no error and nothing for the user to notice.
- **No LinkedIn scraper.** The web application parses LinkedIn's unauthenticated
  guest endpoint. Light ports only the URL construction. A scraper inside an
  installed binary points LinkedIn's rate limiting at the user's own home IP and
  breaks on LinkedIn's schedule, with no way to patch it that afternoon.
- **The board list is data, not code.** Nine UK boards ship in
  `apps/light/src/config/job-boards.json` — LinkedIn, Indeed, Totaljobs,
  CV-Library, Reed, Adzuna, Google Jobs and Guardian Jobs — and Settings can
  switch any of them off, reorder them, or add one by pasting a search URL with
  `{keyword}` and `{location}` in it. A board is a URL shape and one rule about
  spaces, so it is stored as exactly that and a single builder serves all of
  them; the version with a hand-written builder per board made the ninth board a
  new binary. None of it needs an API key. Choices go to `tauri-plugin-store`, a
  real file in the app's data directory, rather than `localStorage` — a board
  somebody worked out and typed in is their work, and the WebView clearing its
  origin data should not take it. A failed read falls back to the shipped nine
  for the buttons but still reports the failure to the Settings screen, because
  quietly switching every disabled board back on with no explanation is the one
  outcome worth avoiding.
- **A pasted advert is read by a model, then checked by a human before anything
  is saved.** Paste the text of an advert and the configured provider
  (Anthropic, OpenAI, or a local Ollama model) returns nine flat nullable fields
  — `title`, `company`, `location`, `url`, `description`, `posted_date`,
  `salary_currency`, `salary_min`, `salary_max`. Each one lands in an editable
  box, a `null` renders as an EMPTY box rather than a plausible guess, and
  nothing reaches the database until the user has been through them. The source
  schema has seventeen fields and a nested salary object; this one is flat and
  nine because it has to be producible by a 3-billion-parameter quantised model,
  which fails on breadth the same way it fails on nesting. One casualty is
  worth naming: there is no `agency` field, so an advert from a recruiter
  records the agency as the company — survivable only because the user is
  looking at that box before it is saved.
- **An advert can be fetched from its link, and that is the one place this app
  goes out to the open web on its own.** Paste the address, press Fetch, and the
  page's readable text lands in the same box a paste would have filled — then
  the SAME extraction runs, and the same review form is checked before anything
  is saved. Two presses, not one: the one-press version spends thirty seconds of
  model time before the user can see that the page came back as "Sign in to
  continue", and puts an advert they have never read in front of them as a
  filled-in form.

  It is disclosed at the control, not in a policy page: _"Fetching opens that
  page from your computer, the same as visiting it in your browser — the site
  sees your IP address. Nothing is sent to us, and no other page is loaded."_
  That sentence is why the README's privacy section now says "**Your data** stays
  on your machine" rather than "Everything stays on your machine". The old
  wording was not false — no data of the user's is sent anywhere, and there is
  still no server of ours — but it read as a claim about network traffic, and a
  page fetch is network traffic. The precise promise is the one worth keeping.

- **The fetch command is the only one in the app that takes a URL from
  JavaScript, and `src-tauri/src/fetch_page.rs` opens with fifty lines about
  why.** `providers.rs` and `jobs.rs` each carry a test forbidding a
  caller-supplied URL, because a command that forwards an arbitrary address is
  server-side request forgery with a friendly name — and this app feeds
  attacker-influenced adverts into a model all day. So the address is treated as
  a request rather than an instruction, and every one of these is checked before
  a socket opens and AGAIN on every redirect hop:

  scheme is `http` or `https`; no username or password in the URL; the host is
  not `localhost`, `.localhost` or `.local`; every resolved address is public
  (loopback, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` incl. the cloud
  metadata endpoint, `0/8`, carrier-NAT, benchmarking, multicast and reserved
  space are all refused, in IPv4 and IPv6, with IPv4-in-IPv6 unwrapped first);
  the connection is PINNED to the addresses just vetted so DNS cannot rebind
  under it; a redirect may not leave the registrable domain it started on and at
  most three are followed, each compared with the address the USER pasted rather
  than the previous hop; the reply must be HTML or plain text; the body is
  capped at 5 MB WHILE STREAMING; and the whole walk shares one 15-second
  budget.

  It builds its own HTTP client rather than reusing `providers::client()`, which
  follows redirects itself — reusing it would leave hops two onwards unchecked
  while the happy path looked identical, and a source-scanning test now forbids
  it. It sends no cookies, no `Authorization` header and no API key, and it
  cannot reach the credential store at all: `this_command_cannot_reach_the_credential_store`
  fails the build if the module so much as names `secret_get`. Every refusal
  message is a fixed sentence containing no digits, so no address, status code
  or response byte can travel in an error string.

- **A fetched page is untrusted text, and is handled as such.** The HTML is
  turned into text in TypeScript (`htmlToText.ts`) — script, style, noscript,
  svg, iframe and canvas go with their content, and so does nav/header/footer/
  aside chrome, the `aside` being the one that does real damage because a
  "similar jobs" rail is a different job at a different company. The result goes
  through the same `sanitizeForPrompt` the paste path uses: an advert carrying
  "ignore all previous instructions" in white-on-white text costs an attacker
  nothing.

  Text under 400 characters is treated as a FAILURE rather than a short advert.
  The two commonest replies to a fetch of a big job board are a login wall and a
  single-page app that is one empty div, and both arrive with a 200 status.

- **Every way a fetch can fail produces the same guided sentence.** Blocklisted
  domain, timeout, unreachable host, blocked redirect, wrong content type,
  oversize page, 404, login wall, broken IPC — one message, telling the user to
  open the page and paste the text, with their link left where they typed it and
  the paste box still working. Eight things to a developer; one thing, with one
  route forward, to somebody trying to record a job. No status code, error kind
  or raw message ever reaches the screen, and a test asserts it.

- **`fetch-blocklist.json` is a courtesy list, not a security control, and says
  so.** LinkedIn and Indeed ship in it because they answer anything that is not
  a signed-in browser with a wall; a blocked domain skips the network ENTIRELY
  and gets the guided message immediately rather than fifteen seconds later.
  Matching is on the registrable domain, so `uk.indeed.com` is covered and
  `notlinkedin.com` is not. Nothing that keeps this app out of a private network
  reads this file — that is all in Rust — so a malformed file degrades to an
  empty list without opening a hole, exactly as `job-boards.json` does.

- **There is deliberately no regex fallback for extraction.** With no AI
  provider configured the feature says so, names both routes to one (free with
  Ollama, or the user's own key), and hands over the blank manual form with the
  pasted text preserved. A pattern-matched "title" taken off the first line of
  an email is wrong often enough to be worse than an empty box, and it is wrong
  INVISIBLY — the review form has no way to mark which fields were guessed. The
  keyword scorer is filtered out of the provider list for the same reason: it
  scores a CV against an advert and cannot read a company name out of prose.
- **Pay quoted hourly, per day, or pro rata produces EMPTY salary boxes, with
  the wording kept in the description.** `salary_min` and `salary_max` are
  annual or they are `null`; `JobExtraction` has no `salary_period`, so a day
  rate has nowhere truthful to live. The web application multiplies a day rate
  by 230 working days and stores an annual figure — the same class of bug
  `salary_period` exists to prevent for Reed (see below), and it is not being
  reintroduced. `£45,000 pro rata` is caught too: it is a full-time-equivalent
  figure for a part-time job, and the source repo has no coverage for it
  anywhere — that rule was written here, not inherited. Adverts that describe
  pay only in words ("Competitive", "DOE") also blank the boxes, because a model
  asked for an integer will invent one. Nothing is lost: the raw wording stays
  in `description`, where the user can read it. An empty box the user fills in
  is correct; a plausible invented day rate is a bad decision waiting to happen.
  `TODO(salary_period)` in `packages/ai-providers/src/salary-wording.ts` records
  the schema-plus-form change that would capture these properly instead of
  discarding the number.
- **Extraction gets exactly one retry, and never a partial answer.** A bad shape
  is sent back once with the error and the rejected output quoted; a second
  failure returns "unavailable" plus a readable sentence, and the empty
  extraction. Provider-level failures — a stopped daemon, a rejected key, a
  truncated reply — are not retried at all, because an identical second request
  cannot fix any of them. Every path returns an outcome object rather than
  throwing, so no caller can write the version that blanks the screen.
- **A key is proved before it is stored.** The setup wizard runs a real
  one-result search with the credentials the user just typed
  (`job_test_credentials` in `src-tauri/src/jobs.rs`) and writes nothing to the
  credential store unless the board answers. Saving first and deleting on
  failure would have already overwritten the working key it was replacing, and a
  crash mid-rollback would leave the broken one in place with nothing to say so.
  There is no way to read a saved key back — `secret_get` is Rust-only and
  unregistered — so a forgotten key is re-pasted, and the wizard says so.
- **Reed's free tier is 100 requests a day** and reports no remaining balance,
  so the count is kept locally: a warning at 75, and searching pauses at 90 to
  keep ten back for a key test and one urgent search. Adzuna is counted but
  never blocked — its allowance depends on the plan the user bought and cannot
  be queried, so any threshold would be invented.

## Export format v1 — additive only, forever

Implemented in `packages/core-types/src/backup.ts`. This is the contract with
the future cloud app, and the user's only route to their own data.

### The rules

1. **Additive changes only.** Never rename a field, never remove one, never
   change a field's type or meaning, never make an existing optional field
   required. Adding a new field is the only permitted change.
2. **Any shape change bumps `schemaVersion`.** A file exported today must still
   import in five years; there is no migration story for a file that lives in
   the user's own Documents folder.
3. **`schemaVersion` is the ONLY compatibility gate.** `app.name` and
   `app.version` are metadata for humans reading the file. The importer never
   reads them — `app.version` moves on every release, and `app.name` becomes
   `cviper-cloud` the moment another product writes a compatible file.
4. **Unknown fields survive a round-trip.** Any key the importer does not
   recognise, at any level, is carried through and written back out unchanged.
   That is what lets a user move a file between Light and the cloud app without
   the smaller of the two eating the other's fields.
5. **No `Date` objects, anywhere.** Timestamps are ISO-8601 **UTC** strings
   (`2026-08-19T09:00:00.000Z`); an offset such as `+01:00` is rejected. Dates
   are `YYYY-MM-DD` strings. Both are validated on import.
6. **Absent values are `null`, never a missing key.**
7. **Import is atomic.** One bad record imports zero records.
8. **Export is deterministic.** Collections are sorted by `id` (codepoint order,
   never `localeCompare`), keys are emitted in a fixed order, and
   `schemaVersion` is always the first key in the file.

### File structure

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-08-19T09:00:00.000Z",
  "app": { "name": "cviper-light", "version": "0.1.0" },
  "jobs": [],
  "applications": [],
  "cvs": [],
  "analyses": []
}
```

Strict JSON — no comments, no trailing commas. `app` is metadata only.

### `jobs[]`

| Field             | Type                                                 | Null? | Notes                                        |
| ----------------- | ---------------------------------------------------- | ----- | -------------------------------------------- |
| `id`              | string                                               | no    | Sort key for deterministic export.           |
| `source`          | `adzuna` / `reed` / `manual` / `linkedin` / `indeed` | no    | Closed set.                                  |
| `external_id`     | string                                               | yes   | The provider's own id. `null` when `manual`. |
| `title`           | string                                               | no    |                                              |
| `company`         | string                                               | no    |                                              |
| `location`        | string                                               | yes   |                                              |
| `salary_min`      | number                                               | yes   |                                              |
| `salary_max`      | number                                               | yes   |                                              |
| `salary_currency` | string                                               | yes   | ISO-4217, e.g. `GBP`.                        |
| `salary_period`   | `year` / `day` / `hour`                              | yes   | See below — this field is load-bearing.      |
| `description`     | string                                               | yes   |                                              |
| `url`             | string                                               | yes   |                                              |
| `posted_date`     | `YYYY-MM-DD`                                         | yes   |                                              |
| `created_at`      | ISO-8601 UTC                                         | no    |                                              |

**Why `salary_period` exists.** Reed returns salary figures with no period unit,
so a contract advertised at £457–£550 is a **day rate** that is byte-for-byte
indistinguishable from an insulting annual salary. Without this field the app
confidently shows a good contract role as a terrible permanent one. `null` means
the source did not say — show the figures unqualified rather than guessing.

### `applications[]`

| Field              | Type                                                        | Null? | Notes             |
| ------------------ | ----------------------------------------------------------- | ----- | ----------------- |
| `id`               | string                                                      | no    | Sort key.         |
| `job_id`           | string                                                      | no    | References a job. |
| `status`           | `saved` / `applied` / `interviewing` / `offer` / `rejected` | no    | Exactly five.     |
| `applied_date`     | `YYYY-MM-DD`                                                | yes   |                   |
| `notes`            | string                                                      | yes   |                   |
| `next_action`      | string                                                      | yes   |                   |
| `next_action_date` | `YYYY-MM-DD`                                                | yes   |                   |
| `updated_at`       | ISO-8601 UTC                                                | no    |                   |

**The five statuses map 1:1 onto the CViper web app's five board columns**, so an
export from Light folds into the cloud app with no translation table:

| Light          | Cloud board column |
| -------------- | ------------------ |
| `saved`        | `not_applied`      |
| `applied`      | `applied`          |
| `interviewing` | `in_progress`      |
| `offer`        | `offer`            |
| `rejected`     | `rejected`         |

Adding a sixth status breaks that property. It needs a `schemaVersion` bump and
a decision on the cloud side first.

### `cvs[]`

| Field            | Type         | Null? | Notes                                      |
| ---------------- | ------------ | ----- | ------------------------------------------ |
| `id`             | string       | no    | Sort key.                                  |
| `name`           | string       | no    |                                            |
| `file_path`      | string       | yes   | Local path. `null` if the text was pasted. |
| `extracted_text` | string       | yes   | `null` until parsing has run.              |
| `created_at`     | ISO-8601 UTC | no    |                                            |

### `analyses[]`

| Field         | Type         | Null? | Notes                                  |
| ------------- | ------------ | ----- | -------------------------------------- |
| `id`          | string       | no    | Sort key.                              |
| `cv_id`       | string       | no    | References a cv.                       |
| `job_id`      | string       | yes   | `null` for a job-agnostic CV review.   |
| `provider`    | string       | no    | e.g. `ollama`, `anthropic`, `keyword`. |
| `model`       | string       | no    | e.g. `llama3.2:3b`.                    |
| `match_score` | integer      | no    | 0–100.                                 |
| `result_json` | object       | no    | A `CvAnalysis` — see below.            |
| `created_at`  | ISO-8601 UTC | no    |                                        |

`result_json` is named for the SQLite TEXT column it lives in, but is exported as
a **structured object**, not a JSON string, so the file stays queryable instead
of carrying a double-escaped blob.

### `result_json` — the flat `CvAnalysis` shape

Deliberately flat: it must be producible by a 3-billion-parameter quantised model
running locally, and small models fail on nesting. `suggestions[]` is the only
nested level, and its items are four flat strings.

| Field              | Type                                             | Notes                                    |
| ------------------ | ------------------------------------------------ | ---------------------------------------- |
| `match_score`      | integer 0–100                                    |                                          |
| `verdict`          | `strong` / `possible` / `weak`                   | Always recomputed — see below.           |
| `summary`          | string                                           |                                          |
| `matched_skills`   | string[]                                         |                                          |
| `missing_skills`   | string[]                                         |                                          |
| `keyword_gaps`     | string[]                                         |                                          |
| `matched_keywords` | string[]                                         |                                          |
| `suggestions`      | `{ section, issue, recommendation, priority }[]` | `priority` is `high` / `medium` / `low`. |
| `ats_notes`        | string[]                                         |                                          |

**`verdict` is computed in TypeScript and never trusted from the model.**
`deriveVerdict()` maps `>= 75` to `strong`, `60–74` to `possible`, and anything
below 60 (including `NaN`) to `weak`. A small model will happily return
`match_score: 72` alongside `verdict: "strong"`, and the user sees both numbers.
The field stays in the schema so the model still reasons about it; its answer is
then discarded.

The same shape has a second, hand-written representation as a JSON Schema
(`CV_ANALYSIS_JSON_SCHEMA`) that is sent to Ollama's `format` parameter and to
the cloud providers' structured-output fields. The two are deliberately NOT
generated from each other — small models are sensitive to schema wording, and
that tuning must not leak into runtime validation. A test asserts they agree on
their required-key sets.

### Import errors

`importBackup()` returns a `Result`, and never throws. Codes:

| Code                     | Meaning                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `MALFORMED_JSON`         | Input was a string but not parseable JSON.                    |
| `NOT_AN_OBJECT`          | Parsed, but is not a JSON object.                             |
| `SCHEMA_VERSION_MISSING` | No usable `schemaVersion` — absent or not a positive integer. |
| `SCHEMA_VERSION_TOO_NEW` | Written by a newer build. Nothing is imported.                |
| `INVALID_RECORD`         | A record failed validation. **Nothing is imported.**          |

### Reserved

`__extra` is the internal carrier for unrecognised fields. It is stripped from
input and never written to output. Do not use it as a field name.
