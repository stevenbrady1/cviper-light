-- 0004: documents archived against an application (L-155).
--
-- One row per piece of text kept with an application: the advert as it was
-- posted, the CV that was sent, the cover letter, a follow-up, an interview
-- pack. A document has no life of its own — it is evidence of one application
-- — so `application_id` is NOT NULL and deleting the application takes its
-- documents with it. Nothing else references a document.
--
-- `kind` is NOT CHECK-constrained, on purpose. The set (`DocumentKind` in
-- @cviper/core-types) is expected to grow, and a CHECK in an append-only
-- migration would turn "add a kind" into "write a migration that rebuilds the
-- table". It is validated by Zod on the way in and on the way out, exactly as
-- `jobs.source` is — see the note on CHECK constraints in 0001_init.sql.
--
-- Append-only and forward-only, like every file in this folder. Schema changes
-- go in a NEW numbered file.

CREATE TABLE IF NOT EXISTS documents (
  id              TEXT  PRIMARY KEY NOT NULL,
  application_id  TEXT  NOT NULL REFERENCES applications (id) ON DELETE CASCADE,
  kind            TEXT  NOT NULL,
  title           TEXT  NOT NULL,
  text            TEXT  NOT NULL,
  created_at      TEXT  NOT NULL
);

-- SQLite does NOT index a foreign key for you. Without this, every
-- `DELETE FROM applications` scans the whole documents table to find the rows
-- to cascade, and "the documents for this application" is a scan too.
CREATE INDEX IF NOT EXISTS idx_documents_application_id
  ON documents (application_id);
