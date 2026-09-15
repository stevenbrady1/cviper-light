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
///
/// `json` is a JSON Resume file — the interchange format CVAurum, Reactive
/// Resume and the jsonresume.org tools export. Whether a given `.json` really
/// is one is `@cviper/resume-schema`'s decision, made on the bytes.
const CV_EXTENSIONS: [&str; 4] = ["pdf", "docx", "doc", "json"];

/// How the CV picker describes what it accepts, in every refusal.
const CV_WHAT: &str = "a PDF, a Word (.docx) or a JSON Resume (.json) CV";

/// Extensions the backup commands will touch. Lower-case, no dot.
const BACKUP_EXTENSIONS: [&str; 1] = ["json"];

/// What the save dialog is pre-filled with when the frontend's suggestion is
/// not a plain file name. See `bare_file_name`.
const FALLBACK_BACKUP_NAME: &str = "cviper-backup.json";

/// The save dialog's pre-fill for a CV export whose suggested name is not a
/// plain file name (L-20b). See `bare_json_name`.
const FALLBACK_CV_JSON_NAME: &str = "cv.json";

/// Extensions a plain-text export — a tailored CV, a cover letter (L-160) —
/// may be saved under. Lower-case, no dot. Exactly these two: the frontend
/// asks for one BY NAME and anything else is refused before a dialog opens,
/// so this command cannot be talked into writing `.html`, `.bat` or `.json`.
const TEXT_EXTENSIONS: [&str; 2] = ["txt", "md"];

/// The largest text export we will write, in bytes.
///
/// A tailored CV or a cover letter is a few kilobytes. 4 MB is a thousand of
/// them, and small enough that the string a compromised frontend could ask us
/// to write is not a disk-filling one.
const MAX_TEXT_BYTES: u64 = 4 * 1024 * 1024;

/// The stem of the save dialog's pre-fill for a text export whose suggested
/// name is not a plain file name. The extension is the one the caller asked
/// for, so `cviper-export.txt` or `cviper-export.md`. See `bare_text_name`.
const FALLBACK_TEXT_STEM: &str = "cviper-export";

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
#[derive(Clone, Serialize)]
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
    bare_json_name(suggested, FALLBACK_BACKUP_NAME)
}

/// The same rule with the caller's fallback: a backup falls back to
/// `cviper-backup.json`, a CV export to `cv.json`. A CV's name is the user's
/// own file name, so `Steve Brady CV.json` is welcome and `..\CV.json` is not.
fn bare_json_name(suggested: &str, fallback: &str) -> String {
    bare_name(suggested, "json", fallback)
}

/// The same rule again for a plain-text export (L-160), where the extension
/// is whichever of `TEXT_EXTENSIONS` the caller asked for: `Tailored CV.md` is
/// welcome under `md`, and the same name under `txt` is not a plain name for
/// THIS save and falls back to `cviper-export.txt`.
fn bare_text_name(suggested: &str, extension: &str) -> String {
    bare_name(
        suggested,
        extension,
        &format!("{FALLBACK_TEXT_STEM}.{extension}"),
    )
}

/// The guard behind all three: a plain name is non-empty, short enough, has
/// no separator, drive letter, `..` or control character, and ends in exactly
/// the extension this save is for. Anything else is REPLACED with the
/// fallback, never repaired.
fn bare_name(suggested: &str, extension: &str, fallback: &str) -> String {
    let is_a_plain_name = !suggested.is_empty()
        && suggested.chars().count() <= MAX_SUGGESTED_NAME_CHARS
        && !suggested.contains(['/', '\\', ':'])
        && !suggested.contains("..")
        && !suggested.chars().any(char::is_control)
        && extension_of(Path::new(suggested)).as_deref() == Some(extension);

    if is_a_plain_name {
        suggested.to_string()
    } else {
        fallback.to_string()
    }
}

/// The one extension a text export may use, or a refusal.
///
/// Lower-cased so `TXT` is `txt`; anything outside `TEXT_EXTENSIONS` is an
/// error BEFORE a dialog opens — the frontend names the format, and the only
/// formats it can name are the two plain-text ones.
fn text_extension(requested: &str) -> Result<&'static str, String> {
    let lowered = requested.trim().to_ascii_lowercase();
    TEXT_EXTENSIONS
        .iter()
        .find(|allowed| **allowed == lowered)
        .copied()
        .ok_or_else(|| "A text export can only be saved as .txt or .md.".to_string())
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
    check_readable(path, &CV_EXTENSIONS, MAX_CV_BYTES, CV_WHAT)?;

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

    write_text_at(
        path,
        contents,
        "The backup could not be written. Try saving it somewhere else.",
    )
}

/// Write a CV back out as the JSON Resume file it arrived as (L-20b).
///
/// `contents` comes from `exportJsonResume` in `features/analysis/model.ts`,
/// which parsed, stamped and serialised it. Nothing here inspects it. The
/// guards are the backup writer's: `.json` only, the same size ceiling.
fn write_cv_json_at(path: &Path, contents: &str) -> Result<(), String> {
    let Some(extension) = extension_of(path) else {
        return Err("Give the file a name ending in .json.".to_string());
    };
    if !BACKUP_EXTENSIONS.contains(&extension.as_str()) {
        return Err("A JSON Resume must be saved as a .json file.".to_string());
    }
    if contents.len() as u64 > MAX_BACKUP_BYTES {
        return Err("That CV is too large to write.".to_string());
    }

    write_text_at(
        path,
        contents,
        "The CV could not be written. Try saving it somewhere else.",
    )
}

/// Write a plain-text export — a tailored CV or a cover letter (L-160) — to
/// the path the user chose. `extension` has already passed `text_extension`;
/// the path the dialog answered with must carry that same extension, so a
/// user who types `letter.exe` into the save box gets a refusal, not a file.
fn write_text_export_at(path: &Path, contents: &str, extension: &str) -> Result<(), String> {
    let Some(actual) = extension_of(path) else {
        return Err(format!("Give the file a name ending in .{extension}."));
    };
    if actual != extension {
        return Err(format!("This export must be saved as a .{extension} file."));
    }
    if contents.len() as u64 > MAX_TEXT_BYTES {
        return Err("That text is too large to write.".to_string());
    }

    write_text_at(
        path,
        contents,
        "The text could not be written. Try saving it somewhere else.",
    )
}

/// The one `fs::write`, with the three messages a save can end in. `otherwise`
/// names what was being written, because "the file" is what the user already
/// knows and "the backup" or "the CV" is what they clicked.
fn write_text_at(path: &Path, contents: &str, otherwise: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            "That folder no longer exists. Pick somewhere else to save the file.".to_string()
        }
        ErrorKind::PermissionDenied => {
            "Windows would not let CViper write there. Pick a folder you own, such as Documents."
                .to_string()
        }
        _ => otherwise.to_string(),
    })
}

// ── The commands ────────────────────────────────────────────────────────────
//
// Three verbs and no nouns. Each opens a dialog, and each touches exactly the
// one file that came back out of it.

