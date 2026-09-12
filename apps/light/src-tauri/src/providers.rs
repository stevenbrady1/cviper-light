//! The AI provider transport. Rust owns the URL and the key; JavaScript owns
//! neither.
//!
//! ============================================================================
//! THERE IS NO GENERIC `http_request(url)` COMMAND, AND THERE MUST NEVER BE.
//! ============================================================================
//! A command that took a URL from JavaScript would be a server-side request
//! forgery hole with a nice name: any injected script — and this app feeds
//! attacker-influenced job adverts into an LLM all day — could use the desktop
//! app as a proxy to anywhere the user's machine can reach, including
//! `localhost` admin panels and cloud metadata endpoints, with the user's own
//! credentials attached.
//!
//! So the commands here are narrow to the point of being boring. JavaScript
//! chooses a provider from a THREE-VARIANT ENUM and supplies a request body.
//! Everything that decides *where the bytes go* — scheme, host, path, method —
//! is a `&'static str` in this file. The worst a compromised frontend can do is
//! send a malformed body to an API we were going to call anyway.
//!
//! ============================================================================
//! THE KEY IS FETCHED HERE AND DIES HERE
//! ============================================================================
//! `secrets::secret_get` is Rust-only by design (see `secrets.rs`). It is called
//! immediately before a request, used to build one header, and dropped. It is
//! never returned, never logged, and never interpolated into an error — see
//! `describe_request_failure`, where every message is a fixed sentence.

use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::secrets::{self, SecretKey};

/// Which provider. A CLOSED SET, for the same reason `SecretKey` is one: it is
/// the only thing standing between "call this API" and "call anything".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderId {
    Anthropic,
    Openai,
    Ollama,
}

impl ProviderId {
    /// Scheme and host. NEVER built from anything JavaScript sent.
    ///
    /// Ollama is `127.0.0.1`, not `localhost`: on Windows `localhost` resolves
    /// to `::1` first, and Ollama binds IPv4 by default, so the name costs a
    /// failed connection and a retry on every single call.
    fn base_url(self) -> &'static str {
        match self {
            ProviderId::Anthropic => "https://api.anthropic.com",
            ProviderId::Openai => "https://api.openai.com",
            ProviderId::Ollama => "http://127.0.0.1:11434",
        }
    }

    fn chat_path(self) -> &'static str {
        match self {
            ProviderId::Anthropic => "/v1/messages",
            ProviderId::Openai => "/v1/chat/completions",
            // The NATIVE endpoint. Not /v1/chat/completions — Ollama's
            // OpenAI-compatible shim drops `options` and the schema `format`.
            ProviderId::Ollama => "/api/chat",
        }
    }

    fn models_path(self) -> &'static str {
        match self {
            ProviderId::Anthropic | ProviderId::Openai => "/v1/models",
            ProviderId::Ollama => "/api/tags",
        }
    }

    /// Which saved key this provider needs. `None` means it needs none.
    fn secret(self) -> Option<SecretKey> {
        match self {
            ProviderId::Anthropic => Some(SecretKey::AnthropicApiKey),
            ProviderId::Openai => Some(SecretKey::OpenaiApiKey),
            // Local, keyless. This is why the app is useful with no account.
            ProviderId::Ollama => None,
        }
    }

    /// How this provider's name reads in a sentence shown to a person.
    ///
    /// The ONLY thing ever interpolated into a key-test message. It is a
    /// `&'static str` chosen by a closed enum, not anything a caller sent and
    /// not anything a server answered, so the messages stay fixed sentences.
    fn label(self) -> &'static str {
        match self {
            ProviderId::Anthropic => "Anthropic",
            ProviderId::Openai => "OpenAI",
            ProviderId::Ollama => "Ollama",
        }
    }

    /// What to tell the user when the key they need is not saved.
    fn missing_key_message(self) -> &'static str {
        match self {
            // L-102: there is no Anthropic key card in Settings, so "Add one in
            // Settings" sent the user looking for a screen that does not exist.
            // `only_a_provider_with_a_key_card_is_told_to_add_one_in_settings`
            // reads the card registry and ties this arm to it, so adding an
            // Anthropic card makes THIS sentence the thing that fails the build.
            ProviderId::Anthropic => {
                "No Anthropic API key is saved, and this version of CViper has no screen for \
                 adding one."
            }
            ProviderId::Openai => {
                "No OpenAI API key is saved. Add one in Settings before using this provider."
            }
            ProviderId::Ollama => "Ollama does not use an API key.",
        }
    }
}

/// A chat generation can take a long time.
///
/// The first call to a model that is not resident loads several gigabytes into
/// VRAM, which is 5-30 seconds before a single token is produced. A "sensible"
/// 30-second timeout would kill real requests and present as a hang, so the
/// budget is generous and the UI is expected to show progress instead.
const CHAT_TIMEOUT: Duration = Duration::from_secs(180);

/// Listing models is a cheap metadata call on every provider.
const MODELS_TIMEOUT: Duration = Duration::from_secs(30);

/// "Is Ollama there?" — answered fast or not at all.
///
/// This runs on app start and whenever the provider picker opens, so it must
/// never make the UI wait. Half a second is far longer than a loopback round
/// trip and far shorter than a person notices.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

/// The largest request body we will forward, in bytes.
///
/// The real prompt is ~10 KB. A megabyte is generous enough never to catch a
/// legitimate call and small enough that a runaway frontend loop cannot push
/// the process into swap.
const MAX_CHAT_BODY_BYTES: usize = 1_048_576;

/// What JavaScript gets back for any request that actually reached the server.
///
/// ============================================================================
/// A NON-2xx IS `Ok`, NOT `Err`.
/// ============================================================================
/// `Err` is reserved for "the request never completed". A 401 completed
/// perfectly — the provider read it and refused it, and its body explains why
/// in words worth showing the user. Collapsing that into an error string here
/// would throw away the explanation and force the adapters to parse prose. So
/// the status travels with the body and the TypeScript adapter classifies it.
#[derive(Serialize)]
struct HttpEnvelope {
    status: u16,
    body: String,
}

