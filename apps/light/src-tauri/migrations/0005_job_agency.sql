-- Preserve the recruitment agency separately from the hiring company.
-- Existing jobs remain valid with agency set to NULL.
ALTER TABLE jobs ADD COLUMN agency TEXT;