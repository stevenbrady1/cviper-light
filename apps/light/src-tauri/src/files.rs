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
//! The path still comes from JavaScript, because the OS file dialog runs there
//! and returns one. What is NOT negotiable from JavaScript is everything else:
//!
//!   * the EXTENSION must be one this app actually reads. `read_cv_file`
//!     accepts pdf/docx/doc and nothing else; the backup commands accept json
//!     and nothing else. So the worst a compromised frontend can do is read a
//!     document, not a credential file.
//!   * the SIZE is checked from the directory entry BEFORE a byte is read, so a
//!     hostile or accidental 4 GB file cannot spend our memory before we have
//!     decided we do not want it.
//!   * it must be a FILE. A directory, a device node or a named pipe is
//!     refused rather than opened and blocked on.
//!
//! This is narrower than a filesystem plugin and wider than nothing, and the
//! trade is deliberate: the alternative — running the dialog from Rust so no
//! path ever crosses the boundary — cannot be tested without a display server,
//! and an untestable security boundary is not one.
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
use std::path::Path;

use serde::Serialize;

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

/// Extensions `read_cv_file` will open. Lower-case, no dot.
///
/// `doc` is here even though nothing can parse it: `@cviper/cv-parsing` answers
/// a legacy Word file with "open it in Word and use Save As", which is the most
/// useful thing anyone can tell that user. Refusing to read the bytes here
/// would replace that advice with "unsupported format".
const CV_EXTENSIONS: [&str; 3] = ["pdf", "docx", "doc"];

/// Extensions the backup commands will touch. Lower-case, no dot.
const BACKUP_EXTENSIONS: [&str; 1] = ["json"];

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
    /// The file's own name, e.g. `Steven Brady CV.pdf`. Never the full path:
    /// the frontend needs a name to label the CV with and already knows where
    /// it came from.
    name: String,
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

/// Read one CV the user picked in the file dialog.
///
/// Returns the bytes untouched. Every decision about whether they are really a
/// PDF, whether the PDF has a text layer, and what to tell the user when it
/// does not, belongs to `@cviper/cv-parsing` — this command's whole job is to
/// get the bytes across the boundary safely.
#[tauri::command]
pub(crate) fn read_cv_file(path: String) -> Result<CvFile, String> {
    let path = Path::new(&path);
    check_readable(path, &CV_EXTENSIONS, MAX_CV_BYTES, "a PDF or a Word (.docx) CV")?;

    let bytes = fs::read(path).map_err(|error| describe_io_error(&error))?;

    Ok(CvFile {
        name: file_name_of(path),
        bytes_base64: base64(&bytes),
    })
}

/// Read a backup file the user picked, as text.
///
/// The JSON is NOT parsed here. `importBackup` in `@cviper/core-types` owns
/// every word of every validation message, and a second opinion from Rust would
/// mean two places to keep in step and two different sentences for the same
/// broken file.
#[tauri::command]
pub(crate) fn read_backup_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    check_readable(
        path,
        &BACKUP_EXTENSIONS,
        MAX_BACKUP_BYTES,
        "a CViper backup (.json)",
    )?;

    fs::read_to_string(path).map_err(|error| match error.kind() {
        // The only failure `read_to_string` adds over `read`: the bytes are not
        // UTF-8. That is not a disk problem and deserves its own sentence.
        ErrorKind::InvalidData => {
            "That file is not text, so it cannot be a CViper backup. Pick the .json file you \
             exported."
                .to_string()
        }
        _ => describe_io_error(&error),
    })
}

/// Write a backup to the path the user chose in the save dialog.
///
/// `contents` comes from `exportBackup`, which is the single source of the file
/// format. Nothing here inspects or reformats it.
#[tauri::command]
pub(crate) fn write_backup_file(path: String, contents: String) -> Result<(), String> {
    let path = Path::new(&path);

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

#[cfg(test)]
mod tests {
    use super::*;

    /// The TypeScript side of the CV size limit, embedded at compile time.
    const CV_PARSING_CONSTANTS_TS: &str =
        include_str!("../../../../packages/cv-parsing/src/constants.ts");

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
        let error = read_cv_file(temp_path("absent.pdf").to_string_lossy().to_string())
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

    // ── The commands, end to end on a real file ─────────────────────────────

    #[test]
    fn a_cv_round_trips_through_the_command() {
        let path = temp_path("round-trip.pdf");
        fs::write(&path, b"%PDF-1.4 hello").unwrap();

        let file = read_cv_file(path.to_string_lossy().to_string()).unwrap();

        assert!(file.name.ends_with("round-trip.pdf"));
        assert!(!file.name.contains(std::path::MAIN_SEPARATOR));
        assert_eq!(file.bytes_base64, base64(b"%PDF-1.4 hello"));

        fs::remove_file(&path).ok();
    }

    #[test]
    fn a_backup_round_trips_through_the_commands() {
        let path = temp_path("round-trip.json");
        let contents = "{\n  \"schemaVersion\": 1\n}\n";

        write_backup_file(path.to_string_lossy().to_string(), contents.to_string()).unwrap();
        let read = read_backup_file(path.to_string_lossy().to_string()).unwrap();

        assert_eq!(read, contents);
        fs::remove_file(&path).ok();
    }

    #[test]
    fn a_backup_must_be_saved_as_json() {
        for name in ["backup.txt", "backup", "backup.json.exe"] {
            let error = write_backup_file(name.to_string(), "{}".to_string())
                .expect_err("only .json may be written");
            assert!(error.contains(".json"), "{name} produced: {error}");
        }
    }

    #[test]
    fn a_backup_that_is_not_text_is_reported_as_not_text() {
        let path = temp_path("binary.json");
        // A lone 0xFF is not valid UTF-8 in any position.
        fs::write(&path, [0xFFu8, 0xFE, 0x00]).unwrap();

        let error = read_backup_file(path.to_string_lossy().to_string()).unwrap_err();

        assert!(error.contains("not text"), "{error}");
        fs::remove_file(&path).ok();
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
            read_cv_file(secret.to_string_lossy().to_string()).unwrap_err(),
            read_backup_file(secret.to_string_lossy().to_string()).unwrap_err(),
            write_backup_file(secret.to_string_lossy().to_string(), "{}".to_string()).unwrap_err(),
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
}