/// Ask for a CV and read it. `Ok(None)` means the user cancelled.
// ── A file the operating system asked us to open ────────────────────────────
//
// On an iPhone, "Open in CViper Light" from Files, Mail or Safari copies the
// file into this app's Documents/Inbox and hands the copy's URL to the app
// (`Info.ios.plist` declares the document types). Tauri delivers that as
// `RunEvent::Opened { urls }` — the same event a URL scheme would use — and
// `lib.rs` routes it here.
//
// This is the ONE way a path reaches this module without a dialog, and it is
// still not JavaScript naming it: the URL comes from the OS, on the Rust side,
// and is read with exactly the guards the picker uses (`read_cv_at`:
// extension, size, is-a-file). What the frontend receives is the same `CvFile`
// the picker returns, as an event. Nothing is exposed as a command, so
// `no_command_accepts_a_filesystem_path` still holds.

/// Emitted with a `CvFile` when a file the OS opened has been read.
///
/// (The `dead_code` allowances: the only caller is the `RunEvent::Opened` arm
/// in `lib.rs`, which exists on macOS, iOS and Android. On Windows and Linux
/// these are compiled, tested, and never called — which is what we want, not
/// a warning.)
#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub(crate) const CV_OPENED_EVENT: &str = "cv-opened";
/// Emitted with a sentence when a file the OS opened could not be read.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub(crate) const CV_OPEN_FAILED_EVENT: &str = "cv-open-failed";

/// Route every URL the OS asked us to open. Non-file URLs are not ours and
/// are ignored; a file is read and reported, one event per file.
#[cfg_attr(
    not(any(target_os = "macos", target_os = "ios", target_os = "android")),
    allow(dead_code)
)]
pub(crate) fn on_opened<R: tauri::Runtime>(app: &tauri::AppHandle<R>, urls: &[tauri::Url]) {
    use tauri::Emitter;

    for url in urls {
        let Some(outcome) = opened_cv(url) else {
            continue;
        };
        match outcome {
            Ok(file) => {
                let _ = app.emit(CV_OPENED_EVENT, file);
            }
            Err(message) => {
                let _ = app.emit(CV_OPEN_FAILED_EVENT, message);
            }
        }
    }
}

/// `None` for a URL that is not a file at all. Otherwise the file, read under
/// the picker's guards — and the iOS Inbox copy deleted either way, so a
/// refused file is not left behind any more than an accepted one.
fn opened_cv(url: &tauri::Url) -> Option<Result<CvFile, String>> {
    if url.scheme() != "file" {
        return None;
    }
    let Ok(path) = url.to_file_path() else {
        return Some(Err(
            "That file could not be opened: its location could not be understood.".to_string(),
        ));
    };

    let outcome = read_cv_at(&path);
    discard_inbox_copy(&path);
    Some(outcome)
}

/// Is this the copy iOS made for us? Only such a copy is ever deleted: it is
/// ours, it is a duplicate, and leaving it would fill the app's sandbox with
/// every CV ever opened. A file anywhere else is the user's and is not touched.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
fn is_inbox_copy(path: &Path) -> bool {
    path.components().any(|part| part.as_os_str() == "Inbox")
}

fn discard_inbox_copy(path: &Path) {
    // iOS only. On a desktop a folder called "Inbox" is somebody's mail.
    #[cfg(target_os = "ios")]
    if is_inbox_copy(path) {
        let _ = fs::remove_file(path);
    }
    #[cfg(not(target_os = "ios"))]
    let _ = path;
}

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

/// Ask where to save a CV as a JSON Resume, then write it (L-20b). Same shape
/// as `pick_and_write_backup`: `Ok(None)` is a cancel, `Ok(Some(path))` is
/// where it went, and the path never passes through JavaScript on the way in.
#[tauri::command]
pub(crate) async fn pick_and_write_cv_json(
    app: AppHandle,
    contents: String,
    // One word, for the reason given on `pick_and_write_backup`.
    suggestion: String,
) -> Result<Option<String>, String> {
    if contents.len() as u64 > MAX_BACKUP_BYTES {
        return Err("That CV is too large to write.".to_string());
    }

    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Save your CV as a JSON Resume")
        .set_file_name(bare_json_name(&suggestion, FALLBACK_CV_JSON_NAME))
        .add_filter("JSON Resume", &BACKUP_EXTENSIONS)
        .save_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    let path = local_path(chosen)?;
    write_cv_json_at(&path, &contents)?;

    Ok(Some(path.display().to_string()))
}

/// Ask where to save a plain-text export — a tailored CV or a cover letter
/// (L-160) — then write it. Same shape as `pick_and_write_cv_json`:
/// `Ok(None)` is a cancel, `Ok(Some(path))` is where it went, and the path
/// never passes through JavaScript on the way in.
///
/// `extension` is the ONLY new thing the frontend contributes, and it is a
/// choice between two words: `txt` or `md`. Anything else is refused before
/// the dialog opens (`text_extension`), the dialog's filter is that one
/// extension, and the chosen path is checked against it again before a byte
/// is written (`write_text_export_at`).
#[tauri::command]
pub(crate) async fn pick_and_write_text(
    app: AppHandle,
    contents: String,
    // One word, for the reason given on `pick_and_write_backup`.
    suggestion: String,
    extension: String,
) -> Result<Option<String>, String> {
    let extension = text_extension(&extension)?;

    if contents.len() as u64 > MAX_TEXT_BYTES {
        return Err("That text is too large to write.".to_string());
    }

    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Save as text")
        .set_file_name(bare_text_name(&suggestion, extension))
        .add_filter(extension, &[extension])
        .save_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    let path = local_path(chosen)?;
    write_text_export_at(&path, &contents, extension)?;

    Ok(Some(path.display().to_string()))
}

// ── A candidate profile kept in an ai-job-search workspace (L-167) ──────────
//
// ai-job-search is a job-hunt framework whose candidate profile lives in
// Markdown files inside a folder on the user's machine. The user picks that
// FOLDER in a dialog; this command reads exactly four files in it by fixed
// relative name and hands their text to the frontend, where
// `features/profile/importAiJobSearch.ts` turns them into profile fields.
//
// Everything the module comment says still holds — no path crosses from
// JavaScript, and only what came back out of the dialog is touched. But a
// folder is a wider grant than a file, so the reading is narrower than the
// grant:
//
//   * the four names are constants. The directory is never listed and no
//     other file in it is opened, whatever else the user keeps there.
//   * each file is canonicalised and must still lie INSIDE the canonicalised
//     folder. A link that leads out — `CLAUDE.md -> ~/.ssh/id_rsa` — is
//     refused, and the refusal is the whole read, not a skipped file.
//   * each file is capped at `MAX_WORKSPACE_FILE_BYTES`, checked from the
//     directory entry before it is opened, and must be UTF-8 text.
//   * a folder holding none of the four is refused with one fixed sentence,
//     so a mis-click on the home directory reads nothing and says why.

