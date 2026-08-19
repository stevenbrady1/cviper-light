# Feature Matrix — Light vs Cloud

Where each feature lives. The Light column records the _intent_; the State
column records the truth. **Phase 1a is the only part built so far**: the shared
data model and the export/import format below.

`apps/cloud` is an empty stub directory. There is no cloud code of any kind.

| Feature                      | Light                                   | Cloud (future)                     | State        |
| ---------------------------- | --------------------------------------- | ---------------------------------- | ------------ |
| Job search (Adzuna/Reed)     | Yes — user's own API keys, direct calls | Yes — server-side, shared keys     | Not built    |
| Keyless browser search links | Yes — no key needed, opens in browser   | Not applicable                     | Not built    |
| Application tracker          | Yes — local SQLite                      | Yes — synced                       | Not built    |
| CV parsing                   | Yes — fully local                       | Yes — server-side                  | Not built    |
| CV analysis (BYO key)        | Yes — user's own provider key           | Not applicable                     | Not built    |
| CV analysis (local Ollama)   | Yes — offline, no key, no network       | No                                 | Not built    |
| Keyword-only analysis        | Yes — no AI, no key, always available   | Yes                                | Not built    |
| Data export/import           | Yes — user-initiated file in/out        | Yes — plus migration to/from Light | Format built |
| Accounts                     | No — no login, no identity              | Yes                                | Not built    |
| Sync                         | No — single device by design            | Yes                                | Not built    |
| Telemetry                    | No — none, ever                         | Opt-in                             | Not built    |

## Notes

- **Light is local-first.** Data lives in SQLite on the user's machine. Secrets
  go to the OS credential store via the `keyring` crate, never to a file.
- **Keyless first.** Every capability that can work without an API key has a
  keyless path, so the app is useful before the user configures anything.
- **"No" in the Light column is a product decision, not a gap** — accounts,
  sync, and telemetry are deliberately absent.

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
