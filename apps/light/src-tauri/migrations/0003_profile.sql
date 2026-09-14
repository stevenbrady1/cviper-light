-- 0003: the candidate profile — who the user is, what they want, and what they
-- will not take (L-154).
--
-- ONE ROW. There is one user of this app and one profile, so `id` is the fixed
-- string `me` (`PROFILE_ID` in @cviper/core-types) rather than a UUID: every
-- save is an upsert onto the same row, and there is nothing to list. A second
-- row cannot be written by the app, and one that arrived by hand would simply
-- never be read.
--
-- THE `_json` COLUMNS hold JSON arrays as TEXT — a list of strings, or a list
-- of small objects (languages, STAR examples). They are parsed on the way out
-- and serialised on the way in by `src/db/rows.ts` and nowhere else, exactly
-- as `analyses.result_json` is. Separate child tables would be the relational
-- answer, and the wrong one here: the lists are edited as a block from one
-- screen, never queried across, and a single row keeps "save the profile"
-- one statement inside one transaction.
--
-- No index: a primary-key lookup on one row needs none.
--
-- Append-only and forward-only, like every file in this folder — see the
-- header of 0001_init.sql. Schema changes go in a NEW numbered file.

CREATE TABLE IF NOT EXISTS profile (
  id                   TEXT  PRIMARY KEY NOT NULL,
  headline             TEXT,
  languages_json       TEXT  NOT NULL,
  work_rights          TEXT,
  deal_breakers_json   TEXT  NOT NULL,
  target_sectors_json  TEXT  NOT NULL,
  career_goals_json    TEXT  NOT NULL,
  energising_json      TEXT  NOT NULL,
  draining_json        TEXT  NOT NULL,
  writing_style        TEXT,
  star_examples_json   TEXT  NOT NULL,
  updated_at           TEXT  NOT NULL
);