/// The largest of the four profile files we will read, in bytes.
///
/// A filled-in `CLAUDE.md` is a few kilobytes of Markdown; the framework's
/// own longest file is under 20 KB. 512 KB is far past any real one and small
/// enough that four of them cannot matter to a desktop machine.
#[cfg_attr(any(target_os = "ios", target_os = "android"), allow(dead_code))]
const MAX_WORKSPACE_FILE_BYTES: u64 = 512 * 1024;

/// Where the framework keeps the three skill files, relative to the folder.
/// Forward slashes: `Path::join` accepts them on Windows too.
#[cfg_attr(any(target_os = "ios", target_os = "android"), allow(dead_code))]
const WORKSPACE_SKILL_FOLDER: &str = ".claude/skills/job-application-assistant";

/// The four files, and nothing else. Read with fixed names, never listed.
#[derive(Debug, Serialize)]
pub struct WorkspaceFiles {
    /// `CLAUDE.md` at the top of the folder: identity, languages, target
    /// sectors, deal-breakers.
    claude_md: Option<String>,
    /// `01-candidate-profile.md`: identity, languages, constraints.
    candidate_profile: Option<String>,
    /// `04-job-evaluation.md`: career goals, what energises and drains.
    job_evaluation: Option<String>,
    /// `07-interview-prep.md`: the ready-made STAR examples.
    interview_prep: Option<String>,
}

/// Said when none of the four files is there. One fixed sentence: the folder
/// the user picked is on their screen, and nothing here names it.
#[cfg_attr(any(target_os = "ios", target_os = "android"), allow(dead_code))]
const NOT_A_WORKSPACE: &str = "That folder does not look like an ai-job-search workspace.";

/// Read one of the four by its relative name. `Ok(None)` is "not there",
/// which is normal — a workspace where `/setup` was never run has only
/// `CLAUDE.md` filled in. Every other outcome is decided BEFORE a byte is
/// read: the resolved location, the kind of entry, the size.
#[cfg_attr(any(target_os = "ios", target_os = "android"), allow(dead_code))]
fn read_workspace_file(root: &Path, relative: &str) -> Result<Option<String>, String> {
    let candidate = root.join(relative);

    // `symlink_metadata` so a dangling link is "there but unreadable" below
    // rather than silently "not there": a link is a decision somebody made.
    if fs::symlink_metadata(&candidate).is_err() {
        return Ok(None);
    }

    let resolved = candidate.canonicalize().map_err(|_| {
        "One of the profile files in that folder could not be opened.".to_string()
    })?;
    if !resolved.starts_with(root) {
        return Err(
            "One of the profile files in that folder points somewhere outside it, so nothing was \
             read."
                .to_string(),
        );
    }

    let metadata = fs::metadata(&resolved).map_err(|error| describe_io_error(&error))?;
    if !metadata.is_file() {
        // A folder wearing one of the four names is not a profile file.
        return Ok(None);
    }
    // From the directory entry, BEFORE opening — the same order as
    // `check_readable`.
    if metadata.len() > MAX_WORKSPACE_FILE_BYTES {
        return Err(format!(
            "One of the profile files in that folder is larger than the {} KB CViper will read.",
            MAX_WORKSPACE_FILE_BYTES / 1024
        ));
    }

    fs::read_to_string(&resolved)
        .map(Some)
        .map_err(|error| match error.kind() {
            ErrorKind::InvalidData => {
                "One of the profile files in that folder is not text, so it cannot be read."
                    .to_string()
            }
            _ => describe_io_error(&error),
        })
}

/// Read the four files from the folder the user chose in the dialog.
///
/// Not a `#[tauri::command]`, and must not become one: it takes a path. It is
/// a separate function so every guard above can be tested on a real folder
/// without a dialog.
#[cfg_attr(any(target_os = "ios", target_os = "android"), allow(dead_code))]
fn read_workspace_at(folder: &Path) -> Result<WorkspaceFiles, String> {
    // Canonicalised FIRST, so the prefix every file is checked against is the
    // real location, not a path that itself goes through a link.
    let root = folder.canonicalize().map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            "That folder is no longer there. It may have been moved or renamed since you picked \
             it."
                .to_string()
        }
        _ => "That folder could not be opened.".to_string(),
    })?;
    if !root.is_dir() {
        return Err("That is a file, not a folder. Pick the ai-job-search folder itself.".to_string());
    }

    let skill = |name: &str| format!("{WORKSPACE_SKILL_FOLDER}/{name}");
    let files = WorkspaceFiles {
        claude_md: read_workspace_file(&root, "CLAUDE.md")?,
        candidate_profile: read_workspace_file(&root, &skill("01-candidate-profile.md"))?,
        job_evaluation: read_workspace_file(&root, &skill("04-job-evaluation.md"))?,
        interview_prep: read_workspace_file(&root, &skill("07-interview-prep.md"))?,
    };

    if files.claude_md.is_none()
        && files.candidate_profile.is_none()
        && files.job_evaluation.is_none()
        && files.interview_prep.is_none()
    {
        return Err(NOT_A_WORKSPACE.to_string());
    }

    Ok(files)
}

/// Ask for an ai-job-search folder and read the four profile files in it
/// (L-167). `Ok(None)` means the user cancelled; inside the answer, a file
/// that is not there is `null`.
///
/// A FOLDER dialog, the first in this module. It is still the plugin's own
/// dialog run from Rust, so the same rule holds as for the three file
/// pickers: the frontend asks for a dialog and gets back what was read, and
/// there is no parameter through which it could name a folder itself.
/// Said on a phone, where there is no folder dialog to open.
#[cfg_attr(not(any(target_os = "ios", target_os = "android")), allow(dead_code))]
const NO_FOLDER_DIALOG_HERE: &str =
    "Importing from a folder is not available on this device. Use the desktop app.";

#[tauri::command]
pub(crate) async fn pick_and_read_profile_workspace(
    app: AppHandle,
) -> Result<Option<WorkspaceFiles>, String> {
    // A folder dialog does not exist on a phone: `tauri-plugin-dialog` has no
    // `pick_folder` for iOS or Android, and iOS gives an app no way to be
    // handed a directory in the first place. The command still exists on
    // those targets — so the registration and the frontend pairing hold
    // everywhere — and it answers with a sentence instead of failing to
    // compile. The Profile view does not offer the button on a phone; this
    // is the floor under that, not the message anyone should normally see.
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        let _ = app;
        Err(NO_FOLDER_DIALOG_HERE.to_string())
    }

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

        app.dialog()
            .file()
            .set_title("Choose your ai-job-search folder")
            .pick_folder(move |chosen| {
                let _ = answer.try_send(chosen);
            });

        let Some(chosen) = wait_for_choice(answers).await? else {
            return Ok(None);
        };

        read_workspace_at(&local_path(chosen)?).map(Some)
    }
}

