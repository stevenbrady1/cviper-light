-- ============================================================================
-- Migration 0001 — initial schema for CViper Light.
-- ============================================================================
--
-- APPEND-ONLY, FOREVER. Once this file has shipped it is frozen:
--
--   * sqlx checksums every applied migration. Editing one byte of this file
--     makes the app refuse to start against any database that already ran it.
--   * `MigrationKind::Down` is a SILENT NO-OP in tauri-plugin-sql: its
--     `MigrationSource::resolve()` keeps only `matches!(kind, Up)` entries and
--     throws the rest away. A "down" migration here would look like a rollback
--     plan and be nothing at all. There are none, on purpose.
--
-- Schema changes go in a NEW numbered file. There is no other route.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS NO `PRAGMA foreign_keys = ON` IN THIS FILE
-- ---------------------------------------------------------------------------
-- `foreign_keys` is a PER-CONNECTION setting, not a property of the database
-- file. Setting it here would enable enforcement for exactly one connection —
-- the one that happened to run the migration — and for nothing afterwards. It
-- would read like a database-wide guarantee and provide none.
--
-- Enforcement comes from two places instead, both outside this file:
--
--   1. sqlx-sqlite sends `PRAGMA foreign_keys = ON` on EVERY connection it
--      opens (it is in the default pragma set in `SqliteConnectOptions`), and
--      tauri-plugin-sql builds its pool from those defaults. This is the real
--      guarantee.
--   2. `src/db/client.ts` reasserts it as the first statement after
--      `Database.load()`, so the requirement is visible in our own code rather
--      than inherited silently from a dependency's defaults.
--
-- ---------------------------------------------------------------------------
-- WHY THE IDs ARE TEXT
-- ---------------------------------------------------------------------------
-- Every `id` is a TEXT UUID generated in TypeScript with `crypto.randomUUID()`,
-- never `INTEGER PRIMARY KEY AUTOINCREMENT`. Autoincrement ids restart from the
-- same small numbers on every machine, so importing a backup exported from a
-- second device would collide on ids that mean different rows. UUIDs make an
-- import a merge instead of a corruption.
--
-- ---------------------------------------------------------------------------
-- WHY THERE IS ONLY ONE CHECK CONSTRAINT
-- ---------------------------------------------------------------------------
-- `applications.status` is checked because that set is frozen by contract: the
-- five values map 1:1 onto the CViper web app's five board columns, and adding
-- a sixth is documented as requiring a schema-version bump and a decision on
-- the cloud side. It is safe to nail down in a file that can never be edited.
--
-- `jobs.source` and `jobs.salary_period` are NOT checked, deliberately. Both
-- are sets that can plausibly grow (a new job board; a monthly salary period),
-- and a CHECK in an append-only migration would turn "add a value" into "write
-- a migration that rebuilds the table". Both are validated by Zod on the way in
-- and on the way out — see `src/db/rows.ts`.
-- ============================================================================

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT    PRIMARY KEY NOT NULL,
  source           TEXT    NOT NULL,
  external_id      TEXT,
  title            TEXT    NOT NULL,
  company          TEXT    NOT NULL,
  location         TEXT,
  salary_min       REAL,
  salary_max       REAL,
  salary_currency  TEXT,
  salary_period    TEXT,
  description      TEXT,
  url              TEXT,
  posted_date      TEXT,
  created_at       TEXT    NOT NULL
);

-- The free, exact half of duplicate detection: the same advert fetched twice
-- from the same provider can only be stored once. Partial, because
-- `external_id` is NULL for every manually entered job and SQLite treats each
-- NULL as distinct — a plain UNIQUE would permit unlimited duplicate manual
-- rows while looking like it prevented them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_external_id
  ON jobs (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS applications (
  id                TEXT    PRIMARY KEY NOT NULL,
  job_id            TEXT    NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  status            TEXT    NOT NULL CHECK (status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected')),
  applied_date      TEXT,
  notes             TEXT,
  next_action       TEXT,
  next_action_date  TEXT,
  updated_at        TEXT    NOT NULL
);

-- Backs the board view, which reads one column at a time.
CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (status);

-- Backs the "what is due" view. Rows with no next action are excluded: they are
-- the majority and they are never the answer to "what is due by <date>".
CREATE INDEX IF NOT EXISTS idx_applications_next_action_date
  ON applications (next_action_date)
  WHERE next_action_date IS NOT NULL;

-- SQLite does NOT index a foreign key for you. Without this, every
-- `DELETE FROM jobs` has to scan the whole applications table to find the rows
-- to cascade. Cheap here, impossible to add later without a new migration.
CREATE INDEX IF NOT EXISTS idx_applications_job_id
  ON applications (job_id);

CREATE TABLE IF NOT EXISTS cvs (
  id              TEXT    PRIMARY KEY NOT NULL,
  name            TEXT    NOT NULL,
  file_path       TEXT,
  extracted_text  TEXT,
  created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
  id           TEXT     PRIMARY KEY NOT NULL,
  cv_id        TEXT     NOT NULL REFERENCES cvs (id) ON DELETE CASCADE,
  job_id       TEXT     REFERENCES jobs (id) ON DELETE SET NULL,
  provider     TEXT     NOT NULL,
  model        TEXT     NOT NULL,
  match_score  INTEGER  NOT NULL,
  result_json  TEXT     NOT NULL,
  created_at   TEXT     NOT NULL
);

-- Deleting a CV takes its analyses with it; deleting a job does not, because a
-- past analysis is still useful evidence after the advert is gone. `job_id`
-- becomes NULL and the analysis reads as a job-agnostic CV review.
CREATE INDEX IF NOT EXISTS idx_analyses_cv_id
  ON analyses (cv_id);

CREATE INDEX IF NOT EXISTS idx_analyses_job_id
  ON analyses (job_id)
  WHERE job_id IS NOT NULL;