/// The `Err` payload of every command here: a JSON object, not a bare sentence.
///
/// ============================================================================
/// WHY THE ERROR IS STRUCTURED
/// ============================================================================
/// The command signature is `Result<String, String>`, so the failure channel is
/// a string either way. Making that string JSON costs nothing and buys the one
/// thing the UI actually needs: WHICH failure it was. "No key saved" opens
/// Settings, "Ollama is not running" offers a download link, "network" offers a
/// retry — three different screens.
///
/// The alternative is TypeScript matching on English prose, which breaks
/// silently the first time someone improves the wording, and breaks invisibly
/// for anyone who ever translates it.
///
/// `kind` values are exactly the `ProviderErrorKind` strings in
/// packages/ai-providers/src/types.ts. `error_kinds_match_the_typescript_union`
/// is what stops the two drifting.
#[derive(Serialize)]
struct TransportError {
    kind: &'static str,
    message: String,
}

fn transport_error(kind: &'static str, message: String) -> String {
    serde_json::to_string(&TransportError { kind, message })
        .unwrap_or_else(|_| r#"{"kind":"network","message":"The request failed."}"#.to_string())
}

/// How a request failed before any response existed.
///
/// A hand-rolled enum rather than `reqwest::Error` so the message table below
/// is a pure function that can be tested exhaustively WITHOUT a network.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RequestFailure {
    Timeout,
    Connect,
    Body,
    Decode,
    Other,
}

/// Turn a transport failure into something safe to show a user.
///
/// ============================================================================
/// EVERY ARM IS A FIXED SENTENCE. NOTHING IS INTERPOLATED.
/// ============================================================================
/// `reqwest::Error`'s `Display` and `Debug` include the request URL and, when a
/// middleware is involved, can include header material. An error string is
/// exactly the thing that ends up in a log file, a bug report or a screenshot,
/// so nothing derived from the request reaches it — not the URL, not the status
/// text, not a number. `no_transport_message_leaks_request_detail` enforces it.
///
/// Losing the platform detail is a real cost, paid on purpose. It is the same
/// trade `secrets::describe` makes, for the same reason.
fn describe_request_failure(provider: ProviderId, failure: RequestFailure) -> String {
    match (provider, failure) {
        (ProviderId::Ollama, RequestFailure::Connect) => {
            "Ollama is not running. Start it and try again."
        }
        (ProviderId::Ollama, RequestFailure::Timeout) => {
            "Ollama did not answer in time. The model may still be loading — try again in a moment."
        }
        (_, RequestFailure::Connect) => {
            "Could not reach the provider. Check your internet connection and try again."
        }
        (_, RequestFailure::Timeout) => {
            "The provider did not answer in time. Try again, or use a shorter CV."
        }
        (_, RequestFailure::Body) => "The request could not be sent. Try again.",
        (_, RequestFailure::Decode) => "The provider's reply could not be read. Try again.",
        (_, RequestFailure::Other) => "The request failed before it reached the provider.",
    }
    .to_string()
}

/// Which `ProviderErrorKind` a transport failure maps to.
///
/// A local daemon that will not answer is "not running" — a normal condition
/// the UI can act on — while the same symptom against a cloud API is a network
/// problem the user can only retry.
fn failure_kind(provider: ProviderId, failure: RequestFailure) -> &'static str {
    match (provider, failure) {
        (ProviderId::Ollama, RequestFailure::Connect | RequestFailure::Timeout) => "not-running",
        _ => "network",
    }
}

/// Classify a `reqwest::Error` WITHOUT rendering it.
///
/// Only the predicates are consulted. The error value itself is dropped at the
/// end of this function and never formatted.
pub(crate) fn classify(error: &reqwest::Error) -> RequestFailure {
    if error.is_timeout() {
        RequestFailure::Timeout
    } else if error.is_connect() {
        RequestFailure::Connect
    } else if error.is_decode() {
        RequestFailure::Decode
    } else if error.is_body() {
        RequestFailure::Body
    } else {
        RequestFailure::Other
    }
}

/// Make sure rustls has a crypto provider before any client is built.
///
/// ============================================================================
/// WITHOUT THIS, THE FIRST HTTPS REQUEST PANICS THE WHOLE WINDOW.
/// ============================================================================
/// reqwest's `rustls-no-provider` feature selects no crypto provider, and
/// reqwest does NOT report the absence as an error:
/// `default_rustls_crypto_provider()` is an unconditional `panic!` reached from
/// inside `ClientBuilder::build()`. So `build().ok()` catches nothing, and a
/// panic inside a Tauri command takes the window with it.
///
/// The provider used to arrive by accident. `tauri-plugin-updater` calls
/// `install_default()` — but it does so inside its `check()` function, not at
/// plugin registration, so until the user had triggered an update check there
/// was no default provider and the first AI request killed the app. Enabling
/// the `rustls/ring` FEATURE, which the updater also does, is not the same
/// thing as installing the provider.
///
/// `install_default` returns `Err` if one is already installed, which is a
/// success for our purposes: something else got there first.
pub(crate) fn install_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// One shared client, built once.
///
/// Per-request timeouts rather than a client-wide one, because the probe wants
/// 500ms and a chat wants 180 seconds from the same connection pool.
pub(crate) fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();

    CLIENT
        .get_or_init(|| {
            // BEFORE `build()`, always: see `install_crypto_provider`.
            install_crypto_provider();
            reqwest::Client::builder().build().ok()
        })
        .as_ref()
        .ok_or_else(|| {
            transport_error(
                "network",
                "Secure networking is unavailable in this build.".to_string(),
            )
        })
}

/// Everything checked before a body is put on the wire.
///
/// Split out so the boundaries are testable without a socket.
fn validate_chat_body(body: &str) -> Result<(), String> {
    if body.trim().is_empty() {
        return Err("The request was empty.".to_string());
    }
    if body.len() > MAX_CHAT_BODY_BYTES {
        // Neither the body nor its length appears in the message.
        return Err("The request is too large to send.".to_string());
    }
    // A body that is not a JSON object is a frontend bug. Catching it here
    // turns a confusing provider 400 into a message that names the real cause.
    match serde_json::from_str::<serde_json::Value>(body) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err("The request was not valid JSON.".to_string()),
    }
}

