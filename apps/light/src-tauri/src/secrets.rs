//! API keys, held in the operating system's credential store.
//!
//! Windows Credential Manager, macOS Keychain, or the Secret Service on Linux —
//! whichever the `keyring` crate finds. Nothing here writes to a file, and no
//! key is ever stored in the SQLite database or in `tauri-plugin-store`.
//!
//! ============================================================================
//! THE KEY GOES IN AND DOES NOT COME BACK OUT
//! ============================================================================
//! Three commands are exposed to JavaScript:
//!
//!     secret_set     write a key
//!     secret_delete  remove a key
//!     secret_status  is there a key? — a bool, NEVER the value
//!
//! There is deliberately no `secret_get` command. `secret_get` exists, but it is
//! a plain Rust function that `generate_handler!` does not know about, so there
//! is no way to `invoke()` it. Later phases call it from Rust to build an
//! Authorization header immediately before a request.
//!
//! This is structural, and that is the entire point. "Never log an API key" is a
//! rule a person has to remember every time they write a `console.log`, and the
//! frontend is where logging, error reporting and React DevTools all live. If
//! the key cannot reach JavaScript, no amount of careless frontend code can leak
//! it. A future `secret_get` command would quietly undo that, which is why this
//! comment is longer than the function.
//! ============================================================================

use keyring::{Entry, Error as KeyErr};
use serde::{Deserialize, Serialize};

/// The service name every credential is filed under.
///
/// Changing this ORPHANS every key already saved: the old entries stay in the
/// credential store forever under the old service name, and the app reports
/// every key as missing. It is not a display string and nothing should read it
/// as one.
const SERVICE: &str = "cviper-light";

/// The largest secret we will try to store, in UTF-8 bytes.
///
/// Windows caps a credential blob at 2560 BYTES, and stores the password as
/// UTF-16 — so the real character budget there is 1280 units, not 2560. A UTF-8
/// string never encodes to more UTF-16 units than it has bytes, so a 1024-byte
/// limit is 2048 bytes of UTF-16 at worst: comfortably inside the cap on every
/// platform.
///
/// The first version of this constant was 2048, on the assumption that the
/// Windows cap counted characters. It does not, and
/// `a_value_at_the_size_limit_is_accepted` is the test that said so.
///
/// Every real key is far smaller than this — the longest provider key in use is
/// under 200 characters — so the limit only ever catches a paste accident.
const MAX_SECRET_BYTES: usize = 1024;

/// Which secret. A CLOSED SET, on purpose.
///
/// If this were a `String`, JavaScript could name any account in the credential
/// store — `git:https://github.com`, a saved Wi-Fi password, anything the user
/// has under this service — and `secret_status` would happily confirm whether it
/// existed. An enum makes the set of addressable credentials exactly these five,
/// enforced by serde before our code runs at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretKey {
    AdzunaAppId,
    AdzunaAppKey,
    ReedApiKey,
    AnthropicApiKey,
    OpenaiApiKey,
}

impl SecretKey {
    /// The account name this secret is filed under inside `SERVICE`.
    ///
    /// Written out rather than derived from the serde attribute. These strings
    /// are ON DISK in the user's credential store: renaming one orphans a key
    /// the user already saved. `account_names_match_the_serde_names` asserts the
    /// two spellings agree, so they can only diverge deliberately.
    fn account(self) -> &'static str {
        match self {
            SecretKey::AdzunaAppId => "adzuna_app_id",
            SecretKey::AdzunaAppKey => "adzuna_app_key",
            SecretKey::ReedApiKey => "reed_api_key",
            SecretKey::AnthropicApiKey => "anthropic_api_key",
            SecretKey::OpenaiApiKey => "openai_api_key",
        }
    }
}

