/** Tunables for CV ingestion. Kept in one place so a limit is never inlined twice. */

/**
 * The largest file this package will attempt to parse: 10 MiB.
 *
 * A text-based CV is almost always under 200 KB. Files that blow past this are
 * scans, or documents with a photo on every page — the exact inputs that make a
 * parser allocate hundreds of megabytes and take the whole app down with it.
 * Checked BEFORE any parsing, so a hostile file cannot spend our memory before
 * we have decided whether we want it.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
