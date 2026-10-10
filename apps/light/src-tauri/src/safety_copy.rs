//! One safety copy of the database, made just before an update changes it
//! (L-227).
//!
//! ==========================================================================
//! WHY
//! ==========================================================================
//! Migrations run on the first launch after an update, are forward-only (see
//! `db.rs`), and used to run on the only copy of the user's job hunt. One bad
//! migration and it was gone, with nothing to restore from but a manual export
//! most people never make.
//!
//! So at startup, BEFORE the frontend opens the database (which is what runs
//! the migrations), this copies the file aside — but only when the schema the
//! app ships is newer than the one last seen, which is exactly the launch on
//! which a migration can run. Every other launch costs one tiny file read.
//!
//! ==========================================================================
//! ONE COPY, LISTED, AND ERASED WITH EVERYTHING ELSE
//! ==========================================================================
//! The copy holds the same CVs and applications as the database, so it is held
//! to the same promises: it is named in the privacy notice (`dataLocations.ts`),
//! "Delete everything" removes it (`safety_copy_delete`, called by the erase
//! port's database step), and there is only ever ONE — each update replaces
//! the last, so old data does not pile up on disk.
//!
//! The marker file beside it holds a schema version number and nothing else.
//!
//! A failed copy never stops the app from starting: refusing to open over a
//! full disk would be worse than the risk the copy guards against.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

/// Appended to the database filename. MUST byte-match `SAFETY_COPY_SUFFIX` in
/// `src/db/constants.ts`, which the privacy notice reads; a test below checks.
pub const SAFETY_COPY_SUFFIX: &str = ".before-update";

/// Appended to the database filename for the schema-version marker.
const SCHEMA_MARKER_SUFFIX: &str = ".schema";

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// No database yet (a fresh install): nothing to protect.
    NoDatabase,
    /// The schema has not changed since the last launch: no migration can run.
    AlreadyCurrent,
    /// A migration may run on this launch, and the copy was made first.
    Copied,
}

fn with_suffix(dir: &Path, db_file: &str, suffix: &str) -> PathBuf {
    dir.join(format!("{db_file}{suffix}"))
}

