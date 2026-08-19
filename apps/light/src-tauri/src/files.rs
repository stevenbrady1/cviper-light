//! Reading and writing the only two kinds of file this app touches: a CV the
//! user picked, and a backup the user is saving or restoring.
//!
//! ============================================================================
//! THERE IS NO GENERAL-PURPOSE FILE COMMAND HERE, AND THERE MUST NEVER BE.
//! ============================================================================
//! The same reasoning as `providers.rs`: a `read_file(path)` command would hand
//! any injected script in the WebView the ability to read anything the user can
//! read — SSH keys, browser profiles, the lot — and this app deliberately feeds
//! attacker-written job adverts into a language model all day.
//!
//! ============================================================================
//! JAVASCRIPT DOES NOT NAME THE FILE. IT ASKS FOR A DIALOG.
//! ============================================================================
//! This module used to take the path from JavaScript, because the OS file
//! dialog ran there and handed one back. Every other decision was already
//! Rust's — extension, size, is-it-really-a-file — but the path itself was
//! whatever the caller said, so any `.pdf`, `.docx`, `.doc` or `.json` anywhere
//! on the disk was readable by anything that could reach `invoke`.
//!
//! The dialog now runs HERE. A command opens it, waits for the user, and reads
//! or writes ONLY the path that came back out of it. There is no parameter left
//! to lie about. This is the same decision as `secrets::secret_get`, which is
//! deliberately not a command so that a key cannot be requested from
//! JavaScript: if the frontend cannot name the thing, the frontend cannot ask
//! for an arbitrary one. `no_command_accepts_a_filesystem_path` enforces it
//! across the whole crate, not only this file.
//!
//! Paths still travel OUTWARD — a CV row records where it came from, and the
//! export message says where the backup went. That direction is a report of
//! what the user just did in a dialog they were looking at, and it opens
//! nothing.
//!
//! The earlier note here said running the dialog from Rust "cannot be tested
//! without a display server, and an untestable security boundary is not one".
//! What is untestable turns out to be only the dialog call itself: three lines
//! with no branch in them. Everything that decides whether a file may be
//! touched still lives in a plain function — `check_readable`, `read_cv_at`,
//! `read_backup_at`, `write_backup_at`, `bare_file_name` — and is tested below
//! on real files with no display server anywhere:
//!
//!   * the EXTENSION must be one this app actually reads. A CV is pdf/docx/doc
//!     and nothing else; a backup is json and nothing else. So even a user who
//!     picks their own private key in the dialog gets a refusal, not a read.
//!   * the SIZE is checked from the directory entry BEFORE a byte is read, so a
//!     hostile or accidental 4 GB file cannot spend our memory before we have
//!     decided we do not want it.
//!   * it must be a FILE. A directory, a device node or a named pipe is
//!     refused rather than opened and blocked on.
//!
//! And the part that genuinely could not be tested before — that no command
//! anywhere accepts a path — is now the one thing a test CAN check exactly.
//!
//! ============================================================================
//! NOTHING INTERPOLATES THE PATH INTO AN ERROR
//! ============================================================================
//! Same rule as `secrets::describe` and `providers::describe_request_failure`:
//! every message is a fixed sentence. An error string ends up in a log, a
//! screenshot or a bug report, and the caller already knows which file it
//! asked about. `no_message_leaks_the_path` enforces it.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

/// The largest CV we will read, in bytes.
///
/// MUST MATCH `MAX_FILE_BYTES` in `packages/cv-parsing/src/constants.ts`. The
/// TypeScript side produces a far better message for an oversized file ("a CV
/// is normally well under 1 MB, so a file this big is usually a scan"), so this
/// limit is a memory guard rather than the user-facing rule, and it is set to
/// exactly the same number so the two can never disagree about which files are
/// readable. `cv_limit_matches_the_typescript_constant` asserts it.
const MAX_CV_BYTES: u64 = 10 * 1024 * 1024;

/// The largest backup we will read or write, in bytes.
///
/// A backup is JSON containing every job, application, CV text and analysis the
/// user has. Ten thousand applications with full advert text is a few tens of
/// megabytes, so 128 MB is far past any real file and still small enough that
/// reading one into a string cannot exhaust a desktop machine.
const MAX_BACKUP_BYTES: u64 = 128 * 1024 * 1024;

/// Extensions the CV dialog offers and `read_cv_at` will open. Lower-case, no
/// dot.
///
/// `doc` is here even though nothing can parse it: `@cviper/cv-parsing` answers
/// a legacy Word file with "open it in Word and use Save As", which is the most
/// useful thing anyone can tell that user. Refusing to read the bytes here
/// would replace that advice with "unsupported format".
const CV_EXTENSIONS: [&str; 3] = ["pdf", "docx", "doc"];

