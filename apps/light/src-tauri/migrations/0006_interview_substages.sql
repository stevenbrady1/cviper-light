-- Customisable interview sub-stages (L-205).
--
-- ADDITIVE ONLY. A user's existing applications keep working untouched: the new
-- column is nullable with no default, so every row that exists today reads
-- "no sub-stage".
--
-- A sub-stage is a label the user hangs on a card that is already
-- `interviewing` ("HR Screen", "Technical Test", "Panel Round", "Final"). It is
-- NOT a new status: `applications.status` stays the five frozen values.
--
-- Removing a sub-stage must never damage a card, so the reference is
-- `ON DELETE SET NULL`: the card stays exactly where it is and only loses its
-- label. SQLite allows `ADD COLUMN ... REFERENCES` when the default is NULL.
CREATE TABLE IF NOT EXISTS interview_substages (
  id        TEXT     PRIMARY KEY NOT NULL,
  name      TEXT     NOT NULL,
  position  INTEGER  NOT NULL
);

ALTER TABLE applications ADD COLUMN interview_substage_id TEXT REFERENCES interview_substages (id) ON DELETE SET NULL;
