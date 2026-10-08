//! Database wiring for `tauri-plugin-sql`.
//!
//! Two things live here and nothing else: the URL string, and the migration
//! list. Both are traps if they drift, and both are guarded by the tests at the
//! bottom of this file.

use tauri_plugin_sql::{Migration, MigrationKind};

/// The database URL.
///
/// ==========================================================================
/// THIS MUST BYTE-MATCH `DB_URL` IN `src/db/constants.ts`.
/// ==========================================================================
/// The plugin stores migrations in a `HashMap` keyed by the string passed to
/// `add_migrations`, and looks them up with the string passed to
/// `Database.load()` on the JavaScript side:
///
/// ```text
/// migrations.0.lock().await.remove(&db)     // commands.rs::load
/// ```
///
/// `HashMap::remove` on a key that does not match returns `None`, which the
/// plugin reads as "this database has no migrations". Nothing logs, nothing
/// errors: the app opens an EMPTY database and the first query fails with
/// "no such table". `db_url_matches_the_typescript_constant` below reads the
/// TypeScript file at compile time so the two cannot drift apart silently.
/// ==========================================================================
pub const DB_URL: &str = "sqlite:cviper.db";

/// The migration list, oldest first.
///
/// ==========================================================================
/// APPEND ONLY. NEVER EDIT AN ENTRY, NEVER EDIT A `.sql` FILE THAT SHIPPED.
/// ==========================================================================
/// sqlx records a checksum of every applied migration. Changing one byte of an
/// already-applied migration makes the app refuse to start against any database
/// that ran it — including every user's.
///
/// There are no `MigrationKind::Down` entries and there never will be. The
/// plugin's `MigrationSource::resolve()` keeps only the entries matching
/// `MigrationKind::Up` and DISCARDS the rest, so a `Down` migration here would
/// be documentation of a rollback that cannot happen. Forward-only is not a
/// preference; it is the only behaviour the plugin has.
/// ==========================================================================
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema: jobs, applications, cvs, analyses",
            // A real `.sql` file rather than an inline string: reviewable in a
            // diff, greppable, and readable by the TypeScript test that checks
            // every column is mapped in `src/db/rows.ts`.
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "cvs.json_resume: the original JSON Resume document, for export (L-20b)",
            sql: include_str!("../migrations/0002_cv_json_resume.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "profile: the candidate profile, one row with a fixed id (L-154)",
            sql: include_str!("../migrations/0003_profile.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "documents: texts archived against an application (L-155)",
            sql: include_str!("../migrations/0004_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "jobs.agency: preserve the recruitment agency separately",
            sql: include_str!("../migrations/0005_job_agency.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "interview_substages and applications.interview_substage_id (L-205)",
            sql: include_str!("../migrations/0006_interview_substages.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "job_workflow: a job's Tailor work in progress, kept across a restart (L-199)",
            sql: include_str!("../migrations/0007_job_workflow.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "cvs.original_text: the file's own text, kept once the user corrects it (L-218)",
            sql: include_str!("../migrations/0008_cv_original_text.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript side of `DB_URL`, embedded at compile time.
    const CONSTANTS_TS: &str = include_str!("../../src/db/constants.ts");

    /// Drop `--` comments so a rule about SQL cannot be tripped by prose.
    fn executable_sql(sql: &str) -> String {
        sql.lines()
            .map(|line| match line.find("--") {
                Some(index) => &line[..index],
                None => line,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn db_url_matches_the_typescript_constant() {
        let declaration = format!("export const DB_URL = '{DB_URL}';");
        assert!(
            CONSTANTS_TS.contains(&declaration),
            "src/db/constants.ts must declare exactly `{declaration}` — the plugin looks \
             migrations up by this exact string and a mismatch silently skips all of them"
        );
    }

    #[test]
    fn every_migration_is_an_up_migration() {
        for migration in migrations() {
            assert!(
                matches!(migration.kind, MigrationKind::Up),
                "migration {} is not Up — tauri-plugin-sql silently discards anything else",
                migration.version
            );
        }
    }

    #[test]
    fn migration_versions_are_unique_and_ascending() {
        let versions: Vec<i64> = migrations().iter().map(|m| m.version).collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(versions, sorted, "migration versions must be unique and ascending");
    }

    #[test]
    fn the_second_migration_only_adds_json_resume_to_cvs() {
        // L-20b. Additive and forward-only: one column on one table, nothing
        // created, dropped or rewritten. `rows.test.ts` reads the same file to
        // check the column is mapped.
        let migration = &migrations()[1];
        assert_eq!(migration.version, 2);
        let sql = executable_sql(migration.sql);
        assert!(
            sql.contains("ALTER TABLE cvs ADD COLUMN json_resume TEXT"),
            "0002 must add cvs.json_resume"
        );
        for forbidden in ["CREATE TABLE", "DROP", "RENAME", "UPDATE", "DELETE"] {
            assert!(!sql.contains(forbidden), "0002 must be additive; found `{forbidden}`");
        }
    }

    #[test]
    fn the_third_migration_creates_only_the_profile_table() {
        // L-154. One new table and nothing else: no index (a single fixed-id
        // row needs none), nothing altered, nothing dropped. `rows.test.ts`
        // reads the same file to check every column is mapped.
        let migration = &migrations()[2];
        assert_eq!(migration.version, 3);
        let sql = executable_sql(migration.sql);
        assert_eq!(
            sql.matches("CREATE TABLE IF NOT EXISTS").count(),
            1,
            "0003 must create exactly one table"
        );
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS profile ("),
            "0003 must create `profile`"
        );
        for forbidden in ["CREATE INDEX", "ALTER TABLE", "DROP", "RENAME", "UPDATE", "DELETE FROM"] {
            assert!(!sql.contains(forbidden), "0003 must only create; found `{forbidden}`");
        }
    }

    #[test]
    fn the_fourth_migration_creates_only_the_documents_table_and_its_index() {
        // L-155. One table, one index on its foreign key — SQLite does not
        // index a foreign key for you, and `applications` cascades into it.
        let migration = &migrations()[3];
        assert_eq!(migration.version, 4);
        let sql = executable_sql(migration.sql);
        assert_eq!(
            sql.matches("CREATE TABLE IF NOT EXISTS").count(),
            1,
            "0004 must create exactly one table"
        );
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS documents ("),
            "0004 must create `documents`"
        );
        assert_eq!(
            sql.matches("CREATE INDEX IF NOT EXISTS").count(),
            1,
            "0004 must create exactly one index"
        );
        assert!(
            sql.contains("CREATE INDEX IF NOT EXISTS idx_documents_application_id"),
            "0004 must index documents.application_id"
        );
        assert!(
            sql.contains("REFERENCES applications (id) ON DELETE CASCADE"),
            "a document belongs to one application and goes with it"
        );
        for forbidden in ["ALTER TABLE", "DROP", "RENAME", "UPDATE", "DELETE FROM"] {
            assert!(!sql.contains(forbidden), "0004 must only create; found `{forbidden}`");
        }
    }

    #[test]
    fn the_fifth_migration_only_adds_nullable_agency_to_jobs() {
        let migration = &migrations()[4];
        assert_eq!(migration.version, 5);
        let sql = executable_sql(migration.sql);
        assert!(
            sql.contains("ALTER TABLE jobs ADD COLUMN agency TEXT"),
            "0005 must add nullable jobs.agency without rewriting existing records"
        );
        for forbidden in ["CREATE TABLE", "DROP", "RENAME", "UPDATE", "DELETE"] {
            assert!(!sql.contains(forbidden), "0005 must be additive; found `{forbidden}`");
        }
    }

    #[test]
    fn the_sixth_migration_adds_interview_substages_without_touching_existing_rows() {
        // L-205. One new table, plus one nullable column on `applications`.
        // Additive only: an existing row keeps working with the column NULL, and
        // removing a sub-stage sets it back to NULL rather than deleting the
        // card (`ON DELETE SET NULL`). The SQL itself is run against a real
        // SQLite, over a database that already holds data, by
        // `src/db/migration.interviewSubstages.test.ts`.
        let migration = &migrations()[5];
        assert_eq!(migration.version, 6);
        assert!(matches!(migration.kind, MigrationKind::Up));
        let sql = executable_sql(migration.sql);
        assert_eq!(
            sql.matches("CREATE TABLE IF NOT EXISTS").count(),
            1,
            "0006 must create exactly one table"
        );
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS interview_substages ("),
            "0006 must create `interview_substages`"
        );
        assert!(
            sql.contains("ALTER TABLE applications ADD COLUMN interview_substage_id TEXT"),
            "0006 must add nullable applications.interview_substage_id"
        );
        assert!(
            sql.contains("REFERENCES interview_substages (id) ON DELETE SET NULL"),
            "removing a sub-stage must unset the cards that use it, never delete them"
        );
        assert!(
            !sql.contains("NOT NULL DEFAULT") && !sql.contains("interview_substage_id TEXT NOT NULL"),
            "the new column must stay nullable so every existing row is valid"
        );
        for forbidden in ["DROP", "RENAME", "UPDATE ", "DELETE FROM", "INSERT"] {
            assert!(!sql.contains(forbidden), "0006 must be additive; found `{forbidden}`");
        }
    }

    #[test]
    fn the_eighth_migration_only_adds_nullable_original_text_to_cvs() {
        // L-218. One nullable column on `cvs`, and nothing else: every CV that
        // exists reads as "never corrected". Run for real over a database
        // holding data by `src/db/migration.cvOriginalText.test.ts`.
        let migration = &migrations()[7];
        assert_eq!(migration.version, 8);
        assert!(matches!(migration.kind, MigrationKind::Up));
        let sql = executable_sql(migration.sql);
        assert!(
            sql.contains("ALTER TABLE cvs ADD COLUMN original_text TEXT;"),
            "0008 must add nullable cvs.original_text"
        );
        assert_eq!(sql.matches("ALTER TABLE").count(), 1, "0008 alters one table once");
        for forbidden in ["CREATE", "DROP", "RENAME", "UPDATE", "DELETE", "NOT NULL", "INSERT"] {
            assert!(!sql.contains(forbidden), "0008 must not contain {forbidden}");
        }
    }

    #[test]
    fn the_seventh_migration_only_creates_job_workflow() {
        // L-199. One new table and nothing else: no existing table is altered,
        // so a user's data reads exactly as before. The row goes with its job
        // (`ON DELETE CASCADE`), and deleting a CV only unsets it. Run for real
        // over a database holding data by `src/db/migration.jobWorkflow.test.ts`.
        let migration = &migrations()[6];
        assert_eq!(migration.version, 7);
        assert!(matches!(migration.kind, MigrationKind::Up));
        let sql = executable_sql(migration.sql);
        assert_eq!(
            sql.matches("CREATE TABLE IF NOT EXISTS").count(),
            1,
            "0007 must create exactly one table"
        );
        assert!(
            sql.contains("CREATE TABLE IF NOT EXISTS job_workflow ("),
            "0007 must create `job_workflow`"
        );
        assert!(
            sql.contains("REFERENCES jobs (id) ON DELETE CASCADE"),
            "a job's work in progress must go with the job"
        );
        assert!(
            sql.contains("REFERENCES cvs (id) ON DELETE SET NULL"),
            "deleting a CV must never delete a job's work in progress"
        );
        for forbidden in ["ALTER", "DROP", "RENAME", "UPDATE ", "DELETE FROM", "INSERT"] {
            assert!(!sql.contains(forbidden), "0007 must only create; found `{forbidden}`");
        }
    }

    #[test]
    fn the_first_migration_creates_all_four_tables() {
        let sql = migrations()[0].sql;
        for table in ["jobs", "applications", "cvs", "analyses"] {
            assert!(
                sql.contains(&format!("CREATE TABLE IF NOT EXISTS {table} (")),
                "0001_init.sql does not create `{table}`"
            );
        }
    }

    #[test]
    fn no_migration_runs_a_pragma() {
        // `PRAGMA foreign_keys` is per-connection and is NOT stored in the
        // database file. In a migration it would apply to the one connection
        // that ran it and to nothing afterwards, while reading like a
        // database-wide guarantee. It belongs in `src/db/client.ts`.
        for migration in migrations() {
            let sql = executable_sql(migration.sql).to_uppercase();
            assert!(
                !sql.contains("PRAGMA"),
                "migration {} executes a PRAGMA — see the note in 0001_init.sql",
                migration.version
            );
        }
    }

    #[test]
    fn the_comment_stripper_keeps_real_sql_and_drops_prose() {
        let stripped = executable_sql("-- PRAGMA foreign_keys = ON;\nSELECT 1; -- PRAGMA\n");
        assert!(!stripped.contains("PRAGMA"));
        assert!(stripped.contains("SELECT 1;"));
    }
}