/// Turn a keyring error into something safe to show a user.
///
/// ============================================================================
/// NEVER `{}` OR `{:?}` A `keyring::Error`.
/// ============================================================================
/// Several variants carry the secret itself:
///
///   * `BadEncoding(Vec<u8>)` — the raw password bytes.
///   * `BadDataFormat(Vec<u8>, _)` — the raw blob.
///   * `TooLong(String, u32)` / `Invalid(String, String)` — attribute values.
///
/// `Debug` on any of those prints the payload, and an error string is exactly
/// the thing that ends up in a log file, a bug report or a toast the user
/// screenshots. So every arm below is a fixed sentence with NOTHING
/// interpolated: no payload, no platform error, not even a number.
///
/// Losing the platform detail is a real cost, paid on purpose.
/// `no_error_message_renders_its_payload` enforces it.
///
/// The wildcard arm is required — `keyring::Error` is `#[non_exhaustive]`, so a
/// crate update can add a variant, and the safe default for an unknown error is
/// to say nothing about it.
/// ============================================================================
fn describe(error: &KeyErr) -> String {
    match error {
        KeyErr::NoEntry => "No key is saved for this service.",
        KeyErr::NoDefaultStore => {
            "This computer has no credential store that CViper can use, so keys cannot be saved."
        }
        KeyErr::NoStorageAccess(_) => {
            "The system credential store could not be opened. It may be locked \
             — try unlocking it and then saving the key again."
        }
        KeyErr::PlatformFailure(_) => {
            "The system credential store returned an error while saving the key."
        }
        KeyErr::BadEncoding(_) | KeyErr::BadDataFormat(_, _) => {
            "The saved key could not be read back. Delete it and enter it again."
        }
        KeyErr::BadStoreFormat(_) => {
            "The system credential store is in a format CViper does not understand."
        }
        KeyErr::TooLong(_, _) => "That key is too long for this computer's credential store.",
        KeyErr::Invalid(_, _) => "That key could not be saved in this computer's credential store.",
        KeyErr::Ambiguous(_) => {
            "There is more than one saved key with this name. Delete it and enter it again."
        }
        KeyErr::NotSupportedByStore(_) => {
            "This computer's credential store does not support what CViper asked it to do."
        }
        _ => "The system credential store returned an error CViper does not recognise.",
    }
    .to_string()
}

fn entry(key: SecretKey) -> Result<Entry, KeyErr> {
    // `keyring` v4's default features are the v1-compatible API, and the
    // platform store is initialised lazily on the first `Entry::new` — there is
    // no `set_default_store` call to make.
    Entry::new(SERVICE, key.account())
}

/// Everything `secret_set` checks before it goes anywhere near the credential
/// store.
///
/// Split out so the boundaries can be tested without a single real store call:
/// a test that has to write to the developer's Windows Credential Manager to
/// find out where the limit is has already done the damage.
fn validate_secret(value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err("Enter a key before saving. To remove the saved key, use Delete.".to_string());
    }

    if value.len() > MAX_SECRET_BYTES {
        // Neither the value nor its length appears in this message.
        return Err("That key is too long to save. Check it was pasted correctly.".to_string());
    }

    Ok(())
}

/// Save a key.
///
/// Validates BEFORE touching the credential store, so a mis-click cannot
/// replace a working key with a blank one.
#[tauri::command]
pub(crate) fn secret_set(key: SecretKey, value: String) -> Result<(), String> {
    validate_secret(&value)?;

    entry(key)
        .and_then(|entry| entry.set_password(&value))
        .map_err(|error| describe(&error))
}

/// Remove a key.
///
/// IDEMPOTENT: deleting a key that is not there succeeds. "Remove my key" has
/// been satisfied either way, and reporting an error for an absent credential
/// only ever produces a confusing message about something the user wanted gone.
#[tauri::command]
pub(crate) fn secret_delete(key: SecretKey) -> Result<(), String> {
    match entry(key).and_then(|entry| entry.delete_credential()) {
        Ok(()) | Err(KeyErr::NoEntry) => Ok(()),
        Err(error) => Err(describe(&error)),
    }
}