/// Copy `from` to `to` through a temporary file, so a crash mid-copy never
/// leaves a half-written file under the real name.
fn copy_atomically(from: &Path, to: &Path) -> io::Result<()> {
    let partial = to.with_extension("partial");
    fs::copy(from, &partial)?;
    fs::rename(&partial, to)
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// Make the safety copy if, and only if, a migration may run on this launch.
pub fn make_safety_copy(dir: &Path, db_file: &str, latest_schema: i64) -> io::Result<Outcome> {
    let marker = with_suffix(dir, db_file, SCHEMA_MARKER_SUFFIX);
    let last_seen = fs::read_to_string(&marker)
        .ok()
        .and_then(|text| text.trim().parse::<i64>().ok());
    if last_seen == Some(latest_schema) {
        return Ok(Outcome::AlreadyCurrent);
    }

    let database = dir.join(db_file);
    let outcome = if database.is_file() {
        let copy = with_suffix(dir, db_file, SAFETY_COPY_SUFFIX);
        copy_atomically(&database, &copy)?;

        // SQLite in WAL mode can hold committed pages in `-wal` until a
        // checkpoint — after a crash, for instance. A copy without it would be
        // missing them, so it travels with the copy under SQLite's own naming.
        let wal = with_suffix(dir, db_file, "-wal");
        let copy_wal = with_suffix(dir, db_file, &format!("{SAFETY_COPY_SUFFIX}-wal"));
        if wal.is_file() {
            copy_atomically(&wal, &copy_wal)?;
        } else {
            remove_if_present(&copy_wal)?;
        }
        Outcome::Copied
    } else {
        Outcome::NoDatabase
    };

    // Written last: if the copy failed, the next launch tries again.
    fs::write(&marker, latest_schema.to_string())?;
    Ok(outcome)
}

/// Remove the safety copy, for "Delete everything". Absent is success.
pub fn delete_safety_copy(dir: &Path, db_file: &str) -> io::Result<()> {
    remove_if_present(&with_suffix(dir, db_file, SAFETY_COPY_SUFFIX))?;
    remove_if_present(&with_suffix(dir, db_file, &format!("{SAFETY_COPY_SUFFIX}-wal")))
}

/// The data folder the SQL plugin keeps the database in (`app_config_dir`).
pub fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

/// "Delete everything" removes the safety copy along with the database rows.
#[tauri::command]
pub fn safety_copy_delete<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let refusal = || "The safety copy of your data could not be deleted.".to_string();
    let dir = data_dir(&app).ok_or_else(refusal)?;
    delete_safety_copy(&dir, crate::db::db_file()).map_err(|_| refusal())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const CONSTANTS_TS: &str = include_str!("../../src/db/constants.ts");
    const DB: &str = "cviper.db";

    fn scratch() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "cviper-safety-copy-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn copy_of(dir: &Path) -> PathBuf {
        dir.join(format!("{DB}{SAFETY_COPY_SUFFIX}"))
    }

    #[test]
    fn a_fresh_install_has_nothing_to_copy() {
        let dir = scratch();
        assert_eq!(make_safety_copy(&dir, DB, 9).unwrap(), Outcome::NoDatabase);
        assert!(!copy_of(&dir).exists());
        assert_eq!(fs::read_to_string(dir.join("cviper.db.schema")).unwrap(), "9");
    }

    #[test]
    fn an_existing_database_is_copied_before_its_first_launch_on_a_new_schema() {
        let dir = scratch();
        fs::write(dir.join(DB), b"the job hunt").unwrap();
        assert_eq!(make_safety_copy(&dir, DB, 9).unwrap(), Outcome::Copied);
        assert_eq!(fs::read(copy_of(&dir)).unwrap(), b"the job hunt");
    }

    #[test]
    fn the_same_schema_is_not_copied_again() {
        let dir = scratch();
        fs::write(dir.join(DB), b"before").unwrap();
        make_safety_copy(&dir, DB, 9).unwrap();
        fs::write(dir.join(DB), b"after a day of use").unwrap();
        assert_eq!(make_safety_copy(&dir, DB, 9).unwrap(), Outcome::AlreadyCurrent);
        assert_eq!(fs::read(copy_of(&dir)).unwrap(), b"before");
    }

    #[test]
    fn a_newer_schema_replaces_the_one_copy_rather_than_adding_another() {
        let dir = scratch();
        fs::write(dir.join(DB), b"v9 data").unwrap();
        make_safety_copy(&dir, DB, 9).unwrap();
        fs::write(dir.join(DB), b"v9 data, later").unwrap();
        assert_eq!(make_safety_copy(&dir, DB, 10).unwrap(), Outcome::Copied);
        assert_eq!(fs::read(copy_of(&dir)).unwrap(), b"v9 data, later");
        let copies = fs::read_dir(&dir)
            .unwrap()
            .filter(|entry| {
                let name = entry.as_ref().unwrap().file_name();
                name.to_string_lossy().contains(SAFETY_COPY_SUFFIX)
            })
            .count();
        assert_eq!(copies, 1, "exactly one safety copy, never a pile");
    }

    #[test]
    fn the_write_ahead_log_travels_with_the_copy_and_a_stale_one_is_removed() {
        let dir = scratch();
        fs::write(dir.join(DB), b"main").unwrap();
        fs::write(dir.join("cviper.db-wal"), b"uncheckpointed pages").unwrap();
        make_safety_copy(&dir, DB, 9).unwrap();
        let copy_wal = dir.join(format!("{DB}{SAFETY_COPY_SUFFIX}-wal"));
        assert_eq!(fs::read(&copy_wal).unwrap(), b"uncheckpointed pages");

        fs::remove_file(dir.join("cviper.db-wal")).unwrap();
        make_safety_copy(&dir, DB, 10).unwrap();
        assert!(!copy_wal.exists(), "a log from an older copy must not pair with a newer one");
    }

    #[test]
    fn boundary_an_unreadable_marker_is_treated_as_an_older_schema() {
        let dir = scratch();
        fs::write(dir.join(DB), b"data").unwrap();
        fs::write(dir.join("cviper.db.schema"), b"not a number").unwrap();
        assert_eq!(make_safety_copy(&dir, DB, 9).unwrap(), Outcome::Copied);
    }

    #[test]
    fn delete_removes_the_copy_and_its_log_and_is_fine_when_there_is_none() {
        let dir = scratch();
        fs::write(dir.join(DB), b"data").unwrap();
        fs::write(dir.join("cviper.db-wal"), b"log").unwrap();
        make_safety_copy(&dir, DB, 9).unwrap();
        delete_safety_copy(&dir, DB).unwrap();
        assert!(!copy_of(&dir).exists());
        assert!(!dir.join(format!("{DB}{SAFETY_COPY_SUFFIX}-wal")).exists());
        assert!(dir.join(DB).exists(), "deleting the copy never touches the database");
        delete_safety_copy(&dir, DB).unwrap();
    }

    #[test]
    fn the_suffix_matches_the_typescript_constant() {
        let declaration = format!("export const SAFETY_COPY_SUFFIX = '{SAFETY_COPY_SUFFIX}';");
        assert!(
            CONSTANTS_TS.contains(&declaration),
            "src/db/constants.ts must declare exactly `{declaration}` — the privacy notice names \
             the file by it"
        );
    }
}
