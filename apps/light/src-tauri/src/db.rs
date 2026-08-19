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
    vec![Migration {
        version: 1,
        description: "initial schema: jobs, applications, cvs, analyses",
        // A real `.sql` file rather than an inline string: reviewable in a diff,
        // greppable, and readable by the TypeScript test that checks every
        // column is mapped in `src/db/rows.ts`.
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
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