/// Is a key saved? `true` / `false` — NEVER the value.
///
/// The password is read because that is the only way to know a credential is
/// really there, and is then dropped inside this function. It is not returned,
/// not logged and not put in an error message.
#[tauri::command]
pub(crate) fn secret_status(key: SecretKey) -> Result<bool, String> {
    match entry(key).and_then(|entry| entry.get_password()) {
        Ok(_) => Ok(true),
        Err(KeyErr::NoEntry) => Ok(false),
        Err(error) => Err(describe(&error)),
    }
}

/// Read a key. **NOT A `#[tauri::command]`, and it must never become one.**
///
/// See the module comment: this is the only way to read a saved key, it is
/// callable from Rust only, and that is the structural reason a frontend bug
/// cannot leak the user's API key. Callers use it to build a request header and
/// drop the value immediately afterwards.
///
/// It returns `KeyErr` rather than `String` because its callers are Rust and
/// need to branch on `NoEntry` ("no key configured, fall back to the keyless
/// path") rather than parse a sentence.
///
/// Unused until the provider clients land in a later phase. It is written now so
/// the whole secret surface — what goes in, what comes out, and what JavaScript
/// can reach — can be reviewed as one piece.
#[allow(dead_code)]
pub(crate) fn secret_get(key: SecretKey) -> Result<String, KeyErr> {
    entry(key).and_then(|entry| entry.get_password())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deliberately NO test reads or writes the real credential store.
    ///
    /// `set_password` on a developer's machine is a side effect on their actual
    /// Windows Credential Manager that survives the test run. Everything below
    /// exercises the parts that can be tested without one: the wire format, the
    /// account names, the input guards that run before any store call, and the
    /// error messages.
    const ALL: [SecretKey; 5] = [
        SecretKey::AdzunaAppId,
        SecretKey::AdzunaAppKey,
        SecretKey::ReedApiKey,
        SecretKey::AnthropicApiKey,
        SecretKey::OpenaiApiKey,
    ];

    const EXPECTED_NAMES: [(SecretKey, &str); 5] = [
        (SecretKey::AdzunaAppId, "adzuna_app_id"),
        (SecretKey::AdzunaAppKey, "adzuna_app_key"),
        (SecretKey::ReedApiKey, "reed_api_key"),
        (SecretKey::AnthropicApiKey, "anthropic_api_key"),
        (SecretKey::OpenaiApiKey, "openai_api_key"),
    ];

    #[test]
    fn secret_keys_travel_as_snake_case_strings() {
        for (key, name) in EXPECTED_NAMES {
            assert_eq!(serde_json::to_string(&key).unwrap(), format!("\"{name}\""));
            assert_eq!(
                serde_json::from_str::<SecretKey>(&format!("\"{name}\"")).unwrap(),
                key
            );
        }
    }

    #[test]
    fn a_key_outside_the_closed_set_is_refused() {
        // This is the whole reason `SecretKey` is an enum and not a `String`:
        // JavaScript cannot name an arbitrary credential-store entry.
        for name in [
            "\"aws_secret_access_key\"",
            "\"git:https://github.com\"",
            "\"AdzunaAppId\"",
            "\"\"",
            "42",
        ] {
            assert!(
                serde_json::from_str::<SecretKey>(name).is_err(),
                "{name} should not deserialise into a SecretKey"
            );
        }
    }

    #[test]
    fn account_names_match_the_serde_names() {
        // They are written out separately because the account name is on disk in
        // the user's credential store. This test is what makes a divergence a
        // deliberate act rather than a rename nobody noticed.
        for (key, name) in EXPECTED_NAMES {
            assert_eq!(key.account(), name);
        }
    }

    #[test]
    fn account_names_are_unique() {
        let mut names: Vec<&str> = ALL.iter().map(|key| key.account()).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "two secrets share a credential name");
    }

    #[test]
    fn an_empty_value_is_refused() {
        for blank in ["", "   ", "\t\n"] {
            assert!(validate_secret(blank).is_err(), "{blank:?} should be refused");
        }
    }

    #[test]
    fn an_empty_value_is_refused_before_the_store_is_touched() {
        // Calls the real command, not the helper: this is the ordering
        // assertion. It returns on the validation failure, so no credential
        // store call is made and nothing on this machine changes.
        assert!(secret_set(SecretKey::ReedApiKey, String::new()).is_err());
    }

    #[test]
    fn a_value_at_the_size_limit_is_accepted() {
        // Boundary: MAX is allowed, MAX + 1 is not.
        assert!(validate_secret(&"k".repeat(MAX_SECRET_BYTES)).is_ok());

        let over = validate_secret(&"k".repeat(MAX_SECRET_BYTES + 1)).unwrap_err();
        assert!(over.contains("too long"));
    }

    #[test]
    fn the_limit_fits_a_windows_credential_blob() {
        // Windows caps the blob at 2560 BYTES of UTF-16. A UTF-8 string never
        // encodes to more UTF-16 units than it has bytes, so the worst case for
        // a value at our limit is MAX_SECRET_BYTES * 2 bytes on the wire.
        assert!(
            MAX_SECRET_BYTES * 2 <= 2560,
            "MAX_SECRET_BYTES is large enough that a valid key could still be \
             rejected by Windows with a platform error"
        );
    }

    #[test]
    fn a_rejection_message_never_repeats_the_value() {
        let secret = "sk-ant-do-not-log-me";
        let oversized = format!("{secret}{}", "x".repeat(MAX_SECRET_BYTES));

        let message = validate_secret(&oversized).unwrap_err();

        assert!(!message.contains(secret), "the message echoed the key back");
    }

    #[test]
    fn no_error_message_renders_its_payload() {
        let secret = "sk-ant-do-not-log-me";
        let cases: Vec<KeyErr> = vec![
            KeyErr::NoEntry,
            KeyErr::NoDefaultStore,
            KeyErr::BadEncoding(secret.as_bytes().to_vec()),
            KeyErr::BadDataFormat(secret.as_bytes().to_vec(), secret.into()),
            KeyErr::BadStoreFormat(secret.to_string()),
            KeyErr::TooLong(secret.to_string(), 2560),
            KeyErr::Invalid(secret.to_string(), secret.to_string()),
            KeyErr::NotSupportedByStore(secret.to_string()),
            KeyErr::PlatformFailure(secret.into()),
            KeyErr::NoStorageAccess(secret.into()),
        ];

        for error in cases {
            let message = describe(&error);
            assert!(
                !message.contains("sk-ant"),
                "an error message leaked the secret: {message}"
            );
            // The byte-carrying variants render as `[115, 107, ...]` under
            // `{:?}`, so any digit at all in the output means a payload got in.
            assert!(
                !message.chars().any(|character| character.is_ascii_digit()),
                "an error message contains a payload value: {message}"
            );
            assert!(!message.is_empty());
        }
    }

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

    #[test]
    fn the_comment_stripper_keeps_real_code_and_drops_prose() {
        let stripped = without_comments("// mentions secret_get\nlet x = 1; // secret_get\n");
        assert!(!stripped.contains("secret_get"));
        assert!(stripped.contains("let x = 1;"));
    }

    #[test]
    fn secret_get_is_not_exposed_to_javascript() {
        // Pins the signature, so a refactor cannot quietly change what the
        // Rust-only reader returns...
        let _: fn(SecretKey) -> Result<String, KeyErr> = secret_get;

        // ...and reads `lib.rs`, where `generate_handler!` decides what
        // JavaScript can actually reach. Comments are stripped first: the file
        // explains why there is no read command, and the guard must fail on a
        // registration, not on the explanation.
        let handler_source = without_comments(include_str!("lib.rs"));
        assert!(
            !handler_source.contains("secret_get"),
            "secret_get must never be registered in generate_handler! — see the \
             module comment in secrets.rs"
        );
    }
}