/// Extensions the backup commands will touch. Lower-case, no dot.
const BACKUP_EXTENSIONS: [&str; 1] = ["json"];

/// What the save dialog is pre-filled with when the frontend's suggestion is
/// not a plain file name. See `bare_file_name`.
const FALLBACK_BACKUP_NAME: &str = "cviper-backup.json";

/// The longest suggested file name we will hand to the dialog.
///
/// Windows caps one path component at 255 characters; 128 is comfortably inside
/// that and far past `cviper-backup-2026-08-19.json`.
const MAX_SUGGESTED_NAME_CHARS: usize = 128;

/// A CV, read.
///
/// ============================================================================
/// THE BYTES TRAVEL AS BASE64, NOT AS A `Vec<u8>`.
/// ============================================================================
/// Tauri serialises a command's return value with serde_json, and a `Vec<u8>`
/// becomes a JSON ARRAY OF NUMBERS: roughly `"255,"` — four to five characters
/// — per byte, which turns a 2 MB PDF into 8 MB of JSON that JavaScript then
/// parses into two million boxed numbers.
///
/// Base64 is 1.33x instead of 4x, decodes in one `atob` call, and — the reason
/// it was chosen over Tauri's raw-response channel — its behaviour across the
/// boundary is completely determined by this file plus `atob`, so both halves
/// can be tested without a running WebView.
#[derive(Serialize)]
pub struct CvFile {
    /// The file's own name, e.g. `Steven Brady CV.pdf`. What the CV is labelled
    /// with on screen.
    name: String,
    /// Where the user took it from, for the `file_path` column on the CV row.
    /// Reported, never accepted — see the module comment.
    path: String,
    /// Standard base64, with padding. Decode with `atob`.
    bytes_base64: String,
}

/// Hand-written rather than derived, so a failed `unwrap` prints "3 MB of CV"
/// instead of three megabytes of base64 into a test log or a panic message.
impl std::fmt::Debug for CvFile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("CvFile")
            .field("name", &self.name)
            .field("base64_chars", &self.bytes_base64.len())
            .finish()
    }
}

/// A backup file, read.
///
/// The JSON is NOT parsed here. `importBackup` in `@cviper/core-types` owns
/// every word of every validation message, and a second opinion from Rust would
/// mean two places to keep in step and two different sentences for the same
/// broken file.
#[derive(Debug, Serialize)]
pub struct BackupFile {
    /// The file's own name. The import confirmation asks "Import from
    /// backup.json?", and that name is the only thing on screen telling the
    /// user which file is about to replace their data.
    name: String,
    /// Where it came from. Reported, never accepted.
    path: String,
    /// The file's contents, untouched.
    text: String,
}

/// Standard base64 alphabet (RFC 4648).
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encode bytes as padded standard base64.
///
/// Hand-rolled rather than taken as a dependency: it is fifteen lines, it is
/// exhaustively tested below against the RFC's own vectors, and adding a crate
/// to a security-sensitive module for fifteen lines is a worse trade than
/// writing them.
fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        // Missing bytes read as zero; the padding below is what says they were
        // not there.
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(B64[(triple >> 18) as usize & 0x3f] as char);
        out.push(B64[(triple >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            B64[(triple >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[triple as usize & 0x3f] as char
        } else {
            '='
        });
    }

    out
}

/// The lower-cased extension of a path, or `None` when it has none.
fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
}

/// The file's own name, or an empty string for a path that has none.
fn file_name_of(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string()
}

/// Turn an I/O failure into a sentence. NOTHING is interpolated — see the
/// module comment.
fn describe_io_error(error: &std::io::Error) -> String {
    match error.kind() {
        ErrorKind::NotFound => {
            "That file is no longer there. It may have been moved or renamed since you picked it."
        }
        ErrorKind::PermissionDenied => {
            "Windows would not let CViper open that file. Check it is not open in another program, \
             then try again."
        }
        _ => "That file could not be read. Try a different copy of it.",
    }
    .to_string()
}

/// Everything checked before a single byte is read.
///
/// Split out from the commands so the whole guard can be tested without a
/// dialog and without a Tauri runtime.
fn check_readable(path: &Path, allowed: &[&str], limit: u64, what: &str) -> Result<u64, String> {
    let Some(extension) = extension_of(path) else {
        return Err(format!(
            "That file has no extension, so CViper cannot tell what it is. Pick {what}."
        ));
    };

    if !allowed.contains(&extension.as_str()) {
        return Err(format!("CViper cannot read that kind of file. Pick {what}."));
    }

    let metadata = fs::metadata(path).map_err(|error| describe_io_error(&error))?;

    if !metadata.is_file() {
        return Err("That is a folder, not a file. Pick the file itself.".to_string());
    }

    // Checked from the directory entry, BEFORE opening. See the module comment.
    if metadata.len() > limit {
        return Err(format!(
            "That file is larger than the {} MB CViper will read.",
            limit / (1024 * 1024)
        ));
    }

    Ok(metadata.len())
}