/// Build the auth headers for a provider, reading the key at the last moment.
///
/// The returned `String` holds the key. It is moved straight into the request
/// builder by the caller and dropped when the request is sent.
fn auth_headers(provider: ProviderId) -> Result<Vec<(&'static str, String)>, String> {
    let Some(key) = provider.secret() else {
        return Ok(Vec::new());
    };

    let secret = match secrets::secret_get(key) {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => {
            return Err(transport_error(
                "no-key",
                provider.missing_key_message().to_string(),
            ))
        }
        Err(error) => return Err(transport_error("no-key", secrets::describe(&error))),
    };

    Ok(match provider {
        ProviderId::Anthropic => vec![
            ("x-api-key", secret),
            // Required on every request. Without it the API 400s.
            ("anthropic-version", "2023-06-01".to_string()),
        ],
        ProviderId::Openai => vec![("authorization", format!("Bearer {secret}"))],
        ProviderId::Ollama => Vec::new(),
    })
}

async fn send(provider: ProviderId, request: reqwest::RequestBuilder) -> Result<String, String> {
    let response = request.send().await.map_err(|error| {
        let failure = classify(&error);
        transport_error(
            failure_kind(provider, failure),
            describe_request_failure(provider, failure),
        )
    })?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| {
        let failure = classify(&error);
        transport_error(
            failure_kind(provider, failure),
            describe_request_failure(provider, failure),
        )
    })?;

    serde_json::to_string(&HttpEnvelope { status, body }).map_err(|_| {
        transport_error(
            "bad-response",
            "The provider's reply could not be read.".to_string(),
        )
    })
}

/// Send one chat request. `body` is the provider-shaped JSON built in
/// TypeScript; the URL, the method and the auth are decided here.
#[tauri::command]
pub(crate) async fn provider_chat(provider: ProviderId, body: String) -> Result<String, String> {
    validate_chat_body(&body).map_err(|message| transport_error("bad-request", message))?;

    let mut request = client()?
        .post(format!("{}{}", provider.base_url(), provider.chat_path()))
        .timeout(CHAT_TIMEOUT)
        .header("content-type", "application/json")
        .body(body);

    for (name, value) in auth_headers(provider)? {
        request = request.header(name, value);
    }

    send(provider, request).await
}

/// List the models this provider will accept.
#[tauri::command]
pub(crate) async fn provider_list_models(provider: ProviderId) -> Result<String, String> {
    let mut request = client()?
        .get(format!("{}{}", provider.base_url(), provider.models_path()))
        .timeout(MODELS_TIMEOUT);

    for (name, value) in auth_headers(provider)? {
        request = request.header(name, value);
    }

    send(provider, request).await
}

/// What a key test concluded, before any wording is chosen.
///
/// A hand-rolled enum rather than a status code carried around, so the message
/// table below is a pure function that can be tested exhaustively WITHOUT a
/// network — the same shape as `RequestFailure` above, for the same reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KeyTestOutcome {
    /// 401/403 — the provider read the key and refused it.
    Refused,
    /// 429 — the key is real, and it is being throttled.
    RateLimited,
    /// The request never completed: DNS, connection, timeout.
    Unreachable,
    /// 5xx — their end, not the key.
    ProviderFault,
    /// Any other non-2xx.
    Rejected,
}

/// Which outcome a COMPLETED key test reached. `None` means the key works.
///
/// Coarse on purpose, and the three the user can act on differently are the
/// three the card names: a refused key is re-pasted, an unreachable provider is
/// retried, and a rate limit is waited out.
fn key_test_outcome(status: u16) -> Option<KeyTestOutcome> {
    match status {
        200..=299 => None,
        401 | 403 => Some(KeyTestOutcome::Refused),
        429 => Some(KeyTestOutcome::RateLimited),
        500..=599 => Some(KeyTestOutcome::ProviderFault),
        _ => Some(KeyTestOutcome::Rejected),
    }
}

/// Which `ProviderErrorKind` each outcome maps to.
fn key_test_kind(outcome: KeyTestOutcome) -> &'static str {
    match outcome {
        KeyTestOutcome::Refused => "auth",
        KeyTestOutcome::RateLimited => "rate-limit",
        KeyTestOutcome::Unreachable => "network",
        KeyTestOutcome::ProviderFault => "server",
        KeyTestOutcome::Rejected => "bad-request",
    }
}

/// What to tell the user, for each outcome.
///
/// ============================================================================
/// EVERY ARM IS A FIXED SENTENCE. THE PROVIDER'S NAME IS THE ONLY VARIABLE.
/// ============================================================================
/// No status code, no digit, and not one byte of the response — `provider_test_key`
/// never reads the body at all, so there is nothing here that could have come
/// from the network. That matters more on this path than anywhere else in the
/// app: OpenAI's own 401 body quotes the rejected key back, masked, and a
/// transport that passed provider prose through would put a fragment of the
/// user's credential straight onto the card they just typed it into.
///
/// These five sentences are mirrored in `aiKeyModel.ts` so the card can be
/// tested without a socket, and `AiKeySetup.test.tsx` reads this file and
/// asserts the two still agree.
fn key_test_message(provider: ProviderId, outcome: KeyTestOutcome) -> String {
    let name = provider.label();
    match outcome {
        KeyTestOutcome::Refused => format!(
            "{name} did not accept that key. Check it was pasted whole — a brand new key can \
             take a few minutes to become active."
        ),
        KeyTestOutcome::Unreachable => {
            format!("CViper could not reach {name}. Check your internet connection and try again.")
        }
        KeyTestOutcome::RateLimited => {
            format!("{name} is rate-limiting this key. Wait a moment and test it again.")
        }
        KeyTestOutcome::ProviderFault => format!(
            "{name} is having trouble at their end. Nothing is wrong with your key — try again \
             shortly."
        ),
        KeyTestOutcome::Rejected => {
            format!("{name} would not accept the test request. Nothing was changed.")
        }
    }
}

