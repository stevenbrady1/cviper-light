-- Work in progress on one job, kept across a restart (L-199).
--
-- ADDITIVE ONLY: one new table, nothing existing is touched. A user's jobs,
-- applications and documents read exactly as they did before.
--
-- One row per job the user has started tailoring for. `id` IS THE JOB'S ID —
-- named `id` so the shared upsert (`ON CONFLICT (id)`) works unchanged — and
-- goes with the job: deleting a job deletes its work in progress.
--
-- `draft_json` is the unsaved tailored CV, its review and the letter, as the
-- Tailor screen holds them. It is a WORKING copy, not a record: what the user
-- keeps is still archived as a `documents` row when they press "Save to an
-- application". That is also why this table is not in a backup.
--
-- `cv_id` is `ON DELETE SET NULL`: deleting a CV must never delete a job's
-- work, and Tailor falls back to the newest CV when the one chosen is gone.
--
-- Append-only and forward-only, like every file in this folder.

CREATE TABLE IF NOT EXISTS job_workflow (
  id          TEXT  PRIMARY KEY NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  step        TEXT  NOT NULL,
  cv_id       TEXT  REFERENCES cvs (id) ON DELETE SET NULL,
  ai_option   TEXT,
  advert      TEXT  NOT NULL,
  draft_json  TEXT,
  updated_at  TEXT  NOT NULL
);