// ── The dialog ──────────────────────────────────────────────────────────────

/// Said when the dialog closes without ever reporting back.
///
/// Only reachable if the callback is dropped un-run, which would be a Tauri bug
/// rather than anything the user did. It is still a sentence rather than a
/// panic: a panicking command takes the IPC call down with a message written
/// for us, not for them.
const DIALOG_LOST: &str = "The file dialog closed unexpectedly. Try again.";

/// Said when the dialog answers with something that is not a local file.
const NOT_A_LOCAL_FILE: &str = "CViper could not tell where that file is. Try picking it again.";

/// How many answers the dialog channel holds. One dialog, one answer.
const ONE_ANSWER: usize = 1;

/// Wait for the dialog the caller has just opened.
///
/// ============================================================================
/// THIS IS WHY NOTHING HERE CALLS `blocking_pick_file`.
/// ============================================================================
/// `blocking_pick_file` and its siblings park the calling thread until the
/// dialog closes. The dialog is driven by the main thread's event loop, so
/// blocking the main thread to wait for it is a deadlock with no error and no
/// window — the app simply stops responding. The callback form has no such
/// rule: the dialog reports back whenever it is done and this future is not
/// ready until it does, so no thread is parked and it does not matter which
/// one the command happens to be running on.
///
/// `Ok(None)` is a cancelled dialog, which is the most common outcome of
/// showing a file picker and is NOT a failure.
async fn wait_for_choice(
    mut answers: tauri::async_runtime::Receiver<Option<FilePath>>,
) -> Result<Option<FilePath>, String> {
    match answers.recv().await {
        Some(chosen) => Ok(chosen),
        None => Err(DIALOG_LOST.to_string()),
    }
}

/// The local path behind a dialog answer.
///
/// The dialog can answer with a URI rather than a path on mobile. There is no
/// local file behind one, and nothing here could read it.
fn local_path(chosen: FilePath) -> Result<PathBuf, String> {
    chosen
        .simplified()
        .into_path()
        .map_err(|_| NOT_A_LOCAL_FILE.to_string())
}

/// Reduce the frontend's suggested save name to something that can only ever be
/// a NAME.
///
/// ============================================================================
/// THE ONE STRING THE FRONTEND STILL CONTRIBUTES, AND IT IS NOT A PATH.
/// ============================================================================
/// The date-stamped default (`cviper-backup-2026-08-19.json`) is built by
/// `defaultBackupFilename` in `src/features/settings/backup.ts`, which knows
/// the user's LOCAL date — something Rust cannot work out from `SystemTime`
/// without a timezone database. Rather than keep a second, differently-wrong
/// copy of that rule here, the suggestion comes across and is checked.
///
/// Anything with a separator, a drive letter, a `..`, a control character or
/// the wrong extension is REPLACED with `FALLBACK_BACKUP_NAME`, never repaired:
/// a corrected value is a value somebody can steer, and there is nothing here
/// worth steering. Even then this only pre-fills a box in a dialog the user has
/// to look at and confirm, and whatever they confirm still goes through
/// `write_backup_at`.
fn bare_file_name(suggested: &str) -> String {
    let is_a_plain_name = !suggested.is_empty()
        && suggested.chars().count() <= MAX_SUGGESTED_NAME_CHARS
        && !suggested.contains(['/', '\\', ':'])
        && !suggested.contains("..")
        && !suggested.chars().any(char::is_control)
        && extension_of(Path::new(suggested)).as_deref() == Some("json");

    if is_a_plain_name {
        suggested.to_string()
    } else {
        FALLBACK_BACKUP_NAME.to_string()
    }
}

// ── Reading and writing, once the user has chosen ───────────────────────────
//
// None of these three is a `#[tauri::command]`, and none may become one: they
// take a path, and the whole point of the commands below is that JavaScript
// cannot supply one. They are separate functions so that every guard can be
// tested on real files without a dialog.

/// Read one CV from the path the user chose in the dialog.
///
/// Returns the bytes untouched. Every decision about whether they are really a
/// PDF, whether the PDF has a text layer, and what to tell the user when it
/// does not, belongs to `@cviper/cv-parsing` — this function's whole job is to
/// get the bytes across the boundary safely.
fn read_cv_at(path: &Path) -> Result<CvFile, String> {
    check_readable(path, &CV_EXTENSIONS, MAX_CV_BYTES, "a PDF or a Word (.docx) CV")?;

    let bytes = fs::read(path).map_err(|error| describe_io_error(&error))?;

    Ok(CvFile {
        name: file_name_of(path),
        path: path.display().to_string(),
        bytes_base64: base64(&bytes),
    })
}