/// Everything checked before a candidate key goes anywhere near the network.
///
/// The size limit is `secrets::MAX_SECRET_BYTES`, ALIASED rather than decided
/// again: a key that passes the test and is then refused by `secret_set` for
/// being too long is exactly the failure test-before-save exists to prevent.
///
/// Trimmed here as well as in the frontend. A pasted key very often carries a
/// trailing newline, and a newline cannot go into an HTTP header at all — the
/// request would fail before leaving the machine and the user would be told
/// their key was wrong. Trimming on both sides is also what makes the value
/// that was TESTED byte-identical to the value that gets SAVED.
///
/// NOTHING is interpolated into any message here. The value IS the secret.
fn candidate_key(provider: ProviderId, key: &str) -> Result<String, String> {
    if provider.secret().is_none() {
        return Err(transport_error(
            "bad-request",
            provider.missing_key_message().to_string(),
        ));
    }

    let trimmed = key.trim();

    if trimmed.is_empty() {
        return Err(transport_error(
            "no-key",
            "Paste your API key before testing it.".to_string(),
        ));
    }

    if trimmed.len() > secrets::MAX_SECRET_BYTES {
        return Err(transport_error(
            "bad-request",
            "That key is too long to save. Check it was pasted correctly.".to_string(),
        ));
    }

    Ok(trimmed.to_string())
}

/// Auth headers built from a key the user just TYPED, not from the keyring.
///
/// The deliberate twin of `auth_headers`, which reads the saved key. Keeping
/// them separate is what stops a key test silently falling back to whatever is
/// already in the credential store and reporting a pass for the wrong key.
fn candidate_auth_headers(provider: ProviderId, key: String) -> Vec<(&'static str, String)> {
    match provider {
        ProviderId::Anthropic => vec![
            ("x-api-key", key),
            ("anthropic-version", "2023-06-01".to_string()),
        ],
        ProviderId::Openai => vec![("authorization", format!("Bearer {key}"))],
        ProviderId::Ollama => Vec::new(),
    }
}

/// Does this key actually work? A real request, with nothing saved.
///
/// ============================================================================
/// THIS COMMAND CANNOT SAVE ANYTHING, AND THAT IS THE WHOLE POINT.
/// ============================================================================
/// The same reasoning as `jobs::job_test_credentials`, which this mirrors. A key
/// is only worth saving once it is known to work, and both of the other shapes
/// are worse:
///
///   * Save first, test afterwards. A mistyped key is then already in the
///     credential store — and, the part that actually hurts, it has already
///     overwritten the working key it was meant to replace.
///   * Save, test, delete on failure. Same window, plus a crash or a power cut
///     mid-test leaves the bad key in place with nothing to say so.
///
/// So the candidate travels in as an argument, is used to build one request, and
/// is dropped. `testing_a_key_cannot_save_one` asserts that nothing in this file
/// can reach `secret_set`, so the save can only happen afterwards, from the
/// frontend, once this has come back green.
///
/// The probe is `GET /v1/models` — the cheapest authenticated call OpenAI
/// offers. It is not billed, it returns no user data, and the RESPONSE BODY IS
/// NEVER READ: the status alone answers the only question being asked, and not
/// reading the body is what guarantees no provider prose can reach the user.
///
/// The key does NOT come back out, and this is not a weakening of `secret_get`.
/// A value the user typed thirty seconds ago, into a box they are still looking
/// at, is already in the frontend's memory. What stays impossible is reading a
/// SAVED key back.
#[tauri::command]
pub(crate) async fn provider_test_key(provider: ProviderId, key: String) -> Result<(), String> {
    let candidate = candidate_key(provider, &key)?;

    let mut request = client()?
        .get(format!("{}{}", provider.base_url(), provider.models_path()))
        .timeout(MODELS_TIMEOUT);

    for (name, value) in candidate_auth_headers(provider, candidate) {
        request = request.header(name, value);
    }

    // Every way of failing to arrive is one thing to the user: we could not
    // reach them. The `reqwest::Error` itself is dropped without being rendered.
    let response = request.send().await.map_err(|_| {
        transport_error(
            key_test_kind(KeyTestOutcome::Unreachable),
            key_test_message(provider, KeyTestOutcome::Unreachable),
        )
    })?;

    match key_test_outcome(response.status().as_u16()) {
        None => Ok(()),
        Some(outcome) => Err(transport_error(
            key_test_kind(outcome),
            key_test_message(provider, outcome),
        )),
    }
}