// ── A binary export: the Word document (L-165) ──────────────────────────────
//
// The same shape as the text export with one difference: the bytes cross the
// IPC boundary as base64, because a `.docx` is a zip and a zip is not a
// string. They are decoded HERE, in Rust, and the decoder is as strict as
// the encoder above is exact — anything that is not padded standard base64
// is a refusal, never a best-effort byte string that is silently wrong.

/// Extensions a binary export may be saved under. Lower-case, no dot.
/// Exactly one: the frontend asks for it BY NAME and anything else is refused
/// before a dialog opens, so this command cannot be talked into writing an
/// `.exe`, a `.docm` (a Word file that carries macros) or a `.zip`.
const BYTES_EXTENSIONS: [&str; 1] = ["docx"];

/// The largest binary export we will write, in bytes — measured on the
/// DECODED size, and checked on the base64's length before a byte of it is
/// decoded, so a payload that is about to be refused is never allocated.
///
/// A tailored CV as a Word document is a few tens of kilobytes. 8 MB is a
/// few hundred of them, and small enough that the string a compromised
/// frontend could ask us to write is not a disk-filling one.
const MAX_BYTES_EXPORT: u64 = 8 * 1024 * 1024;

/// The refusal for a payload that is not base64. The only way to reach it is
/// a bug in our own frontend, so it says what the user would see rather than
/// what went wrong on the wire.
const NOT_BASE64: &str = "That document could not be built. Try running the tailoring again.";

/// Decode padded standard base64 (RFC 4648), or `None` when the input is not
/// exactly that. The inverse of `base64` above, and tested against it.
///
/// Strict on purpose: the length must be a multiple of four, every character
/// must be in the alphabet, and `=` may appear only as the last one or two
/// characters. Whitespace, the URL-safe alphabet and missing padding are all
/// refused — the one caller is our own `encodeBase64` in `platform/files.ts`,
/// which produces none of them, so anything looser would only ever be
/// accepting a payload that did not come from it.
fn debase64(encoded: &str) -> Option<Vec<u8>> {
    let bytes = encoded.as_bytes();
    if bytes.len() % 4 != 0 {
        return None;
    }

    let padding = bytes.iter().rev().take_while(|byte| **byte == b'=').count();
    if padding > 2 {
        return None;
    }
    let body = &bytes[..bytes.len() - padding];

    let mut out = Vec::with_capacity(body.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut held = 0u32;
    for byte in body {
        let value = B64.iter().position(|letter| letter == byte)? as u32;
        buffer = (buffer << 6) | value;
        held += 6;
        if held >= 8 {
            held -= 8;
            out.push((buffer >> held) as u8);
            buffer &= (1 << held) - 1;
        }
    }

    // Two padding characters leave one byte of the last quartet, one leaves
    // two: anything else means `=` appeared somewhere other than the end, or
    // the padding did not match the length.
    match padding {
        0 => (held == 0).then_some(out),
        1 => (held == 2 && out.len() % 3 == 2).then_some(out),
        _ => (held == 4 && out.len() % 3 == 1).then_some(out),
    }
}

/// The one extension a binary export may use, or a refusal. The same rule as
/// `text_extension`: lower-cased, and anything outside `BYTES_EXTENSIONS` is
/// an error BEFORE a dialog opens.
fn bytes_extension(requested: &str) -> Result<&'static str, String> {
    let lowered = requested.trim().to_ascii_lowercase();
    BYTES_EXTENSIONS
        .iter()
        .find(|allowed| **allowed == lowered)
        .copied()
        .ok_or_else(|| "A Word export can only be saved as .docx.".to_string())
}

/// The same rule as `bare_text_name`, for the binary export's extension.
fn bare_bytes_name(suggested: &str, extension: &str) -> String {
    bare_name(
        suggested,
        extension,
        &format!("{FALLBACK_TEXT_STEM}.{extension}"),
    )
}

/// The bytes behind a binary export's base64, under the size cap.
///
/// The cap is applied to the base64's LENGTH first — four characters carry
/// three bytes, so the decoded size is known without decoding — and then to
/// the decoded bytes, so nothing here trusts the arithmetic alone.
fn decode_bytes_export(encoded: &str) -> Result<Vec<u8>, String> {
    if (encoded.len() as u64 / 4) * 3 > MAX_BYTES_EXPORT + 2 {
        return Err("That document is too large to write.".to_string());
    }
    let bytes = debase64(encoded).ok_or_else(|| NOT_BASE64.to_string())?;
    if bytes.len() as u64 > MAX_BYTES_EXPORT {
        return Err("That document is too large to write.".to_string());
    }
    Ok(bytes)
}

/// Write a binary export — a Word document (L-165) — to the path the user
/// chose. `extension` has already passed `bytes_extension`; the path the
/// dialog answered with must carry that same extension, so a user who types
/// `cv.exe` into the save box gets a refusal, not a file.
fn write_bytes_export_at(path: &Path, bytes: &[u8], extension: &str) -> Result<(), String> {
    let Some(actual) = extension_of(path) else {
        return Err(format!("Give the file a name ending in .{extension}."));
    };
    if actual != extension {
        return Err(format!("This export must be saved as a .{extension} file."));
    }
    if bytes.len() as u64 > MAX_BYTES_EXPORT {
        return Err("That document is too large to write.".to_string());
    }

    fs::write(path, bytes).map_err(|error| match error.kind() {
        ErrorKind::NotFound => {
            "That folder no longer exists. Pick somewhere else to save the file.".to_string()
        }
        ErrorKind::PermissionDenied => {
            "Windows would not let CViper write there. Pick a folder you own, such as Documents."
                .to_string()
        }
        _ => "The document could not be written. Try saving it somewhere else.".to_string(),
    })
}