/// Read a backup from the path the user chose in the dialog, as text.
fn read_backup_at(path: &Path) -> Result<BackupFile, String> {
    check_readable(
        path,
        &BACKUP_EXTENSIONS,
        MAX_BACKUP_BYTES,
        "a CViper backup (.json)",
    )?;

    let text = fs::read_to_string(path).map_err(|error| match error.kind() {
        // The only failure `read_to_string` adds over `read`: the bytes are not
        // UTF-8. That is not a disk problem and deserves its own sentence.
        ErrorKind::InvalidData => {
            "That file is not text, so it cannot be a CViper backup. Pick the .json file you \
             exported."
                .to_string()
        }
        _ => describe_io_error(&error),
    })?;

    Ok(BackupFile {
        name: file_name_of(path),
        path: path.display().to_string(),
        text,
    })
}

/// Write a backup to the path the user chose in the save dialog.
///
/// `contents` comes from `exportBackup`, which is the single source of the file
/// format. Nothing here inspects or reformats it.
fn write_backup_at(path: &Path, contents: &str) -> Result<(), String> {
    let Some(extension) = extension_of(path) else {
        return Err("Give the file a name ending in .json.".to_string());
    };
    if !BACKUP_EXTENSIONS.contains(&extension.as_str()) {
        return Err("A CViper backup must be saved as a .json file.".to_string());
    }
    if contents.len() as u64 > MAX_BACKUP_BYTES {
        return Err("That backup is too large to write.".to_string());
    }

    fs::write(path, contents).map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            "That folder no longer exists. Pick somewhere else to save the file.".to_string()
        }
        ErrorKind::PermissionDenied => {
            "Windows would not let CViper write there. Pick a folder you own, such as Documents."
                .to_string()
        }
        _ => "The backup could not be written. Try saving it somewhere else.".to_string(),
    })
}

// ── The commands ────────────────────────────────────────────────────────────
//
// Three verbs and no nouns. Each opens a dialog, and each touches exactly the
// one file that came back out of it.

/// Ask for a CV and read it. `Ok(None)` means the user cancelled.
#[tauri::command]
pub(crate) async fn pick_and_read_cv(app: AppHandle) -> Result<Option<CvFile>, String> {
    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Choose a CV")
        .add_filter("CV", &CV_EXTENSIONS)
        // `try_send` rather than `send`: the callback may run on the UI thread,
        // where waiting is a deadlock and `blocking_send` is a panic. The
        // channel is empty and holds one message, so this cannot fail.
        .pick_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    read_cv_at(&local_path(chosen)?).map(Some)
}

/// Ask for a backup and read it as text. `Ok(None)` means the user cancelled.
#[tauri::command]
pub(crate) async fn pick_and_read_backup(app: AppHandle) -> Result<Option<BackupFile>, String> {
    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Choose a CViper backup")
        .add_filter("CViper backup", &BACKUP_EXTENSIONS)
        .pick_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    read_backup_at(&local_path(chosen)?).map(Some)
}