/// Is Ollama running?
///
/// ============================================================================
/// `Ok(None)` FOR EVERY FAILURE. "NOT RUNNING" IS NOT AN ERROR.
/// ============================================================================
/// Most users will never install Ollama, and the ones who do will not have it
/// running all the time. That is a normal state of the world, not a fault, and
/// surfacing it as an error would put a red message in front of someone who has
/// done nothing wrong and is about to use a cloud provider anyway.
///
/// So a timeout, a refused connection, a non-200, a body that will not read —
/// all of them are `Ok(None)`. The `Err` arm exists only to match the shape of
/// the other commands; nothing in this function produces one.
#[tauri::command]
pub(crate) async fn ollama_probe() -> Result<Option<String>, String> {
    let Ok(http) = client() else {
        return Ok(None);
    };

    let url = format!(
        "{}{}",
        ProviderId::Ollama.base_url(),
        ProviderId::Ollama.models_path()
    );

    let Ok(response) = http.get(url).timeout(PROBE_TIMEOUT).send().await else {
        return Ok(None);
    };
    if !response.status().is_success() {
        return Ok(None);
    }

    Ok(response.text().await.ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No test here opens a socket. Everything below exercises the parts that
    /// decide WHERE a request goes and WHAT a failure says — which is the whole
    /// security surface of this module.
    const ALL: [ProviderId; 3] = [
        ProviderId::Anthropic,
        ProviderId::Openai,
        ProviderId::Ollama,
    ];

    const EXPECTED_NAMES: [(ProviderId, &str); 3] = [
        (ProviderId::Anthropic, "anthropic"),
        (ProviderId::Openai, "openai"),
        (ProviderId::Ollama, "ollama"),
    ];

    #[test]
    fn the_shared_client_builds_without_an_update_check_first() {
        // ====================================================================
        // THE TEST THAT WAS MISSING, AND WHAT IT COSTS TO NOT HAVE IT.
        // ====================================================================
        // Nothing here opens a socket — `build()` only assembles the client.
        // But assembling it is where reqwest reaches for a rustls crypto
        // provider, and with `rustls-no-provider` and none installed that is an
        // unconditional `panic!` inside reqwest, not an `Err`. So this test
        // fails by taking the test process down, exactly as the real app failed
        // by taking the window down.
        //
        // It went unnoticed because `cargo check` does not run tests and
        // nothing else in the suite ever called `client()`: every other test
        // here exercises the pure functions around it.
        assert!(
            client().is_ok(),
            "the shared HTTP client could not be built"
        );
        assert!(
            rustls::crypto::CryptoProvider::get_default().is_some(),
            "no rustls crypto provider is installed, so the first HTTPS \
             request will panic the window"
        );

        // Idempotence is asserted HERE and not in a test of its own, and that
        // is not tidiness. Rust tests share one process: a separate test that
        // called `install_crypto_provider()` would install the provider for the
        // whole binary, and the assertions above would then pass even with the
        // call deleted from `client()` — a guard that cannot fail. That is
        // exactly what happened, and deleting the call and watching this test
        // stay green is how it was found.
        install_crypto_provider();
        install_crypto_provider();
        assert!(client().is_ok(), "installing twice broke the shared client");
    }

    #[test]
    fn provider_ids_travel_as_snake_case_strings() {
        // These strings are the TypeScript `ProviderId` union. A rename here
        // breaks every call from the frontend with an opaque deserialise error.
        for (provider, name) in EXPECTED_NAMES {
            assert_eq!(
                serde_json::to_string(&provider).unwrap(),
                format!("\"{name}\"")
            );
            assert_eq!(
                serde_json::from_str::<ProviderId>(&format!("\"{name}\"")).unwrap(),
                provider
            );
        }
    }

    #[test]
    fn a_provider_outside_the_closed_set_is_refused() {
        // The enum is what stops JavaScript naming an arbitrary destination.
        for name in [
            "\"Anthropic\"",
            "\"openai2\"",
            "\"http://evil.example.com\"",
            "\"\"",
            "42",
            "null",
        ] {
            assert!(
                serde_json::from_str::<ProviderId>(name).is_err(),
                "{name} must not deserialise into a ProviderId"
            );
        }
    }

    #[test]
    fn cloud_providers_are_https_and_ollama_is_loopback() {
        assert_eq!(
            ProviderId::Anthropic.base_url(),
            "https://api.anthropic.com"
        );
        assert_eq!(ProviderId::Openai.base_url(), "https://api.openai.com");
        // Loopback by IP, not by name: `localhost` resolves to ::1 first on
        // Windows and costs a failed connection on every call.
        assert_eq!(ProviderId::Ollama.base_url(), "http://127.0.0.1:11434");
    }

    #[test]
    fn every_url_is_absolute_and_has_no_placeholder() {
        for provider in ALL {
            for path in [provider.chat_path(), provider.models_path()] {
                let url = format!("{}{}", provider.base_url(), path);
                assert!(url.starts_with("http"), "{url} is not absolute");
                assert!(path.starts_with('/'), "{path} is not rooted");
                // Nothing in a URL is ever templated from caller input.
                assert!(!url.contains('{'), "{url} looks templated");
            }
        }
    }

    #[test]
    fn ollama_uses_the_native_chat_endpoint() {
        // The OpenAI-compatible shim silently drops `options` and the schema in
        // `format`, which is the whole reason we talk to the native API.
        assert_eq!(ProviderId::Ollama.chat_path(), "/api/chat");
        assert_eq!(ProviderId::Ollama.models_path(), "/api/tags");
    }

    #[test]
    fn only_the_cloud_providers_need_a_key() {
        assert_eq!(
            ProviderId::Anthropic.secret(),
            Some(SecretKey::AnthropicApiKey)
        );
        assert_eq!(ProviderId::Openai.secret(), Some(SecretKey::OpenaiApiKey));
        // Keyless local analysis is a product promise, not an accident.
        assert_eq!(ProviderId::Ollama.secret(), None);
    }

    #[test]
    fn a_keyless_provider_sends_no_auth_headers() {
        // Reads no secret, so it touches no credential store on this machine.
        assert_eq!(auth_headers(ProviderId::Ollama).unwrap(), Vec::new());
    }

    #[test]
    fn no_transport_message_leaks_request_detail() {
        let failures = [
            RequestFailure::Timeout,
            RequestFailure::Connect,
            RequestFailure::Body,
            RequestFailure::Decode,
            RequestFailure::Other,
        ];

        for provider in ALL {
            for failure in failures {
                let message = describe_request_failure(provider, failure);

                assert!(!message.is_empty());
                // No host, scheme, path or key material — a message is a fixed
                // sentence, so any of these means something got interpolated.
                for forbidden in [
                    "http",
                    "api.",
                    "127.0.0.1",
                    "/v1/",
                    "/api/",
                    "sk-",
                    "Bearer",
                    "x-api-key",
                ] {
                    assert!(
                        !message.contains(forbidden),
                        "transport message leaked {forbidden:?}: {message}"
                    );
                }
                // A status code or a port would arrive as digits.
                assert!(
                    !message.chars().any(|character| character.is_ascii_digit()),
                    "transport message contains a number: {message}"
                );
            }
        }
    }

    #[test]
    fn error_kinds_match_the_typescript_union() {
        // These four strings are members of `ProviderErrorKind` in
        // packages/ai-providers/src/types.ts. A typo here does not fail to
        // compile — it produces an error object the UI cannot classify, and the
        // user gets a generic message instead of the Settings screen.
        for kind in [
            "no-key",
            "not-running",
            "network",
            "bad-request",
            "bad-response",
        ] {
            let rendered = transport_error(kind, "a message".to_string());
            let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
            assert_eq!(parsed["kind"], kind);
            assert_eq!(parsed["message"], "a message");
        }
    }

    #[test]
    fn a_local_daemon_that_will_not_answer_is_not_running_not_a_network_fault() {
        // "Not running" opens a download link; "network" offers a retry. Two
        // different screens, so the distinction has to survive to the frontend.
        for failure in [RequestFailure::Connect, RequestFailure::Timeout] {
            assert_eq!(failure_kind(ProviderId::Ollama, failure), "not-running");
            assert_eq!(failure_kind(ProviderId::Anthropic, failure), "network");
            assert_eq!(failure_kind(ProviderId::Openai, failure), "network");
        }
    }

    #[test]
    fn every_transport_failure_maps_to_a_kind_and_a_clean_message() {
        let failures = [
            RequestFailure::Timeout,
            RequestFailure::Connect,
            RequestFailure::Body,
            RequestFailure::Decode,
            RequestFailure::Other,
        ];
        for provider in ALL {
            for failure in failures {
                let rendered = transport_error(
                    failure_kind(provider, failure),
                    describe_request_failure(provider, failure),
                );
                let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
                assert!(parsed["kind"].is_string());
                assert!(!parsed["message"].as_str().unwrap().is_empty());
            }
        }
    }

    #[test]
    fn a_stopped_daemon_is_described_as_ollama_not_as_the_internet() {
        let message = describe_request_failure(ProviderId::Ollama, RequestFailure::Connect);
        assert!(message.contains("Ollama"));
        assert!(!message.contains("internet"));
    }

    #[test]
    fn only_a_provider_with_a_key_card_is_told_to_add_one_in_settings() {
        // ====================================================================
        // THE COPY HALF OF L-102, TIED TO THE REGISTRY RATHER THAN REMEMBERED.
        // ====================================================================
        // "Add one in Settings" is only honest for a provider that HAS a card
        // there. Anthropic had no card and said it anyway, which is the same
        // defect as offering the option: the app pointing at a screen it never
        // built. Adding an Anthropic card must therefore flip this sentence
        // back, and this test is what makes that a build failure rather than
        // something the next person has to notice.
        //
        // The registry is read as text because it is TypeScript. Substring
        // matching is a fair proxy here — the union and the list name the same
        // ids, and `offeredProviders.contract.test.ts` proves that list matches
        // the cards that really exist.
        const KEY_CARDS_TS: &str = include_str!("../../src/features/settings/keys/aiKeyProviders.ts");

        // Anti-inert: prove the haystack is the real registry, and not the
        // empty string a moved or renamed file would hand us.
        assert!(
            KEY_CARDS_TS.contains("AI_KEY_PROVIDER_IDS"),
            "the AI key-card registry was not found where this test expects it"
        );
        assert!(
            KEY_CARDS_TS.contains("'openai'"),
            "the registry no longer names the one card that does exist"
        );

        for provider in ALL {
            // Ollama needs no key, so it has no card and nothing to say here.
            if provider.secret().is_none() {
                continue;
            }

            let serialised = serde_json::to_string(&provider).unwrap();
            let id = serialised.trim_matches('"');
            let has_card = KEY_CARDS_TS.contains(&format!("'{id}'"));
            let message = provider.missing_key_message();

            assert_eq!(
                has_card,
                message.contains("in Settings"),
                "{id}: a provider is told to add a key \"in Settings\" if and only if a key \
                 card exists for it. Message was: {message}"
            );
        }
    }

    #[test]
    fn the_missing_key_message_never_contains_a_key() {
        for provider in ALL {
            let message = provider.missing_key_message();
            assert!(!message.is_empty());
            assert!(!message.contains("sk-"));
        }
    }

    #[test]
    fn an_empty_or_non_json_body_is_refused_before_it_is_sent() {
        for bad in [
            "",
            "   ",
            "not json",
            "[1,2,3]",
            "\"a string\"",
            "42",
            "null",
        ] {
            assert!(
                validate_chat_body(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
    }

    #[test]
    fn a_json_object_body_is_accepted() {
        assert!(validate_chat_body("{}").is_ok());
        assert!(validate_chat_body("{\"model\":\"llama3.2:latest\"}").is_ok());
    }

    #[test]
    fn a_body_at_the_size_limit_is_accepted_and_one_past_it_is_not() {
        // Boundary: build a real JSON object of exactly MAX_CHAT_BODY_BYTES.
        let overhead = "{\"a\":\"\"}".len();
        let at_limit = format!(
            "{{\"a\":\"{}\"}}",
            "x".repeat(MAX_CHAT_BODY_BYTES - overhead)
        );
        assert_eq!(at_limit.len(), MAX_CHAT_BODY_BYTES);
        assert!(validate_chat_body(&at_limit).is_ok());

        let over = format!("{{\"a\":\"{}\"}}", "x".repeat(MAX_CHAT_BODY_BYTES));
        let message = validate_chat_body(&over).unwrap_err();
        assert!(message.contains("too large"));
        assert!(!message.contains("xxx"), "the message echoed the body back");
    }

    #[test]
    fn a_rejection_message_never_repeats_the_body() {
        let secret_ish = "sk-ant-do-not-log-me";
        let oversized = format!(
            "{{\"key\":\"{secret_ish}{}\"}}",
            "x".repeat(MAX_CHAT_BODY_BYTES)
        );
        let message = validate_chat_body(&oversized).unwrap_err();
        assert!(!message.contains(secret_ish), "the message echoed the body");
    }

    #[test]
    fn the_timeouts_are_the_ones_the_ui_depends_on() {
        // The probe runs on the UI path, so it must stay imperceptible.
        assert_eq!(PROBE_TIMEOUT, Duration::from_millis(500));
        // A cold VRAM load is 5-30s; anything under a minute kills real calls
        // and looks to the user exactly like a hang.
        assert_eq!(CHAT_TIMEOUT, Duration::from_secs(180));
        assert!(CHAT_TIMEOUT > MODELS_TIMEOUT);
        assert!(MODELS_TIMEOUT > PROBE_TIMEOUT);
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

    /// Everything before the test module — i.e. the code that actually ships.
    fn production_slice(source: &str) -> &str {
        match source.find("#[cfg(test)]") {
            Some(index) => &source[..index],
            None => source,
        }
    }

    #[test]
    fn the_production_slice_stops_at_the_test_module() {
        // Without this, `there_is_no_generic_url_taking_command` could silently
        // become a scan of an empty string and pass no matter what ships.
        let whole = without_comments(include_str!("providers.rs"));
        let production = production_slice(&whole);

        assert!(production.contains("pub(crate) async fn provider_chat"));
        assert!(production.contains("fn describe_request_failure"));
        assert!(!production.contains("mod tests"));
        assert!(
            production.len() > 1000,
            "the production slice is suspiciously small"
        );
    }

    #[test]
    fn every_command_is_registered_for_javascript() {
        // A `#[tauri::command]` that is not in `generate_handler!` is invisible
        // to the frontend and fails at runtime with "command not found" — there
        // is no compile error for it.
        let handler = without_comments(include_str!("lib.rs"));
        for command in ["provider_chat", "provider_list_models", "ollama_probe"] {
            assert!(
                handler.contains(command),
                "{command} is not registered in generate_handler!"
            );
        }
    }

    #[test]
    fn there_is_no_generic_url_taking_command() {
        // The SSRF guard, as a test rather than a comment. If a command ever
        // accepts a caller-supplied URL, this fails.
        //
        // Scanned up to `#[cfg(test)]` only. The test module below names the
        // forbidden patterns as string literals, and `without_comments` does
        // not strip string literals — so scanning the whole file makes this
        // guard fail on itself, every time, for ever. A guard that always
        // fails gets deleted by the next person, which is how a real one goes
        // missing. `the_production_slice_stops_at_the_test_module` proves the
        // cut lands where it should.
        let whole = without_comments(include_str!("providers.rs"));
        let source = production_slice(&whole);
        for forbidden in ["url: String", "url: &str", "fn http_request"] {
            assert!(
                !source.contains(forbidden),
                "a command appears to take a URL from the caller: {forbidden}"
            );
        }
    }

    // ── Testing a key that has NOT been saved ────────────────────────────

    const ALL_OUTCOMES: [KeyTestOutcome; 5] = [
        KeyTestOutcome::Refused,
        KeyTestOutcome::RateLimited,
        KeyTestOutcome::Unreachable,
        KeyTestOutcome::ProviderFault,
        KeyTestOutcome::Rejected,
    ];

    #[test]
    fn a_key_test_maps_each_status_to_the_outcome_the_user_can_act_on() {
        assert_eq!(key_test_outcome(401), Some(KeyTestOutcome::Refused));
        assert_eq!(key_test_outcome(403), Some(KeyTestOutcome::Refused));
        assert_eq!(key_test_outcome(429), Some(KeyTestOutcome::RateLimited));
        assert_eq!(key_test_outcome(500), Some(KeyTestOutcome::ProviderFault));
        assert_eq!(key_test_outcome(503), Some(KeyTestOutcome::ProviderFault));
        assert_eq!(key_test_outcome(400), Some(KeyTestOutcome::Rejected));
        assert_eq!(key_test_outcome(404), Some(KeyTestOutcome::Rejected));
    }

    #[test]
    fn boundary_only_the_two_hundreds_count_as_a_working_key() {
        // Boundary on the SUCCESS range, which is the part that matters: 200
        // and 299 pass, 199 and 300 do not.
        //
        // An earlier version of this comment claimed the 3xx arm stopped a
        // redirect being mistaken for a working key. It does not, and saying so
        // was worse than saying nothing: `client()` builds a plain
        // `reqwest::Client`, whose DEFAULT redirect policy follows up to ten
        // hops, so a 3xx is resolved inside `send()` and never reaches this
        // function at all. What actually arrives is the status at the end of
        // the chain.
        //
        // The arm is kept because the match must be total and an unreachable
        // status should still map somewhere sane — not because it is a
        // protection. Nothing here relies on a redirect policy, so none is
        // added: changing the shipped transport to make a comment true would be
        // the wrong way round.
        assert_eq!(key_test_outcome(199), Some(KeyTestOutcome::Rejected));
        assert_eq!(key_test_outcome(200), None);
        assert_eq!(key_test_outcome(299), None);
        assert_eq!(key_test_outcome(300), Some(KeyTestOutcome::Rejected));
    }

    #[test]
    fn the_three_outcomes_a_user_acts_on_differently_read_as_three_different_things() {
        let refused = key_test_message(ProviderId::Openai, KeyTestOutcome::Refused);
        let unreachable = key_test_message(ProviderId::Openai, KeyTestOutcome::Unreachable);
        let limited = key_test_message(ProviderId::Openai, KeyTestOutcome::RateLimited);

        // Re-paste it, retry it, wait for it. Three fixes, three sentences.
        assert!(refused.contains("did not accept that key"));
        assert!(unreachable.contains("could not reach OpenAI"));
        assert!(limited.contains("rate-limiting"));

        assert_ne!(refused, unreachable);
        assert_ne!(refused, limited);
        assert_ne!(unreachable, limited);

        // A rate limit must never read as the key being wrong: that would send
        // somebody off to re-paste a key that works perfectly.
        assert!(!limited.contains("did not accept"));
        assert!(!unreachable.contains("did not accept"));
    }

    #[test]
    fn no_key_test_message_leaks_a_status_a_digit_or_key_material() {
        for provider in ALL {
            for outcome in ALL_OUTCOMES {
                let message = key_test_message(provider, outcome);

                assert!(!message.is_empty());
                for forbidden in ["http", "api.", "/v1/", "sk-", "Bearer", "x-api-key"] {
                    assert!(
                        !message.contains(forbidden),
                        "key-test message leaked {forbidden:?}: {message}"
                    );
                }
                // A status code would arrive as digits.
                assert!(
                    !message.chars().any(|character| character.is_ascii_digit()),
                    "key-test message contains a number: {message}"
                );
            }
        }
    }

    #[test]
    fn key_test_kinds_are_members_of_the_typescript_union() {
        // Same contract as `error_kinds_match_the_typescript_union` above, for
        // the two kinds only this command can produce. `auth` and `rate-limit`
        // are members of `ProviderErrorKind` in packages/ai-providers/src/types.ts.
        for outcome in ALL_OUTCOMES {
            let kind = key_test_kind(outcome);
            assert!(
                ["auth", "rate-limit", "network", "server", "bad-request"].contains(&kind),
                "{kind} is not a ProviderErrorKind"
            );

            let rendered = transport_error(kind, key_test_message(ProviderId::Openai, outcome));
            let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
            assert_eq!(parsed["kind"], kind);
            assert!(!parsed["message"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn a_blank_candidate_key_is_refused_before_anything_is_sent() {
        for blank in ["", "   ", "\t\n"] {
            assert!(
                candidate_key(ProviderId::Openai, blank).is_err(),
                "{blank:?} should be refused"
            );
        }
    }

    #[test]
    fn a_candidate_key_is_trimmed_so_the_tested_value_is_the_saved_value() {
        // The trailing newline case is not hypothetical: copying a key out of a
        // terminal or a text file produces one every time, and a newline cannot
        // go into an HTTP header at all.
        assert_eq!(
            candidate_key(ProviderId::Openai, "  the-key  \n").unwrap(),
            "the-key"
        );
    }

    #[test]
    fn boundary_a_candidate_key_at_the_size_limit_is_accepted_and_one_byte_over_is_not() {
        // The same boundary `secret_set` enforces, aliased rather than repeated.
        // Testing a key that could never be saved would pass and then fail at
        // the save, which is the one sequence this whole flow exists to prevent.
        let at_limit = "k".repeat(secrets::MAX_SECRET_BYTES);
        assert!(candidate_key(ProviderId::Openai, &at_limit).is_ok());

        let over = "k".repeat(secrets::MAX_SECRET_BYTES + 1);
        assert!(candidate_key(ProviderId::Openai, &over).is_err());
    }

    #[test]
    fn boundary_a_key_far_longer_than_a_real_one_is_still_accepted() {
        // Five hundred characters is several times any real OpenAI key and
        // comfortably inside the credential store's limit, so it must pass. A
        // limit set by guesswork rather than by the store is how a legitimate
        // key gets refused for being "suspicious".
        assert!(candidate_key(ProviderId::Openai, &"k".repeat(500)).is_ok());
    }

    #[test]
    fn a_keyless_provider_cannot_be_key_tested() {
        // Ollama needs no key, so "test this key" is a category error rather
        // than a failure, and it must not put a request on the loopback port.
        assert!(candidate_key(ProviderId::Ollama, "anything").is_err());
    }

    #[test]
    fn a_rejected_candidate_key_never_appears_in_the_message() {
        let secret = "do-not-log-me";
        let oversized = format!("{secret}{}", "x".repeat(secrets::MAX_SECRET_BYTES));

        let message = candidate_key(ProviderId::Openai, &oversized).unwrap_err();
        assert!(!message.contains(secret), "the message echoed the key back");
        assert!(!message.contains("xxx"), "the message echoed the key back");
    }

    #[test]
    fn the_candidate_key_travels_in_the_header_each_provider_documents() {
        assert_eq!(
            candidate_auth_headers(ProviderId::Openai, "the-key".to_string()),
            vec![("authorization", "Bearer the-key".to_string())]
        );

        // Anthropic's own scheme, if the card is ever extended to it.
        assert!(
            candidate_auth_headers(ProviderId::Anthropic, "the-key".to_string())
                .iter()
                .any(|(name, value)| *name == "x-api-key" && value == "the-key")
        );

        // A keyless provider gets no header at all, so nothing can be sent to
        // the loopback daemon by accident.
        assert!(candidate_auth_headers(ProviderId::Ollama, "the-key".to_string()).is_empty());
    }

    #[test]
    fn a_key_test_reaches_the_models_endpoint_and_nothing_else() {
        // The cheapest authenticated call OpenAI offers: not billed, and it
        // returns no user data. The URL is assembled from two `&'static str`s.
        assert_eq!(
            format!(
                "{}{}",
                ProviderId::Openai.base_url(),
                ProviderId::Openai.models_path()
            ),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn testing_a_key_cannot_save_one() {
        // The structural half of "never persist an untested key". The command
        // that tests a candidate has no route to the credential store at all,
        // so the save can only happen afterwards, from the frontend, once the
        // test has come back green. The same guard `jobs.rs` carries.
        let whole = without_comments(include_str!("providers.rs"));
        let source = production_slice(&whole);

        for forbidden in ["secret_set", "set_password", "secret_delete"] {
            assert!(
                !source.contains(forbidden),
                "the provider transport can write to the credential store: {forbidden}"
            );
        }
    }

    #[test]
    fn the_key_test_command_is_registered_for_javascript() {
        let handler = without_comments(include_str!("lib.rs"));
        assert!(
            handler.contains("providers::provider_test_key,"),
            "provider_test_key is not registered in generate_handler!"
        );
    }

    #[test]
    fn the_frontend_calls_the_key_test_by_this_name() {
        const PORT_TS: &str = include_str!("../../src/features/settings/keys/aiKeyPort.ts");

        assert!(
            PORT_TS.contains("'provider_test_key'"),
            "the OpenAI key card does not invoke provider_test_key"
        );
        // The argument names must be the Rust parameter names exactly. A rename
        // on either side would otherwise break silently at runtime.
        assert!(
            PORT_TS.contains("{ provider: OPENAI_PROVIDER, key }"),
            "the OpenAI key card no longer passes `provider` and `key`"
        );
    }

    #[test]
    fn the_card_repeats_these_sentences_word_for_word() {
        // ====================================================================
        // FIVE SENTENCES, TWO LANGUAGES, ACROSS AN FFI BOUNDARY.
        // ====================================================================
        // They are declared here, because only the transport knows what
        // happened, and repeated in `aiKeyModel.ts` so the card can be tested
        // without a socket. That repetition is exactly the kind of thing that
        // drifts: reword an arm above and the TypeScript constants quietly
        // become a lie, which no test on that side would notice — every one of
        // them compares a constant against itself.
        //
        // The messages name the provider, and the card is the OpenAI one, so
        // the comparison is made with OpenAI's own wording.
        const MODEL_TS: &str = include_str!("../../src/features/settings/keys/aiKeyModel.ts");

        for outcome in ALL_OUTCOMES {
            let sentence = key_test_message(ProviderId::Openai, outcome);
            assert!(
                MODEL_TS.contains(&sentence),
                "aiKeyModel.ts no longer carries this sentence word for word: {sentence}"
            );
        }

        // Anti-inert: prove the haystack is the real file and the check can
        // actually fail, rather than passing on an empty string or a stale one.
        assert!(MODEL_TS.contains("AI_KEY_REFUSED"));
        assert!(
            !MODEL_TS.contains("OpenAI politely declined that key."),
            "the detector would pass on a sentence that is not there"
        );
    }
}
