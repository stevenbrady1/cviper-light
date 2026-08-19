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

    /// What to tell the user when the key they need is not saved.
    fn missing_key_message(self) -> &'static str {
        match self {
            ProviderId::Anthropic => {
                "No Anthropic API key is saved. Add one in Settings before using this provider."
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
enum RequestFailure {
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
fn classify(error: &reqwest::Error) -> RequestFailure {
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

/// One shared client, built once.
///
/// Per-request timeouts rather than a client-wide one, because the probe wants
/// 500ms and a chat wants 180 seconds from the same connection pool.
fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();

    // `build()` can fail if no rustls crypto provider is installed — see the
    // note on the reqwest dependency in Cargo.toml. Reported as a clean error
    // rather than an `unwrap()` panic, because a panic in a Tauri command takes
    // the whole window with it.
    CLIENT
        .get_or_init(|| reqwest::Client::builder().build().ok())
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
}