/// Ask where to save, then write. `Ok(None)` means the user cancelled; anything
/// else is where the file went, for the message that says so.
#[tauri::command]
pub(crate) async fn pick_and_write_backup(
    app: AppHandle,
    contents: String,
    // ONE WORD on purpose. Tauri converts a command's snake_case parameters to
    // camelCase across the IPC boundary, so `suggested_name` here would have to
    // be `suggestedName` there — a mismatch that has no compile error on either
    // side and shows up only as a failed invoke in a running app. A name with
    // no underscore in it is the same word in both spellings.
    // `the_frontend_calls_these_commands_by_these_names` pins the pairing.
    suggestion: String,
) -> Result<Option<String>, String> {
    // Checked BEFORE the dialog. Asking somebody where to put a file and only
    // then refusing to write it is a worse experience than refusing up front.
    if contents.len() as u64 > MAX_BACKUP_BYTES {
        return Err("That backup is too large to write.".to_string());
    }

    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Save your CViper backup")
        .set_file_name(bare_file_name(&suggestion))
        .add_filter("CViper backup", &BACKUP_EXTENSIONS)
        .save_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    let path = local_path(chosen)?;
    write_backup_at(&path, &contents)?;

    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript side of the CV size limit, embedded at compile time.
    const CV_PARSING_CONSTANTS_TS: &str =
        include_str!("../../../../packages/cv-parsing/src/constants.ts");

    /// The only file in the frontend that calls these commands.
    const PLATFORM_FILES_TS: &str = include_str!("../../src/platform/files.ts");

    // ── base64 ──────────────────────────────────────────────────────────────

    #[test]
    fn base64_matches_the_rfc_vectors() {
        // RFC 4648 section 10, plus the three padding cases.
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_covers_the_whole_byte_range() {
        // Every byte value, so a sign error or a bad mask cannot hide in the
        // half of the alphabet the ASCII vectors never reach.
        let all: Vec<u8> = (0u16..=255).map(|value| value as u8).collect();
        let encoded = base64(&all);

        assert_eq!(encoded.len(), 344);
        assert!(encoded.starts_with("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g"));
        assert!(encoded.ends_with("+/w=="));
        assert!(
            encoded
                .bytes()
                .all(|byte| B64.contains(&byte) || byte == b'='),
            "every character must be in the standard alphabet"
        );
    }

    #[test]
    fn base64_length_is_always_a_multiple_of_four() {
        for length in 0..64usize {
            let bytes = vec![0xABu8; length];
            assert_eq!(base64(&bytes).len() % 4, 0, "length {length}");
        }
    }

    // ── The guard ───────────────────────────────────────────────────────────

    fn temp_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("cviper-files-test-{}-{name}", std::process::id()));
        path
    }

    #[test]
    fn a_cv_extension_is_required() {
        // The whole point of the allow-list: a credential file is refused
        // before its metadata is even read, so a bad path is not even probed.
        for name in ["secrets.txt", "id_rsa", "notes.md", "archive.zip"] {
            let error = check_readable(
                Path::new(name),
                &CV_EXTENSIONS,
                MAX_CV_BYTES,
                "a PDF or a Word (.docx) CV",
            )
            .unwrap_err();
            assert!(
                error.contains("CViper cannot read") || error.contains("no extension"),
                "{name} produced: {error}"
            );
        }
    }

    #[test]
    fn the_extension_check_is_case_insensitive() {
        // A file saved from a scanner as `CV.PDF` is a normal thing and must
        // not be refused.
        let path = temp_path("upper.PDF");
        fs::write(&path, b"%PDF-1.4").unwrap();

        let size = check_readable(
            &path,
            &CV_EXTENSIONS,
            MAX_CV_BYTES,
            "a PDF or a Word (.docx) CV",
        )
        .unwrap();

        assert_eq!(size, 8);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn a_double_extension_is_judged_by_its_last_one() {
        // `cv.pdf.exe` is an executable, not a CV.
        let error = check_readable(
            Path::new("cv.pdf.exe"),
            &CV_EXTENSIONS,
            MAX_CV_BYTES,
            "a PDF or a Word (.docx) CV",
        )
        .unwrap_err();
        assert!(error.contains("CViper cannot read"), "{error}");
    }

    #[test]
    fn a_missing_file_is_reported_as_missing() {
        let error = read_cv_at(&temp_path("absent.pdf"))
            .expect_err("a file that is not there cannot be read");
        assert!(error.contains("no longer there"), "{error}");
    }

    #[test]
    fn a_directory_is_refused() {
        let path = temp_path("a-folder.pdf");
        fs::create_dir_all(&path).unwrap();

        let error = check_readable(
            &path,
            &CV_EXTENSIONS,
            MAX_CV_BYTES,
            "a PDF or a Word (.docx) CV",
        )
        .unwrap_err();

        assert!(error.contains("folder"), "{error}");
        fs::remove_dir_all(&path).ok();
    }

    #[test]
    fn a_file_at_the_limit_is_accepted_and_one_byte_over_is_not() {
        let path = temp_path("boundary.json");
        // A tiny limit, so the boundary is testable without writing 128 MB.
        fs::write(&path, vec![b'x'; 10]).unwrap();
        assert_eq!(
            check_readable(&path, &BACKUP_EXTENSIONS, 10, "a CViper backup (.json)").unwrap(),
            10
        );

        fs::write(&path, vec![b'x'; 11]).unwrap();
        let error =
            check_readable(&path, &BACKUP_EXTENSIONS, 10, "a CViper backup (.json)").unwrap_err();
        assert!(error.contains("larger than"), "{error}");

        fs::remove_file(&path).ok();
    }

    // ── Reading and writing, end to end on a real file ──────────────────────
    //
    // The commands themselves cannot be called without a dialog. What they do
    // once a path has come back out of one is all here.

    #[test]
    fn a_cv_round_trips_off_the_disk() {
        let path = temp_path("round-trip.pdf");
        fs::write(&path, b"%PDF-1.4 hello").unwrap();

        let file = read_cv_at(&path).unwrap();

        assert!(file.name.ends_with("round-trip.pdf"));
        assert!(!file.name.contains(std::path::MAIN_SEPARATOR));
        assert_eq!(file.path, path.display().to_string());
        assert_eq!(file.bytes_base64, base64(b"%PDF-1.4 hello"));

        fs::remove_file(&path).ok();
    }

    #[test]
    fn a_backup_round_trips_off_the_disk() {
        let path = temp_path("round-trip.json");
        let contents = "{\n  \"schemaVersion\": 1\n}\n";

        write_backup_at(&path, contents).unwrap();
        let read = read_backup_at(&path).unwrap();

        assert_eq!(read.text, contents);
        // The name is what the import confirmation puts in front of the user.
        assert!(read.name.ends_with("round-trip.json"));
        assert!(!read.name.contains(std::path::MAIN_SEPARATOR));

        fs::remove_file(&path).ok();
    }

    #[test]
    fn a_backup_must_be_saved_as_json() {
        for name in ["backup.txt", "backup", "backup.json.exe"] {
            let error = write_backup_at(Path::new(name), "{}").expect_err("only .json may be written");
            assert!(error.contains(".json"), "{name} produced: {error}");
        }
    }

    #[test]
    fn a_backup_that_is_not_text_is_reported_as_not_text() {
        let path = temp_path("binary.json");
        // A lone 0xFF is not valid UTF-8 in any position.
        fs::write(&path, [0xFFu8, 0xFE, 0x00]).unwrap();

        let error = read_backup_at(&path).unwrap_err();

        assert!(error.contains("not text"), "{error}");
        fs::remove_file(&path).ok();
    }

    // ── The suggested save name ─────────────────────────────────────────────
    //
    // The only string the frontend still contributes to a file operation, so
    // it gets the full treatment: what a real one looks like, everything that
    // could turn it into a path, and both ends of the length limit.

    #[test]
    fn the_real_suggested_name_survives_untouched() {
        // What `defaultBackupFilename` in backup.ts actually produces. If this
        // ever stopped surviving, every export would be offered as
        // `cviper-backup.json` and nobody would notice from the code.
        assert_eq!(
            bare_file_name("cviper-backup-2026-08-19.json"),
            "cviper-backup-2026-08-19.json"
        );
    }

    #[test]
    fn a_suggested_name_that_is_really_a_path_is_replaced() {
        // None of these is repaired — a repaired value is a value somebody can
        // steer. They are all answered with the same constant.
        for hostile in [
            "../../../../Windows/System32/config/SAM.json",
            "..\\..\\secrets.json",
            "C:\\Windows\\evil.json",
            "/etc/passwd.json",
            "sub/dir/backup.json",
            "\\\\server\\share\\backup.json",
            "back\nup.json",
            "back\0up.json",
            "backup.exe",
            "backup",
            "",
        ] {
            assert_eq!(
                bare_file_name(hostile),
                FALLBACK_BACKUP_NAME,
                "{hostile:?} was not replaced"
            );
        }
    }

    #[test]
    fn a_suggested_name_at_the_length_limit_is_kept_and_one_past_it_is_not() {
        let stem = "a".repeat(MAX_SUGGESTED_NAME_CHARS - ".json".len());
        let at_the_limit = format!("{stem}.json");
        assert_eq!(at_the_limit.chars().count(), MAX_SUGGESTED_NAME_CHARS);
        assert_eq!(bare_file_name(&at_the_limit), at_the_limit);

        let one_over = format!("a{at_the_limit}");
        assert_eq!(one_over.chars().count(), MAX_SUGGESTED_NAME_CHARS + 1);
        assert_eq!(bare_file_name(&one_over), FALLBACK_BACKUP_NAME);
    }

    #[test]
    fn the_fallback_name_is_itself_a_name_the_guard_accepts() {
        // Otherwise the safe answer would be the one thing that could not be
        // saved, and only the person who tried it would ever find out.
        assert_eq!(bare_file_name(FALLBACK_BACKUP_NAME), FALLBACK_BACKUP_NAME);
        // And `write_backup_at` would accept a file of that name, so the
        // suggestion cannot lead the user somewhere the write then refuses.
        assert_eq!(
            extension_of(Path::new(FALLBACK_BACKUP_NAME)).as_deref(),
            Some("json")
        );
    }

    // ── The two rules the module comment states ─────────────────────────────

    #[test]
    fn no_message_leaks_the_path() {
        // Every failure a caller can provoke with a hostile path, checked for
        // the path itself. See the module comment.
        let secret = temp_path("s3cr3t-token-file.txt");
        let messages = [
            check_readable(
                &secret,
                &CV_EXTENSIONS,
                MAX_CV_BYTES,
                "a PDF or a Word (.docx) CV",
            )
            .unwrap_err(),
            read_cv_at(&secret).unwrap_err(),
            read_backup_at(&secret).unwrap_err(),
            write_backup_at(&secret, "{}").unwrap_err(),
            describe_io_error(&std::io::Error::new(ErrorKind::Other, secret.display().to_string())),
        ];

        for message in messages {
            assert!(
                !message.contains("s3cr3t"),
                "a message rendered the path: {message}"
            );
        }
    }

    #[test]
    fn cv_limit_matches_the_typescript_constant() {
        // A CV the frontend would accept and Rust refuses is a file that fails
        // with the wrong message; the reverse wastes memory on a file that is
        // about to be rejected anyway.
        assert!(
            CV_PARSING_CONSTANTS_TS.contains("export const MAX_FILE_BYTES = 10 * 1024 * 1024;"),
            "packages/cv-parsing/src/constants.ts must declare a 10 MiB limit — \
             MAX_CV_BYTES here is {MAX_CV_BYTES} and the two must agree"
        );
        assert_eq!(MAX_CV_BYTES, 10 * 1024 * 1024);
    }

    // ── No command takes a path ─────────────────────────────────────────────
    //
    // The same technique as `there_is_no_generic_url_taking_command` in
    // providers.rs. The two helpers are copied rather than shared: a test-only
    // module reachable from both files would be a third place to keep in step,
    // and they are fifteen lines each.

    /// Drop `//` comments so a rule about code cannot be tripped by prose that
    /// merely mentions the thing it forbids.
    fn without_comments(source: &str) -> String {
        source
            .lines()
            .map(|line| match line.find("//") {
                Some(index) => &line[..index],
                None => line,
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Everything before the test module — i.e. the code that actually ships.
    fn production_slice(source: &str) -> &str {
        match source.find("#[cfg(test)]") {
            Some(index) => &source[..index],
            None => source,
        }
    }

    /// Every Rust file this crate compiles, by module name.
    ///
    /// A command can live in any of them, so the guard reads all of them.
    /// `the_scanned_sources_are_every_module_in_the_crate` stops this list
    /// going stale the moment somebody adds a module.
    const CRATE_SOURCES: [(&str, &str); 6] = [
        ("db", include_str!("db.rs")),
        ("files", include_str!("files.rs")),
        ("jobs", include_str!("jobs.rs")),
        ("providers", include_str!("providers.rs")),
        ("secrets", include_str!("secrets.rs")),
        ("lib", include_str!("lib.rs")),
    ];

    /// The name and the parameter list of every `#[tauri::command]` in `source`.
    ///
    /// Only the parameters are returned, never the return type: what a command
    /// hands BACK is not an attack surface, and a command that reports which
    /// file the user picked would otherwise look identical to one that accepts
    /// a file to open.
    fn command_signatures(source: &str) -> Vec<(String, String)> {
        let mut found = Vec::new();

        for chunk in source.split("#[tauri::command]").skip(1) {
            let Some(fn_at) = chunk.find("fn ") else {
                continue;
            };
            let after_fn = &chunk[fn_at + "fn ".len()..];
            let Some(open) = after_fn.find('(') else {
                continue;
            };

            // Walk to the matching bracket, so a parameter typed with a
            // function or a tuple cannot end the list early.
            let mut depth = 0usize;
            let mut close = None;
            for (index, character) in after_fn[open..].char_indices() {
                match character {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            close = Some(open + index);
                            break;
                        }
                    }
                    _ => {}
                }
            }
            let Some(close) = close else { continue };

            found.push((
                after_fn[..open].trim().to_string(),
                after_fn[open + 1..close].to_string(),
            ));
        }

        found
    }

    #[test]
    fn the_scanned_sources_are_every_module_in_the_crate() {
        // A module that is compiled but not scanned is a hole the guard below
        // cannot see. `lib.rs` is where modules are declared, so it is also the
        // complete list of places a command can hide.
        let lib = without_comments(include_str!("lib.rs"));
        let declared: Vec<String> = lib
            .lines()
            .map(str::trim)
            .filter_map(|line| line.strip_prefix("pub ").unwrap_or(line).strip_prefix("mod "))
            .map(|rest| rest.trim().trim_end_matches(';').trim().to_string())
            .collect();

        assert!(
            !declared.is_empty(),
            "lib.rs declares no modules — this parse has stopped working"
        );
        for module in declared {
            assert!(
                CRATE_SOURCES.iter().any(|(name, _)| *name == module),
                "module `{module}` is compiled but not scanned by \
                 no_command_accepts_a_filesystem_path"
            );
        }
    }

    #[test]
    fn every_scanned_slice_holds_real_code() {
        // Without this, the guard below could quietly become a scan of five
        // empty strings and pass for ever after.
        for (module, source) in CRATE_SOURCES {
            let whole = without_comments(source);
            let production = production_slice(&whole);

            assert!(
                production.len() > 200,
                "{module}: the production slice is suspiciously small ({} bytes)",
                production.len()
            );
            assert!(
                !production.contains("mod tests"),
                "{module}: the cut landed after the test module"
            );
        }

        // And this file in particular must still contain the thing being
        // guarded, so the scan cannot pass by looking at the wrong half.
        let files = without_comments(include_str!("files.rs"));
        assert!(
            production_slice(&files).contains("async fn pick_and_read_cv"),
            "the production slice of files.rs no longer holds the file commands"
        );
    }

    #[test]
    fn every_file_command_is_registered_for_javascript() {
        // A `#[tauri::command]` that is not in `generate_handler!` is invisible
        // to the frontend and fails at runtime with "command not found" — there
        // is no compile error for it. Comments are stripped first, because
        // lib.rs explains what these commands are and the guard must fail on a
        // missing registration, not on the explanation.
        //
        // Matched WITH the module path and the trailing comma, not as a bare
        // substring: `files::pick_and_read_backups,` contains
        // `pick_and_read_backup`, so a loose match would accept a renamed
        // command as proof that the original was still registered.
        let handler = without_comments(include_str!("lib.rs"));
        for command in [
            "pick_and_read_cv",
            "pick_and_read_backup",
            "pick_and_write_backup",
        ] {
            assert!(
                handler.contains(&format!("files::{command},")),
                "{command} is not registered in generate_handler!"
            );
        }

        // And the three it replaced are GONE, not merely unregistered. A
        // registered-but-unused path-taking command is the whole hole.
        for removed in ["read_cv_file", "read_backup_file", "write_backup_file"] {
            assert!(
                !handler.contains(removed),
                "{removed} is still registered for JavaScript"
            );
        }
    }

    #[test]
    fn the_frontend_calls_these_commands_by_these_names() {
        // Nothing on either side of the boundary fails to compile when a
        // command name or an argument key drifts: the call simply rejects at
        // runtime, in a click handler, in a built app. So the pairing is
        // asserted here, where both halves are readable at once.
        //
        // Each name is matched as a COMPLETE call, quotes and all. A bare
        // substring would let `invoke('pick_and_read_backups')` satisfy a check
        // for `pick_and_read_backup` — which is exactly what this assertion did
        // when it was first written, and it passed.
        for call in [
            "invoke('pick_and_read_cv')",
            "invoke('pick_and_read_backup')",
            "invoke('pick_and_write_backup', ",
        ] {
            assert!(
                PLATFORM_FILES_TS.contains(call),
                "src/platform/files.ts does not contain `{call}`"
            );
        }

        // `pick_and_write_backup` is the only one with arguments, and their
        // keys must be the Rust parameter names exactly. Both are one word, so
        // Tauri's snake_case-to-camelCase conversion cannot change them.
        assert!(
            PLATFORM_FILES_TS.contains("{ contents, suggestion: suggestedName }"),
            "src/platform/files.ts no longer passes `contents` and `suggestion`, \
             which are the parameter names pick_and_write_backup declares"
        );

        // Nothing may still be reaching for the path-taking commands.
        for removed in ["read_cv_file", "read_backup_file", "write_backup_file"] {
            assert!(
                !PLATFORM_FILES_TS.contains(removed),
                "src/platform/files.ts still calls {removed}"
            );
        }
    }

    #[test]
    fn no_command_accepts_a_filesystem_path() {
        // ====================================================================
        // THE GUARD. See the module comment.
        // ====================================================================
        // JavaScript may ask CViper to open a dialog. It may not say which file
        // to open. A parameter that names a path — under any of the spellings
        // below — puts the whole disk back within reach of anything that gets
        // into the WebView, which is the exact hole moving the dialog into Rust
        // was meant to close.
        let mut seen: Vec<String> = Vec::new();

        for (module, source) in CRATE_SOURCES {
            let whole = without_comments(source);
            for (name, parameters) in command_signatures(production_slice(&whole)) {
                let lowered = parameters.to_ascii_lowercase();
                for forbidden in ["path", "dir", "filename", "file_name", "os_str"] {
                    assert!(
                        !lowered.contains(forbidden),
                        "{module}::{name} takes a filesystem path from JavaScript \
                         (`{forbidden}` in `{parameters}`)"
                    );
                }
                seen.push(name);
            }
        }

        // Non-vacuity, twice over: the scan must have found the file commands
        // by name, and it must have found roughly the number of commands this
        // crate actually has. A parser that silently stops matching would
        // otherwise report "no command takes a path" about nothing at all.
        assert!(
            seen.iter().any(|name| name == "pick_and_read_cv"),
            "the scan did not find the file commands: {seen:?}"
        );
        assert!(
            seen.len() >= 10,
            "the scan found only {} commands, which cannot be right: {seen:?}",
            seen.len()
        );
    }
}