/// Ask where to save a binary export — a tailored CV or a cover letter as a
/// Word document (L-165) — then write it. Same shape as `pick_and_write_text`:
/// `Ok(None)` is a cancel, `Ok(Some(path))` is where it went, and the path
/// never passes through JavaScript on the way in.
///
/// `encoded` is the file's bytes as base64, decoded here under the size cap
/// BEFORE the dialog opens (`decode_bytes_export`). `extension` can only be
/// `docx`: anything else is refused before the dialog too
/// (`bytes_extension`), the dialog's filter is that one extension, and the
/// chosen path is checked against it again before a byte is written
/// (`write_bytes_export_at`).
#[tauri::command]
pub(crate) async fn pick_and_write_bytes(
    app: AppHandle,
    // One word, for the reason given on `pick_and_write_backup`: a
    // `contents_base64` here would have to be `contentsBase64` in JavaScript.
    encoded: String,
    suggestion: String,
    extension: String,
) -> Result<Option<String>, String> {
    let extension = bytes_extension(&extension)?;
    let bytes = decode_bytes_export(&encoded)?;

    let (answer, answers) = tauri::async_runtime::channel(ONE_ANSWER);

    app.dialog()
        .file()
        .set_title("Save as a Word document")
        .set_file_name(bare_bytes_name(&suggestion, extension))
        .add_filter("Word document", &[extension])
        .save_file(move |chosen| {
            let _ = answer.try_send(chosen);
        });

    let Some(chosen) = wait_for_choice(answers).await? else {
        return Ok(None);
    };

    let path = local_path(chosen)?;
    write_bytes_export_at(&path, &bytes, extension)?;

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

    /// A temp path that belongs to THIS call and no other.
    ///
    /// L-94: `process::id()` is not a discriminator inside a test binary. Every
    /// test here shares one process, so two tests that pick the same file name
    /// were handed one path and raced on it — `a_cv_export_writes_the_text_verbatim`
    /// and `a_json_resume_is_a_cv` both ask for "resume.json". The per-CALL
    /// counter is what makes the answer unique; the pid still separates two
    /// `cargo test` runs going at once, and gives the leftovers one name to sweep.
    ///
    /// The unique part is the PARENT DIRECTORY, deliberately never the file
    /// name: `an_opened_cv_is_read_under_the_picker_guards` asserts the exact
    /// name a CV arrives under, and `no_message_leaks_the_path` needs the
    /// caller's own name to reach the code being tested.
    fn temp_path(name: &str) -> std::path::PathBuf {
        static NEXT_CALL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let nth = NEXT_CALL.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        let mut path = std::env::temp_dir();
        path.push(format!("cviper-files-test-{}", std::process::id()));
        path.push(nth.to_string());
        fs::create_dir_all(&path).expect("a temp folder of this call's own");

        path.push(format!("cviper-files-test-{}-{name}", std::process::id()));
        path
    }

    #[test]
    fn two_callers_asking_for_the_same_name_never_get_the_same_path() {
        // L-94. Every test in this binary shares one process, so a discriminator
        // built only from `process::id()` is the SAME for all of them: two tests
        // that happen to pick the same file name get one file and race on it.
        // `a_cv_export_writes_the_text_verbatim` and `a_json_resume_is_a_cv` both
        // ask for "resume.json", which is exactly that collision.
        const CALLERS: usize = 16;

        let handles: Vec<_> = (0..CALLERS)
            .map(|_| std::thread::spawn(|| temp_path("race.json")))
            .collect();
        let paths: std::collections::HashSet<std::path::PathBuf> =
            handles.into_iter().map(|h| h.join().unwrap()).collect();

        assert_eq!(
            paths.len(),
            CALLERS,
            "{CALLERS} concurrent callers asked for \"race.json\" and got {} distinct \
             path(s): they share a file and will clobber each other",
            paths.len()
        );
    }

    #[test]
    fn two_writers_of_the_same_name_leave_each_other_alone() {
        // The consequence, on a real disk: the first caller's bytes must still be
        // the first caller's bytes after the second has written.
        let first = temp_path("resume.json");
        let second = temp_path("resume.json");

        fs::write(&first, b"from the first caller").unwrap();
        fs::write(&second, b"from the second caller").unwrap();

        assert_eq!(fs::read(&first).unwrap(), b"from the first caller");
        assert_eq!(fs::read(&second).unwrap(), b"from the second caller");

        fs::remove_file(&first).ok();
        fs::remove_file(&second).ok();
    }

    #[test]
    fn the_unique_part_stays_out_of_the_file_name() {
        // The uniqueness belongs in the PARENT DIRECTORY, not the file name:
        // `an_opened_cv_is_read_under_the_picker_guards` asserts the name a CV
        // arrives under is exactly `cviper-files-test-<pid>-opened.pdf`, and
        // `no_message_leaks_the_path` depends on the caller's name surviving.
        // A future refactor that moves the counter into the file name would pass
        // the two tests above and silently break that contract.
        let path = temp_path("opened.pdf");

        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some(format!("cviper-files-test-{}-opened.pdf", std::process::id()).as_str())
        );
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
    fn a_json_resume_is_a_cv() {
        // L-20: a `.json` file passes the picker's guard. Whether it is really
        // a JSON Resume is decided from its bytes on the TypeScript side.
        let path = temp_path("resume.json");
        fs::write(&path, b"{\"basics\":{\"name\":\"Jane\"}}").unwrap();

        let size = check_readable(&path, &CV_EXTENSIONS, MAX_CV_BYTES, CV_WHAT).unwrap();

        assert_eq!(size, 26);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn the_refusal_names_every_format_the_picker_accepts() {
        let error = check_readable(Path::new("notes.md"), &CV_EXTENSIONS, MAX_CV_BYTES, CV_WHAT)
            .unwrap_err();
        for format in ["PDF", ".docx", "JSON Resume"] {
            assert!(error.contains(format), "{format} missing from: {error}");
        }
    }

    // ── Files the OS asked us to open (L-83) ────────────────────────────────

    #[test]
    fn a_url_that_is_not_a_file_is_not_ours() {
        // A custom scheme or a web link is someone else's business; it must
        // not become a read attempt, a refusal, or an event.
        for text in ["https://cviper.ai/light", "cviper://open", "mailto:jane@example.com"] {
            let url = tauri::Url::parse(text).unwrap();
            assert!(opened_cv(&url).is_none(), "{text}");
        }
    }

    #[test]
    fn an_opened_cv_is_read_under_the_picker_guards() {
        let path = temp_path("opened.pdf");
        fs::write(&path, b"%PDF-1.4 opened from the share sheet").unwrap();
        let url = tauri::Url::from_file_path(&path).unwrap();

        let file = opened_cv(&url).expect("a file URL").expect("readable");

        assert_eq!(
            file.name,
            "cviper-files-test-".to_string() + &std::process::id().to_string() + "-opened.pdf"
        );
        assert_eq!(file.path, path.display().to_string());
        assert_eq!(
            file.bytes_base64,
            base64(b"%PDF-1.4 opened from the share sheet")
        );
        fs::remove_file(&path).ok();
    }

    #[test]
    fn an_opened_file_of_the_wrong_kind_is_refused_like_any_other() {
        // The share sheet can only offer the declared types, but the guard does
        // not rely on that: a renamed credential file is refused here exactly as
        // it would be in the dialog.
        let path = temp_path("opened.txt");
        fs::write(&path, b"secret").unwrap();
        let url = tauri::Url::from_file_path(&path).unwrap();

        let error = opened_cv(&url).expect("a file URL").unwrap_err();

        assert!(error.contains("CViper cannot read"), "{error}");
        fs::remove_file(&path).ok();
    }

    #[test]
    fn an_opened_file_that_is_missing_is_reported_as_missing() {
        let url = tauri::Url::from_file_path(temp_path("gone.pdf")).unwrap();
        let error = opened_cv(&url).expect("a file URL").unwrap_err();
        assert!(error.contains("no longer there"), "{error}");
    }

    #[test]
    fn only_the_ios_inbox_copy_counts_as_ours() {
        assert!(is_inbox_copy(Path::new(
            "/var/mobile/Containers/Data/Application/ABC/Documents/Inbox/CV.pdf"
        )));
        assert!(!is_inbox_copy(Path::new("/Users/jane/Documents/CV.pdf")));
        // "Inbox" must be a whole path component: a folder merely containing
        // the word is not the iOS drop box.
        assert!(!is_inbox_copy(Path::new(
            "/Users/jane/Inbox-archive/CV.pdf"
        )));
    }

    #[test]
    fn a_desktop_file_is_never_deleted_after_being_opened() {
        // The deletion is compiled out everywhere but iOS. On the platform this
        // test runs on, a file that passed through `opened_cv` must still exist.
        let path = temp_path("keep.pdf");
        fs::write(&path, b"%PDF-1.4 keep me").unwrap();
        let url = tauri::Url::from_file_path(&path).unwrap();

        opened_cv(&url).expect("a file URL").expect("readable");

        assert!(path.exists());
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

    // ── The CV export (L-20b) ───────────────────────────────────────────────

    #[test]
    fn a_cv_export_is_refused_for_anything_but_json() {
        // Negative: the wrong extension is refused before anything is written,
        // and the message says what to do.
        let wrong = temp_path("resume.txt");
        let refused = write_cv_json_at(&wrong, "{}").unwrap_err();
        assert!(refused.contains(".json"), "{refused}");
        assert!(!wrong.exists());

        let none = temp_path("resume");
        assert!(write_cv_json_at(&none, "{}").unwrap_err().contains(".json"));
    }

    #[test]
    fn a_cv_export_writes_the_text_verbatim() {
        let path = temp_path("resume.json");
        let text = "{\n  \"basics\": { \"name\": \"Steve\" }\n}\n";
        write_cv_json_at(&path, text).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_cv_name_that_is_not_a_plain_name_falls_back_to_cv_json() {
        // Boundary: the suggested name is the user's own CV name with `.json`
        // on the end, so separators, `..` and control characters are plausible
        // and every one of them lands on the fallback, never a repaired path.
        assert_eq!(
            bare_json_name("Steve Brady CV.json", FALLBACK_CV_JSON_NAME),
            "Steve Brady CV.json"
        );
        for hostile in [
            "../CV.json",
            "..\\CV.json",
            "C:CV.json",
            "docs/CV.json",
            "CV\u{7}.json",
            "CV.pdf",
            "",
        ] {
            assert_eq!(
                bare_json_name(hostile, FALLBACK_CV_JSON_NAME),
                FALLBACK_CV_JSON_NAME,
                "{hostile:?}"
            );
        }
        // And the fallback passes its own guard, so the safe answer is savable.
        assert_eq!(
            bare_json_name(FALLBACK_CV_JSON_NAME, FALLBACK_CV_JSON_NAME),
            FALLBACK_CV_JSON_NAME
        );
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

    // ── The text export (L-160) ─────────────────────────────────────────────

    #[test]
    fn a_text_export_accepts_only_txt_and_md() {
        assert_eq!(text_extension("txt").unwrap(), "txt");
        assert_eq!(text_extension("md").unwrap(), "md");
        // Boundary: case and surrounding whitespace are tidied, not refused.
        assert_eq!(text_extension(" TXT ").unwrap(), "txt");

        // Negative: everything else is an error before a dialog could open.
        for refused in ["exe", "json", "html", "bat", "", ".txt", "txt md", "docx"] {
            let error = text_extension(refused).expect_err(refused);
            assert!(
                error.contains(".txt or .md"),
                "{refused:?} produced: {error}"
            );
        }
    }

    #[test]
    fn a_text_export_is_refused_when_the_chosen_path_has_another_extension() {
        // The dialog's filter is advisory on some platforms: a user can type
        // `letter.exe` into the box. The write refuses it, and writes nothing.
        let wrong = temp_path("letter.exe");
        let error = write_text_export_at(&wrong, "Dear Hiring Manager,", "txt").unwrap_err();
        assert!(error.contains(".txt"), "{error}");
        assert!(!wrong.exists());

        // The OTHER allowed extension is still the wrong one for THIS save.
        let other = temp_path("letter.md");
        let error = write_text_export_at(&other, "Dear Hiring Manager,", "txt").unwrap_err();
        assert!(error.contains(".txt"), "{error}");
        assert!(!other.exists());

        let none = temp_path("letter");
        assert!(write_text_export_at(&none, "x", "md")
            .unwrap_err()
            .contains(".md"));
    }

    #[test]
    fn a_text_export_writes_the_text_verbatim_under_either_extension() {
        for extension in TEXT_EXTENSIONS {
            let path = temp_path(&format!("Tailored CV.{extension}"));
            let text = "PROFESSIONAL SUMMARY\nEight years of Python.\n\n- Bullet one\n";
            write_text_export_at(&path, text, extension).unwrap();
            assert_eq!(fs::read_to_string(&path).unwrap(), text);
            let _ = fs::remove_file(&path);
        }
    }

    #[test]
    fn a_text_export_over_the_size_cap_is_refused_before_anything_is_written() {
        let path = temp_path("huge.txt");
        let too_big = "a".repeat(MAX_TEXT_BYTES as usize + 1);
        let error = write_text_export_at(&path, &too_big, "txt").unwrap_err();
        assert!(error.contains("too large"), "{error}");
        assert!(!path.exists());
    }

    #[test]
    fn a_text_name_that_is_not_a_plain_name_falls_back_for_that_extension() {
        assert_eq!(
            bare_text_name("Tailored CV — Analyst.txt", "txt"),
            "Tailored CV — Analyst.txt"
        );
        assert_eq!(bare_text_name("Cover letter.md", "md"), "Cover letter.md");

        // The right shape under the WRONG extension is not a plain name for
        // this save, and the fallback carries the extension actually asked for.
        assert_eq!(
            bare_text_name("Cover letter.md", "txt"),
            "cviper-export.txt"
        );
        assert_eq!(bare_text_name("Tailored CV.txt", "md"), "cviper-export.md");

        for hostile in [
            "../CV.txt",
            "..\\CV.txt",
            "C:CV.txt",
            "docs/CV.txt",
            "CV\u{7}.txt",
            "",
        ] {
            assert_eq!(
                bare_text_name(hostile, "txt"),
                "cviper-export.txt",
                "{hostile:?}"
            );
        }

        // And the fallback passes its own guard, so the safe answer is savable.
        for extension in TEXT_EXTENSIONS {
            let fallback = format!("{FALLBACK_TEXT_STEM}.{extension}");
            assert_eq!(bare_text_name(&fallback, extension), fallback);
        }
    }

    // ── The Word export (L-165) ─────────────────────────────────────────────

    #[test]
    fn debase64_matches_the_rfc_vectors() {
        assert_eq!(debase64("").unwrap(), b"");
        assert_eq!(debase64("Zg==").unwrap(), b"f");
        assert_eq!(debase64("Zm8=").unwrap(), b"fo");
        assert_eq!(debase64("Zm9v").unwrap(), b"foo");
        assert_eq!(debase64("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(debase64("Zm9vYmE=").unwrap(), b"fooba");
        assert_eq!(debase64("Zm9vYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn debase64_undoes_base64_for_every_byte_value_and_every_length() {
        // The encoder above is tested against the RFC; the decoder is tested
        // against the encoder, over every byte value and every padding case.
        let all: Vec<u8> = (0u16..=255).map(|value| value as u8).collect();
        assert_eq!(debase64(&base64(&all)).unwrap(), all);

        for length in 0..64usize {
            let bytes: Vec<u8> = (0..length).map(|index| (index * 37 % 256) as u8).collect();
            assert_eq!(debase64(&base64(&bytes)).unwrap(), bytes, "length {length}");
        }
    }

    #[test]
    fn debase64_refuses_anything_that_is_not_padded_standard_base64() {
        // Negative: a character outside the alphabet, a length that is not a
        // multiple of four, padding anywhere but the end, too much padding,
        // whitespace and the URL-safe alphabet are all refusals, never a
        // best-effort byte string that is silently wrong.
        for bad in [
            "not base64!!",
            "Zg=",
            "Z",
            "Zm9v=",
            "Zg==Zg==",
            "====",
            "Zm9v\n",
            "Zm 9v",
            "Zm9-",
            "Zm9_",
            "Z===",
        ] {
            assert!(debase64(bad).is_none(), "{bad:?} decoded");
        }
    }

    #[test]
    fn a_bytes_export_accepts_only_docx() {
        assert_eq!(bytes_extension("docx").unwrap(), "docx");
        // Boundary: case and surrounding whitespace are tidied, not refused.
        assert_eq!(bytes_extension(" DOCX ").unwrap(), "docx");

        // Negative: everything else is an error before a dialog could open —
        // including the text extensions, which have their own command.
        for refused in ["exe", "json", "html", "bat", "", ".docx", "doc", "txt", "md", "docm"] {
            let error = bytes_extension(refused).expect_err(refused);
            assert!(error.contains(".docx"), "{refused:?} produced: {error}");
        }
    }

    #[test]
    fn a_bytes_export_decodes_the_base64_and_refuses_what_is_not() {
        assert_eq!(
            decode_bytes_export(&base64(b"PK\x03\x04")).unwrap(),
            b"PK\x03\x04"
        );

        let error = decode_bytes_export("not base64!!").unwrap_err();
        assert!(error.contains("could not be built"), "{error}");
    }

    #[test]
    fn a_bytes_export_over_the_size_cap_is_refused_before_it_is_decoded() {
        // Boundary: exactly the cap decodes; one byte past it is refused. The
        // base64's length alone refuses anything clearly past the cap before
        // it is decoded; the decoded length refuses the last byte or two.
        let at_cap = vec![0x2Au8; MAX_BYTES_EXPORT as usize];
        assert_eq!(decode_bytes_export(&base64(&at_cap)).unwrap().len(), at_cap.len());

        let over = vec![0x2Au8; MAX_BYTES_EXPORT as usize + 1];
        let error = decode_bytes_export(&base64(&over)).unwrap_err();
        assert!(error.contains("too large"), "{error}");

        // And the write refuses the same payload if it is handed the bytes
        // directly, so the cap does not depend on the command remembering.
        let path = temp_path("huge.docx");
        let error = write_bytes_export_at(&path, &over, "docx").unwrap_err();
        assert!(error.contains("too large"), "{error}");
        assert!(!path.exists());
    }

    #[test]
    fn a_bytes_export_is_refused_when_the_chosen_path_has_another_extension() {
        // The dialog's filter is advisory on some platforms: a user can type
        // `cv.exe` into the box. The write refuses it, and writes nothing.
        let wrong = temp_path("cv.exe");
        let error = write_bytes_export_at(&wrong, b"PK", "docx").unwrap_err();
        assert!(error.contains(".docx"), "{error}");
        assert!(!wrong.exists());

        // A near miss — the legacy Word extension — is still the wrong one.
        let legacy = temp_path("cv.doc");
        let error = write_bytes_export_at(&legacy, b"PK", "docx").unwrap_err();
        assert!(error.contains(".docx"), "{error}");
        assert!(!legacy.exists());

        let none = temp_path("cv");
        assert!(write_bytes_export_at(&none, b"PK", "docx")
            .unwrap_err()
            .contains(".docx"));
    }

    #[test]
    fn a_bytes_export_writes_the_bytes_verbatim() {
        // Every byte value, so a zip's binary sections survive the trip.
        let bytes: Vec<u8> = (0u16..=255).map(|value| value as u8).collect();
        let path = temp_path("Tailored CV.docx");
        write_bytes_export_at(&path, &bytes, "docx").unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_bytes_name_that_is_not_a_plain_name_falls_back_to_the_docx_fallback() {
        assert_eq!(
            bare_bytes_name("Tailored CV — Analyst.docx", "docx"),
            "Tailored CV — Analyst.docx"
        );

        // The right shape under the WRONG extension is not a plain name for
        // this save.
        assert_eq!(bare_bytes_name("Tailored CV.txt", "docx"), "cviper-export.docx");

        for hostile in ["../CV.docx", "..\\CV.docx", "C:CV.docx", "docs/CV.docx", "CV\u{7}.docx", ""] {
            assert_eq!(
                bare_bytes_name(hostile, "docx"),
                "cviper-export.docx",
                "{hostile:?}"
            );
        }

        // And the fallback passes its own guard, so the safe answer is savable.
        assert_eq!(bare_bytes_name("cviper-export.docx", "docx"), "cviper-export.docx");
    }

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
            describe_io_error(&std::io::Error::new(
                ErrorKind::Other,
                secret.display().to_string(),
            )),
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
    const CRATE_SOURCES: [(&str, &str); 8] = [
        ("db", include_str!("db.rs")),
        ("fetch_page", include_str!("fetch_page.rs")),
        ("files", include_str!("files.rs")),
        ("jobs", include_str!("jobs.rs")),
        ("keyless", include_str!("keyless.rs")),
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
            "pick_and_write_cv_json",
            "pick_and_write_text",
            "pick_and_read_profile_workspace",
            "pick_and_write_bytes",
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
            "invoke('pick_and_write_cv_json', ",
            "invoke('pick_and_write_text', ",
            "invoke('pick_and_read_profile_workspace')",
            "invoke('pick_and_write_bytes', ",
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
        // The text export adds `extension` — also one word, also unchanged by
        // the camelCase conversion. Three keys no longer fit Prettier's line,
        // so the object is read with its whitespace collapsed and its trailing
        // comma dropped, which is the only difference the formatter makes.
        let compact = PLATFORM_FILES_TS
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .replace(", }", " }");
        assert!(
            compact.contains(
                "invoke('pick_and_write_text', { contents, suggestion: suggestedName, extension }"
            ),
            "src/platform/files.ts no longer passes `contents`, `suggestion` and `extension`, \
             which are the parameter names pick_and_write_text declares"
        );
        // The Word export (L-165) takes the bytes as `encoded` — one word, not
        // `contents_base64`, which Tauri would expect as `contentsBase64` on
        // the JavaScript side with nothing to say so if the two ever drifted.
        assert!(
            compact.contains(
                "invoke('pick_and_write_bytes', { encoded, suggestion: suggestedName, extension }"
            ),
            "src/platform/files.ts no longer passes `encoded`, `suggestion` and `extension`, \
             which are the parameter names pick_and_write_bytes declares"
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

    // ── An ai-job-search workspace (L-167) ──────────────────────────────────
    //
    // A folder rather than a file, so the guards are different in kind: not
    // "is this the right sort of file" but "is anything read that was not
    // named, and does any name lead out of the folder".

    /// A fresh, empty folder of this call's own.
    fn temp_folder(name: &str) -> std::path::PathBuf {
        let folder = temp_path(name);
        fs::create_dir_all(&folder).expect("a temp folder");
        folder
    }

    #[test]
    fn an_empty_folder_is_not_a_workspace() {
        // Negative: the home directory, mis-clicked. Nothing in it is one of
        // the four names, so nothing is read and the refusal says why.
        let folder = temp_folder("empty-workspace");

        let error = read_workspace_at(&folder).unwrap_err();

        assert!(error.contains("does not look like an ai-job-search workspace"), "{error}");
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn a_folder_with_only_other_files_is_not_a_workspace() {
        // A folder full of things that are NOT the four names is the same
        // refusal: the names are constants, and nothing else counts.
        let folder = temp_folder("other-files");
        fs::write(folder.join("README.md"), "# Not a workspace").unwrap();
        fs::write(folder.join("claude.md.bak"), "stale").unwrap();
        fs::create_dir_all(folder.join(".claude/skills")).unwrap();

        let error = read_workspace_at(&folder).unwrap_err();

        assert!(error.contains("does not look like"), "{error}");
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn a_folder_with_only_claude_md_is_a_workspace_with_three_files_missing() {
        // Happy path, minimal: one of the four is enough, and the other three
        // come back as `None` rather than as an error or an empty string.
        let folder = temp_folder("claude-only");
        fs::write(folder.join("CLAUDE.md"), "# Job Application Assistant\n").unwrap();

        let files = read_workspace_at(&folder).unwrap();

        assert_eq!(files.claude_md.as_deref(), Some("# Job Application Assistant\n"));
        assert!(files.candidate_profile.is_none());
        assert!(files.job_evaluation.is_none());
        assert!(files.interview_prep.is_none());
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn the_three_skill_files_are_read_from_their_fixed_relative_paths() {
        let folder = temp_folder("full-workspace");
        let skill = folder.join(WORKSPACE_SKILL_FOLDER);
        fs::create_dir_all(&skill).unwrap();
        fs::write(folder.join("CLAUDE.md"), "claude").unwrap();
        fs::write(skill.join("01-candidate-profile.md"), "profile").unwrap();
        fs::write(skill.join("04-job-evaluation.md"), "evaluation").unwrap();
        fs::write(skill.join("07-interview-prep.md"), "interview").unwrap();
        // A file the framework also keeps, which this command must not touch.
        fs::write(skill.join("03-writing-style.md"), "not read").unwrap();

        let files = read_workspace_at(&folder).unwrap();

        assert_eq!(files.claude_md.as_deref(), Some("claude"));
        assert_eq!(files.candidate_profile.as_deref(), Some("profile"));
        assert_eq!(files.job_evaluation.as_deref(), Some("evaluation"));
        assert_eq!(files.interview_prep.as_deref(), Some("interview"));
        // The serialised shape has exactly the four keys and nothing from any
        // other file, so the fifth file above cannot have been read into it.
        let json = serde_json::to_value(&files).unwrap();
        let keys: Vec<&str> = json.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(
            keys,
            ["candidate_profile", "claude_md", "interview_prep", "job_evaluation"]
        );
        assert!(!json.to_string().contains("not read"));
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn a_link_that_leads_out_of_the_folder_is_refused_not_followed() {
        // THE guard. `CLAUDE.md -> <somewhere else>` must not be read, and the
        // refusal must be the whole read, not a silently skipped file.
        let folder = temp_folder("escaping-link");
        let outside = temp_path("outside-secret.md");
        fs::write(&outside, "s3cr3t contents").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, folder.join("CLAUDE.md")).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_file(&outside, folder.join("CLAUDE.md")).is_err() {
            // Creating a link needs Developer Mode or a privilege on Windows.
            // Without it there is nothing to test here; the unix run covers it.
            eprintln!("skipped: this Windows account cannot create symlinks");
            fs::remove_dir_all(&folder).ok();
            fs::remove_file(&outside).ok();
            return;
        }

        let error = read_workspace_at(&folder).unwrap_err();

        assert!(error.contains("outside"), "{error}");
        assert!(!error.contains("s3cr3t"), "the refusal must not carry the target: {error}");
        fs::remove_dir_all(&folder).ok();
        fs::remove_file(&outside).ok();
    }

    #[test]
    fn a_workspace_file_at_the_cap_is_read_and_one_byte_over_is_refused() {
        // Boundary, from the directory entry before the file is opened.
        let folder = temp_folder("oversize");
        let at_the_cap = "a".repeat(MAX_WORKSPACE_FILE_BYTES as usize);
        fs::write(folder.join("CLAUDE.md"), &at_the_cap).unwrap();
        assert_eq!(
            read_workspace_at(&folder).unwrap().claude_md.map(|text| text.len()),
            Some(MAX_WORKSPACE_FILE_BYTES as usize)
        );

        fs::write(folder.join("CLAUDE.md"), format!("{at_the_cap}a")).unwrap();
        let error = read_workspace_at(&folder).unwrap_err();
        assert!(error.contains("larger than"), "{error}");
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn a_workspace_file_that_is_not_text_is_refused() {
        let folder = temp_folder("binary-workspace");
        fs::write(folder.join("CLAUDE.md"), [0xFFu8, 0xFE, 0x00]).unwrap();

        let error = read_workspace_at(&folder).unwrap_err();

        assert!(error.contains("not text"), "{error}");
        fs::remove_dir_all(&folder).ok();
    }

    #[test]
    fn a_file_picked_instead_of_a_folder_is_refused() {
        let file = temp_path("CLAUDE.md");
        fs::write(&file, "# not a folder").unwrap();

        let error = read_workspace_at(&file).unwrap_err();

        assert!(error.contains("not a folder"), "{error}");
        fs::remove_file(&file).ok();
    }

    #[test]
    fn a_missing_folder_is_reported_without_its_path() {
        let gone = temp_path("s3cr3t-gone-folder");
        let error = read_workspace_at(&gone).unwrap_err();
        assert!(!error.contains("s3cr3t"), "{error}");
        assert!(!error.is_empty());
    }
}
