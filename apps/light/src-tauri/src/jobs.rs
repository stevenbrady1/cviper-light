//! Job-board search transport. Rust owns the URL and the keys; JavaScript owns
//! neither.
//!
//! Same shape and the same reasoning as `providers.rs` — read that module's
//! header first. The differences worth stating here are these three:
//!
//! ============================================================================
//! ADZUNA NEEDS TWO SECRETS, AND BOTH TRAVEL IN THE QUERY STRING
//! ============================================================================
//! `app_id` and `app_key` are separate credentials and Adzuna takes them as
//! query parameters rather than a header. They are read from the keyring
//! immediately before the request and dropped with the request builder. A
//! missing one of the two is the same failure as a missing key, because half a
//! credential authenticates nothing.
//!
//! ============================================================================
//! REED AUTHENTICATES WITH THE KEY AS A USERNAME AND NO PASSWORD
//! ============================================================================
//! HTTP Basic, key as the username, password empty — `base64("<key>:")`. That
//! is Reed's documented scheme, not a workaround.
//!
//! ============================================================================
//! THE MINIMUM GAP BETWEEN SUBMITS IS ENFORCED HERE, NOT IN THE UI
//! ============================================================================
//! Reed's free tier is 100 requests a DAY. A disabled button is a suggestion:
//! it is one `useState` away from not being disabled, it does nothing about a
//! double-click that lands inside one render, and it does nothing at all about
//! anything that gets into the WebView. The transport is the only place that
//! can actually refuse, so `SUBMIT_MIN_INTERVAL` lives here.
//!
//! The gate is PER PROVIDER. One submit fans out to Adzuna and Reed at the same
//! moment; a single global gate would let the first through and refuse the
//! second, so the user would silently get half a search whenever both boxes
//! were ticked.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::providers::{self, RequestFailure};
use crate::secrets::{self, SecretKey};

/// Which job board. A CLOSED SET, for the same reason `SecretKey` is one: it is
/// the only thing standing between "search this board" and "fetch anything".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobProvider {
    Adzuna,
    Reed,
}

/// The employment-type filter, when the user has picked one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmploymentType {
    Contract,
    Permanent,
}

/// What JavaScript is allowed to say about a search.
///
/// Note what is NOT in here: no URL, no path, no header, no page number, no
/// arbitrary key/value pairs. Every field is a value that ends up inside ONE
/// query parameter whose NAME is a `&'static str` in this file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSearchParams {
    pub keywords: String,
    pub location: String,
    pub limit: u32,
    pub distance_miles: Option<u32>,
    pub salary_min: Option<u32>,
    pub employment_type: Option<EmploymentType>,
}

const ADZUNA_RESULT_CAP: u32 = 50;
const REED_RESULT_CAP: u32 = 100;
const MAX_QUERY_CHARS: usize = 200;
const SUBMIT_MIN_INTERVAL: Duration = Duration::from_millis(1500);

/// The largest credential a key test will carry.
///
/// Aliased to `secrets::MAX_SECRET_BYTES` rather than written out again, so the
/// two can never disagree. A key that passes the test and is then refused by
/// `secret_set` for being too long is precisely the outcome the test-before-save
/// flow exists to prevent.
const MAX_CANDIDATE_BYTES: usize = secrets::MAX_SECRET_BYTES;
const ADZUNA_TIMEOUT: Duration = Duration::from_secs(15);
const REED_TIMEOUT: Duration = Duration::from_secs(10);

impl JobProvider {
    /// Scheme, host AND path. NEVER built from anything JavaScript sent.
    ///
    /// Adzuna takes the country and the page number as PATH segments, so both
    /// are baked in here: `gb` because this is a UK job-search tool, and page
    /// `1` because the app does not paginate — it asks for one page of up to
    /// fifty and spends no more of the user's allowance.
    fn base_url(self) -> &'static str {
        match self {
            JobProvider::Adzuna => "https://api.adzuna.com/v1/api/jobs/gb/search/1",
            JobProvider::Reed => "https://www.reed.co.uk/api/1.0/search",
        }
    }

    /// The largest page each API will actually return.
    fn result_cap(self) -> u32 {
        match self {
            JobProvider::Adzuna => ADZUNA_RESULT_CAP,
            JobProvider::Reed => REED_RESULT_CAP,
        }
    }

    /// Adzuna is consistently the slower of the two, and its own docs say so.
    fn timeout(self) -> Duration {
        match self {
            JobProvider::Adzuna => ADZUNA_TIMEOUT,
            JobProvider::Reed => REED_TIMEOUT,
        }
    }

    /// Which saved secrets this board needs. Adzuna needs BOTH of its two.
    fn secrets(self) -> &'static [SecretKey] {
        match self {
            JobProvider::Adzuna => &[SecretKey::AdzunaAppId, SecretKey::AdzunaAppKey],
            JobProvider::Reed => &[SecretKey::ReedApiKey],
        }
    }

    /// What to tell the user when a key they need is not saved.
    fn missing_key_message(self) -> &'static str {
        match self {
            JobProvider::Adzuna => {
                "Adzuna needs both an App ID and an App Key. Add them in Settings before searching."
            }
            JobProvider::Reed => {
                "No Reed API key is saved. Add one in Settings before searching."
            }
        }
    }

    /// Where this board's last search timestamp lives.
    fn last_submit(self) -> &'static Mutex<Option<Instant>> {
        match self {
            JobProvider::Adzuna => &ADZUNA_LAST_SUBMIT,
            JobProvider::Reed => &REED_LAST_SUBMIT,
        }
    }
}

/// How long to wait before this board may be searched again, or `None`.
///
/// A pure function of the two instants, so the boundary can be tested exactly
/// rather than by sleeping and hoping.
///
/// `saturating_duration_since` matters: `Instant` is monotonic so `now` should
/// never be before `last`, but if it ever were, a plain subtraction would panic
/// in release-mode-debug and an unsaturated one would produce a nonsense gap
/// that disabled searching until the app restarted.
fn throttle_decision(last: Option<Instant>, now: Instant) -> Option<Duration> {
    let previous = last?;
    let elapsed = now.saturating_duration_since(previous);
    if elapsed >= SUBMIT_MIN_INTERVAL {
        None
    } else {
        Some(SUBMIT_MIN_INTERVAL - elapsed)
    }
}

/// Take this board's submit slot, or report how long is left.
///
/// The timestamp is written under the same lock that read it, so two submits
/// arriving together cannot both see an old value and both go through.
fn claim_submit_slot(provider: JobProvider, now: Instant) -> Option<Duration> {
    let mut slot = match provider.last_submit().lock() {
        Ok(guard) => guard,
        // A poisoned lock means some other thread panicked while holding it.
        // The value inside is an `Option<Instant>`; there is no invariant to
        // restore, and refusing every future search over it would be worse.
        Err(poisoned) => poisoned.into_inner(),
    };

    match throttle_decision(*slot, now) {
        Some(wait) => Some(wait),
        None => {
            *slot = Some(now);
            None
        }
    }
}

/// Everything checked before a request is built.
///
/// The frontend checks the same two things (`buildSearchParams`) and this is
/// not redundant: the frontend is the part an injected script gets to
/// influence, and this is the check it cannot skip.
///
/// The length is counted in CHARACTERS while the frontend counts UTF-16 units,
/// so this side is very slightly the more permissive of the two. That is the
/// right way round for a backstop — it can never refuse something the frontend
/// already allowed.
fn validate_params(params: &JobSearchParams) -> Result<(), String> {
    if params.keywords.trim().is_empty() && params.location.trim().is_empty() {
        return Err("Enter a job title, some keywords, or a location before searching.".to_string());
    }

    if params.keywords.chars().count() > MAX_QUERY_CHARS
        || params.location.chars().count() > MAX_QUERY_CHARS
    {
        // Neither the text nor its length appears in the message.
        return Err(
            "That search is too long. Use a job title and a place name rather than a pasted advert."
                .to_string(),
        );
    }

    Ok(())
}

/// The query string for one search, as name/value pairs.
///
/// ============================================================================
/// EVERY NAME IS A `&'static str`. NOTHING JAVASCRIPT SENDS BECOMES A NAME.
/// ============================================================================
/// That is the whole safety property: the worst a compromised frontend can do
/// is put odd text in a value of a parameter we were going to send anyway.
/// `reqwest`'s `.query()` percent-encodes the values, so an `&` in a job title
/// cannot start a parameter of its own.
///
/// Credentials are deliberately NOT added here, so this function can be tested
/// exhaustively without touching the credential store on the machine running
/// the tests.
fn query_pairs(provider: JobProvider, params: &JobSearchParams) -> Vec<(&'static str, String)> {
    // Clamped, not refused: both APIs silently return their maximum for a
    // larger number, and a zero would ask for a page of nothing.
    let limit = params.limit.clamp(1, provider.result_cap());

    let mut pairs: Vec<(&'static str, String)> = Vec::new();

    match provider {
        JobProvider::Adzuna => {
            pairs.push(("what", params.keywords.clone()));
            pairs.push(("where", params.location.clone()));
            pairs.push(("results_per_page", limit.to_string()));
            pairs.push(("content-type", "application/json".to_string()));
            pairs.push(("sort_by", "relevance".to_string()));

            if let Some(salary) = params.salary_min {
                pairs.push(("salary_min", salary.to_string()));
            }
            if let Some(distance) = params.distance_miles {
                pairs.push(("distance", distance.to_string()));
            }
            // Adzuna's native filters, so the results arrive filtered rather
            // than being discarded after we have already paid for them.
            match params.employment_type {
                Some(EmploymentType::Contract) => pairs.push(("contract", "1".to_string())),
                Some(EmploymentType::Permanent) => pairs.push(("permanent", "1".to_string())),
                None => {}
            }
        }
        JobProvider::Reed => {
            pairs.push(("keywords", params.keywords.clone()));
            pairs.push(("locationName", params.location.clone()));
            pairs.push(("resultsToTake", limit.to_string()));

            if let Some(salary) = params.salary_min {
                pairs.push(("minimumSalary", salary.to_string()));
            }
            if let Some(distance) = params.distance_miles {
                pairs.push(("distanceFromLocation", distance.to_string()));
            }
            // All THREE of Reed's booleans, every time one is set. Reed's
            // default for an unmentioned flag is "include", so setting only
            // `contract=true` would still return permanent roles and the user
            // would think the filter was broken.
            match params.employment_type {
                Some(EmploymentType::Contract) => {
                    pairs.push(("contract", "true".to_string()));
                    pairs.push(("temp", "true".to_string()));
                    pairs.push(("permanent", "false".to_string()));
                }
                Some(EmploymentType::Permanent) => {
                    pairs.push(("permanent", "true".to_string()));
                    pairs.push(("contract", "false".to_string()));
                    pairs.push(("temp", "false".to_string()));
                }
                None => {}
            }
        }
    }

    pairs
}

/// The `Err` payload of this command: a JSON object, not a bare sentence.
///
/// Same reasoning as `providers::transport_error` — the UI needs to know WHICH
/// failure it was, and matching on English prose breaks the first time someone
/// improves the wording. `kind` values are members of `JobApiErrorKind` in
/// packages/job-apis/src/errors.ts, which `error_kinds_match_the_typescript_union`
/// enforces by reading that file.
fn transport_error(kind: &'static str, message: String) -> String {
    serde_json::to_string(&TransportError { kind, message })
        .unwrap_or_else(|_| r#"{"kind":"network","message":"The search failed."}"#.to_string())
}

#[derive(Serialize)]
struct TransportError {
    kind: &'static str,
    message: String,
}

/// What JavaScript gets back for a request that actually reached the server.
///
/// A NON-2xx IS `Ok`, NOT `Err` — see the same envelope in providers.rs. A 401
/// completed perfectly; the board read it and refused it, and which status it
/// was decides whether the UI opens Settings or offers a retry.
#[derive(Serialize)]
struct HttpEnvelope {
    status: u16,
    body: String,
}

/// Turn a transport failure into something safe to show a user.
///
/// EVERY ARM IS A FIXED SENTENCE. NOTHING IS INTERPOLATED — `reqwest::Error`'s
/// `Display` includes the request URL, and for Adzuna the URL carries both API
/// keys in its query string. An error string is exactly the thing that ends up
/// in a screenshot or a bug report.
fn describe_request_failure(provider: JobProvider, failure: RequestFailure) -> String {
    let board = match provider {
        JobProvider::Adzuna => "Adzuna",
        JobProvider::Reed => "Reed",
    };

    match failure {
        RequestFailure::Connect => {
            format!("Could not reach {board}. Check your internet connection and try again.")
        }
        RequestFailure::Timeout => {
            format!("{board} did not answer in time. Try again in a moment.")
        }
        RequestFailure::Body => format!("The search could not be sent to {board}. Try again."),
        RequestFailure::Decode => format!("The reply from {board} could not be read. Try again."),
        RequestFailure::Other => format!("The search failed before it reached {board}."),
    }
}

/// Read this board's credentials, at the last possible moment.
///
/// The returned strings hold the secrets. They are moved straight into the
/// request builder by the caller and dropped when the request is sent.
///
/// Adzuna needs BOTH of its two, and a missing one of them is reported as a
/// missing key rather than sent as half a credential — Adzuna answers half a
/// credential with a 401, which reads to the user as "your key is wrong" when
/// the truth is "you only saved one of them".
fn read_secrets(provider: JobProvider) -> Result<Vec<String>, String> {
    let mut values = Vec::new();

    for key in provider.secrets() {
        match secrets::secret_get(*key) {
            Ok(value) => values.push(value),
            Err(keyring::Error::NoEntry) => {
                return Err(transport_error(
                    "no-key",
                    provider.missing_key_message().to_string(),
                ))
            }
            Err(error) => return Err(transport_error("no-key", secrets::describe(&error))),
        }
    }

    Ok(values)
}

/// The one search a key test performs: ONE result, and terms Rust chose.
///
/// Built here rather than taken from the caller, for two reasons. The frontend
/// cannot turn "test this key" into "run me a search" — the probe spends one
/// result out of the user's daily allowance and nothing JavaScript says can
/// make it spend more. And the terms are ordinary enough that both boards will
/// certainly answer, so a failure means the KEY is wrong rather than the query.
fn probe_params() -> JobSearchParams {
    JobSearchParams {
        keywords: "developer".to_string(),
        location: "London".to_string(),
        limit: 1,
        distance_miles: None,
        salary_min: None,
        employment_type: None,
    }
}

/// Put the just-typed credentials in the order the request builder reads them.
///
/// ============================================================================
/// THE ORDER IS `provider.secrets()`, NOT THE ORDER THEY WERE SUPPLIED IN.
/// ============================================================================
/// `send_search` reads Adzuna's two values out of a `Vec` POSITIONALLY — app id
/// first, app key second. A `HashMap` has no order of its own, so pulling the
/// values in iteration order would send the id as the key roughly half the time
/// and tell the user their perfectly good key had been rejected.
///
/// A credential this board does not need is IGNORED rather than sent: a Reed
/// test that happens to carry an Adzuna id must not put the Adzuna id on the
/// wire to Reed. That falls out of iterating `provider.secrets()` rather than
/// the map, which is the reason it is written this way round.
///
/// The two guards are the same ones `secret_set` applies, aliased rather than
/// re-decided (see `MAX_CANDIDATE_BYTES`): a key that passes the test and is
/// then refused by the save is exactly the failure this flow exists to prevent.
///
/// NOTHING is interpolated into any message here. The values ARE the secrets.
fn candidate_credentials(
    provider: JobProvider,
    supplied: &HashMap<SecretKey, String>,
) -> Result<Vec<String>, String> {
    let mut values = Vec::new();

    for key in provider.secrets() {
        let value = match supplied.get(key) {
            Some(value) if !value.trim().is_empty() => value,
            // Absent and blank are the same answer to the user: this board
            // cannot be tested until every box it needs has something in it.
            _ => {
                return Err(transport_error(
                    "no-key",
                    provider.missing_key_message().to_string(),
                ))
            }
        };

        if value.len() > MAX_CANDIDATE_BYTES {
            return Err(transport_error(
                "bad-request",
                "That key is too long to save. Check it was pasted correctly.".to_string(),
            ));
        }

        values.push(value.clone());
    }

    Ok(values)
}

/// Validate, then take this board's submit slot — or say how long is left.
///
/// Ordering matters and is deliberate: validate first, because it is free and a
/// rejected search must not burn the slot. Shared by both commands below, so a
/// key test is throttled on exactly the same terms as a search — it is a real
/// request to a real board and the board does not care why we sent it.
fn validate_and_claim(provider: JobProvider, params: &JobSearchParams) -> Result<(), String> {
    validate_params(params).map_err(|message| transport_error("bad-request", message))?;

    if let Some(wait) = claim_submit_slot(provider, Instant::now()) {
        // Rounded up to whole seconds so the message is never "wait 0 seconds".
        let seconds = wait.as_millis().div_ceil(1000).max(1);
        return Err(transport_error(
            "throttled",
            format!(
                "That was very quick after the last search. Wait about {seconds} second(s) and \
                 try again — job boards allow a limited number of searches a day."
            ),
        ));
    }

    Ok(())
}

/// Send one already-validated search, with the credentials already in hand.
///
/// Extracted so `job_search` (credentials from the keyring) and
/// `job_test_credentials` (credentials the user just typed) cannot drift apart
/// in HOW they authenticate. There is exactly one place that decides Adzuna's
/// two values go in the query string and Reed's one goes in Basic auth.
///
/// The credentials are MOVED in and dropped with the request builder.
async fn send_search(
    provider: JobProvider,
    params: &JobSearchParams,
    credentials: Vec<String>,
) -> Result<String, String> {
    let mut query = query_pairs(provider, params);

    let mut request = providers::client()?
        .get(provider.base_url())
        .timeout(provider.timeout());

    match provider {
        JobProvider::Adzuna => {
            // Adzuna takes both credentials as query parameters. The names are
            // fixed here; only the values come from the credential store.
            let mut values = credentials.into_iter();
            if let (Some(app_id), Some(app_key)) = (values.next(), values.next()) {
                query.push(("app_id", app_id));
                query.push(("app_key", app_key));
            }
        }
        JobProvider::Reed => {
            // HTTP Basic with the key as the USERNAME and an empty password.
            // Reed's documented scheme, not a workaround.
            if let Some(key) = credentials.into_iter().next() {
                request = request.basic_auth(key, Some(""));
            }
        }
    }

    let response = request.query(&query).send().await.map_err(|error| {
        let failure = providers::classify(&error);
        transport_error("network", describe_request_failure(provider, failure))
    })?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| {
        let failure = providers::classify(&error);
        transport_error("network", describe_request_failure(provider, failure))
    })?;

    serde_json::to_string(&HttpEnvelope { status, body }).map_err(|_| {
        transport_error(
            "bad-response",
            "The reply from this job board could not be read.".to_string(),
        )
    })
}

/// One search against one board, using the keys this machine has saved.
#[tauri::command]
pub(crate) async fn job_search(
    provider: JobProvider,
    params: JobSearchParams,
) -> Result<String, String> {
    validate_and_claim(provider, &params)?;

    // Read at the last possible moment, and dropped with the request.
    let credentials = read_secrets(provider)?;
    send_search(provider, &params, credentials).await
}

/// Does this key actually work? A real one-result search, with nothing saved.
///
/// ============================================================================
/// THIS COMMAND CANNOT SAVE ANYTHING, AND THAT IS THE WHOLE POINT.
/// ============================================================================
/// A key is only worth saving once it is known to work. Both of the other
/// shapes are worse:
///
///   * Save first, test afterwards. A mistyped key is then already in the
///     credential store — and, the part that actually hurts, it has already
///     overwritten the working key it was meant to replace.
///   * Save, test, delete on failure. Same window, plus a crash or a power cut
///     mid-test leaves the bad key in place with nothing to say so.
///
/// So the candidate travels in as an argument, is used to build one request,
/// and is dropped. `testing_a_key_cannot_save_one` asserts that nothing in this
/// file can reach `secret_set`, so the save can only happen afterwards, from the
/// frontend, once this has come back green.
///
/// The key does NOT come back out, and this is not a weakening of `secret_get`.
/// A value the user typed thirty seconds ago, into a box they are still looking
/// at, is already in the frontend's memory. What stays impossible is reading a
/// SAVED key back — which is what `secret_get` protects, and which this leaves
/// exactly as it was.
#[tauri::command]
pub(crate) async fn job_test_credentials(
    provider: JobProvider,
    supplied: HashMap<SecretKey, String>,
) -> Result<String, String> {
    // Checked BEFORE the submit slot is claimed: a half-filled form is a
    // mistake to point at rather than a request, and it must not make the user
    // wait a second and a half before they can correct it.
    let credentials = candidate_credentials(provider, &supplied)?;

    let params = probe_params();
    validate_and_claim(provider, &params)?;

    send_search(provider, &params, credentials).await
}

static ADZUNA_LAST_SUBMIT: Mutex<Option<Instant>> = Mutex::new(None);
static REED_LAST_SUBMIT: Mutex<Option<Instant>> = Mutex::new(None);

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [JobProvider; 2] = [JobProvider::Adzuna, JobProvider::Reed];

    fn params() -> JobSearchParams {
        JobSearchParams {
            keywords: "credit risk analyst".to_string(),
            location: "London".to_string(),
            limit: 20,
            distance_miles: None,
            salary_min: None,
            employment_type: None,
        }
    }

    fn value_of<'a>(pairs: &'a [(&'static str, String)], name: &str) -> Option<&'a str> {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value.as_str())
    }

    #[test]
    fn provider_ids_travel_as_snake_case_strings() {
        for (provider, name) in [(JobProvider::Adzuna, "adzuna"), (JobProvider::Reed, "reed")] {
            assert_eq!(
                serde_json::to_string(&provider).unwrap(),
                format!("\"{name}\"")
            );
            assert_eq!(
                serde_json::from_str::<JobProvider>(&format!("\"{name}\"")).unwrap(),
                provider
            );
        }
    }

    #[test]
    fn a_provider_outside_the_closed_set_is_refused() {
        for name in [
            "\"Adzuna\"",
            "\"linkedin\"",
            "\"http://evil.example.com\"",
            "\"\"",
            "42",
            "null",
        ] {
            assert!(
                serde_json::from_str::<JobProvider>(name).is_err(),
                "{name} must not deserialise into a JobProvider"
            );
        }
    }

    #[test]
    fn the_employment_filter_is_a_closed_set_too() {
        assert_eq!(
            serde_json::from_str::<EmploymentType>("\"Contract\"").unwrap(),
            EmploymentType::Contract
        );
        assert_eq!(
            serde_json::from_str::<EmploymentType>("\"Permanent\"").unwrap(),
            EmploymentType::Permanent
        );
        for bad in ["\"contract\"", "\"Freelance\"", "\"\"", "1"] {
            assert!(serde_json::from_str::<EmploymentType>(bad).is_err());
        }
    }

    #[test]
    fn both_boards_are_https_and_neither_url_is_templated() {
        assert_eq!(
            JobProvider::Adzuna.base_url(),
            "https://api.adzuna.com/v1/api/jobs/gb/search/1"
        );
        assert_eq!(JobProvider::Reed.base_url(), "https://www.reed.co.uk/api/1.0/search");

        for provider in ALL {
            let url = provider.base_url();
            assert!(url.starts_with("https://"), "{url} is not https");
            assert!(!url.contains('{'), "{url} looks templated");
            assert!(!url.contains('?'), "{url} already carries a query string");
        }
    }

    #[test]
    fn the_params_struct_reads_the_camel_case_javascript_sends() {
        // Nothing fails to compile when the two sides of the boundary drift.
        // The call simply rejects at runtime, in a click handler, in a built
        // app - so the wire names are asserted here.
        let json = r#"{
            "keywords": "java",
            "location": "London",
            "limit": 20,
            "distanceMiles": 25,
            "salaryMin": 60000,
            "employmentType": "Contract"
        }"#;

        let parsed: JobSearchParams = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.distance_miles, Some(25));
        assert_eq!(parsed.salary_min, Some(60_000));
        assert_eq!(parsed.employment_type, Some(EmploymentType::Contract));
    }

    #[test]
    fn the_optional_filters_may_be_absent_or_null() {
        for json in [
            r#"{"keywords":"java","location":"London","limit":20}"#,
            r#"{"keywords":"java","location":"London","limit":20,"distanceMiles":null,"salaryMin":null,"employmentType":null}"#,
        ] {
            let parsed: JobSearchParams = serde_json::from_str(json).unwrap();
            assert_eq!(parsed.distance_miles, None);
            assert_eq!(parsed.salary_min, None);
            assert_eq!(parsed.employment_type, None);
        }
    }

    #[test]
    fn adzuna_sends_the_names_adzuna_documents() {
        let pairs = query_pairs(JobProvider::Adzuna, &params());

        assert_eq!(value_of(&pairs, "what"), Some("credit risk analyst"));
        assert_eq!(value_of(&pairs, "where"), Some("London"));
        assert_eq!(value_of(&pairs, "results_per_page"), Some("20"));
        // The keys are NOT here: they are injected next to the request, so this
        // function can be tested without touching the credential store.
        assert_eq!(value_of(&pairs, "app_id"), None);
        assert_eq!(value_of(&pairs, "app_key"), None);
    }

    #[test]
    fn reed_sends_the_names_reed_documents() {
        let pairs = query_pairs(JobProvider::Reed, &params());

        assert_eq!(value_of(&pairs, "keywords"), Some("credit risk analyst"));
        assert_eq!(value_of(&pairs, "locationName"), Some("London"));
        assert_eq!(value_of(&pairs, "resultsToTake"), Some("20"));
    }

    #[test]
    fn a_limit_over_the_documented_cap_is_clamped_not_refused() {
        // Boundary: the cap survives, one past it is clamped. Asking for more
        // than the API will give is not a mistake the user can see.
        let mut over = params();
        over.limit = 10_000;

        assert_eq!(
            value_of(&query_pairs(JobProvider::Adzuna, &over), "results_per_page"),
            Some("50")
        );
        assert_eq!(
            value_of(&query_pairs(JobProvider::Reed, &over), "resultsToTake"),
            Some("100")
        );

        let mut at_cap = params();
        at_cap.limit = ADZUNA_RESULT_CAP;
        assert_eq!(
            value_of(&query_pairs(JobProvider::Adzuna, &at_cap), "results_per_page"),
            Some("50")
        );
        at_cap.limit = REED_RESULT_CAP;
        assert_eq!(
            value_of(&query_pairs(JobProvider::Reed, &at_cap), "resultsToTake"),
            Some("100")
        );
    }

    #[test]
    fn a_limit_of_zero_becomes_one_rather_than_none() {
        // A search that silently returns nothing is the worse failure.
        let mut none = params();
        none.limit = 0;

        assert_eq!(
            value_of(&query_pairs(JobProvider::Reed, &none), "resultsToTake"),
            Some("1")
        );
    }

    #[test]
    fn an_absent_filter_sends_no_parameter_at_all() {
        // Not an empty one. `salary_min=` and `distance=` are values Adzuna and
        // Reed both interpret, and neither interprets them as "no filter".
        for provider in ALL {
            let pairs = query_pairs(provider, &params());
            for name in [
                "salary_min",
                "minimumSalary",
                "distance",
                "distanceFromLocation",
                "contract",
                "permanent",
                "temp",
            ] {
                assert_eq!(
                    value_of(&pairs, name),
                    None,
                    "{provider:?} sent {name} when the user asked for no filter"
                );
            }
        }
    }

    #[test]
    fn the_filters_are_sent_when_the_user_asks_for_them() {
        let mut filtered = params();
        filtered.salary_min = Some(60_000);
        filtered.distance_miles = Some(25);

        let adzuna = query_pairs(JobProvider::Adzuna, &filtered);
        assert_eq!(value_of(&adzuna, "salary_min"), Some("60000"));
        assert_eq!(value_of(&adzuna, "distance"), Some("25"));

        let reed = query_pairs(JobProvider::Reed, &filtered);
        assert_eq!(value_of(&reed, "minimumSalary"), Some("60000"));
        assert_eq!(value_of(&reed, "distanceFromLocation"), Some("25"));
    }

    #[test]
    fn reed_uses_its_native_boolean_filter_triple() {
        // Reed's own filters, so the results come back filtered rather than
        // being thrown away after we have already paid for them. All THREE are
        // set each time: setting only `contract=true` leaves `permanent`
        // defaulted, and Reed's default is "include".
        let mut contract = params();
        contract.employment_type = Some(EmploymentType::Contract);
        let pairs = query_pairs(JobProvider::Reed, &contract);
        assert_eq!(value_of(&pairs, "contract"), Some("true"));
        assert_eq!(value_of(&pairs, "temp"), Some("true"));
        assert_eq!(value_of(&pairs, "permanent"), Some("false"));

        let mut permanent = params();
        permanent.employment_type = Some(EmploymentType::Permanent);
        let pairs = query_pairs(JobProvider::Reed, &permanent);
        assert_eq!(value_of(&pairs, "permanent"), Some("true"));
        assert_eq!(value_of(&pairs, "contract"), Some("false"));
        assert_eq!(value_of(&pairs, "temp"), Some("false"));
    }

    #[test]
    fn adzuna_uses_its_own_native_filters() {
        let mut contract = params();
        contract.employment_type = Some(EmploymentType::Contract);
        assert_eq!(
            value_of(&query_pairs(JobProvider::Adzuna, &contract), "contract"),
            Some("1")
        );

        let mut permanent = params();
        permanent.employment_type = Some(EmploymentType::Permanent);
        assert_eq!(
            value_of(&query_pairs(JobProvider::Adzuna, &permanent), "permanent"),
            Some("1")
        );
    }

    #[test]
    fn no_query_parameter_name_is_ever_built_from_caller_input() {
        // The whole safety property of this module in one assertion: every NAME
        // is a fixed string, so the worst a compromised frontend can do is put
        // odd text in a value.
        let mut hostile = params();
        hostile.keywords = "&app_key=stolen&x=".to_string();
        hostile.location = "../../admin".to_string();

        for provider in ALL {
            for (name, _) in query_pairs(provider, &hostile) {
                assert!(
                    name.chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
                    "{provider:?} produced a parameter name from caller input: {name}"
                );
            }
        }
    }

    #[test]
    fn the_built_url_is_the_one_that_goes_on_the_wire() {
        // Builds a real `reqwest::Request` and reads its URL WITHOUT sending
        // it. Everything above tests the pairs; this tests what those pairs
        // actually become, which is the only form an attacker cares about.
        //
        // Built through the SHARED client, which is the one the command uses -
        // a local `Client::new()` here would test a client the app never
        // builds, and would miss the crypto-provider install that
        // `providers::client()` performs.
        let mut hostile = params();
        hostile.keywords = "M&A analyst&app_key=stolen".to_string();
        hostile.location = "Zürich #1".to_string();
        hostile.limit = 9_999;

        let request = providers::client()
            .unwrap()
            .get(JobProvider::Reed.base_url())
            .query(&query_pairs(JobProvider::Reed, &hostile))
            .build()
            .unwrap();
        let built = request.url().as_str();

        assert_eq!(
            built,
            "https://www.reed.co.uk/api/1.0/search\
             ?keywords=M%26A+analyst%26app_key%3Dstolen\
             &locationName=Z%C3%BCrich+%231\
             &resultsToTake=100"
        );

        // The host and path are untouched, and the injected `app_key` is a
        // percent-encoded part of a VALUE rather than a parameter of its own.
        assert_eq!(request.url().host_str(), Some("www.reed.co.uk"));
        assert_eq!(request.url().path(), "/api/1.0/search");
        assert_eq!(
            request
                .url()
                .query_pairs()
                .map(|(name, _)| name.into_owned())
                .collect::<Vec<_>>(),
            vec!["keywords", "locationName", "resultsToTake"]
        );
    }

    #[test]
    fn the_adzuna_url_keeps_its_country_and_page_path_segments() {
        let request = providers::client()
            .unwrap()
            .get(JobProvider::Adzuna.base_url())
            .query(&query_pairs(JobProvider::Adzuna, &params()))
            .build()
            .unwrap();

        assert_eq!(request.url().host_str(), Some("api.adzuna.com"));
        assert_eq!(request.url().path(), "/v1/api/jobs/gb/search/1");
        assert!(request
            .url()
            .as_str()
            .contains("what=credit+risk+analyst&where=London"));
    }

    #[test]
    fn an_empty_search_is_refused_before_anything_is_sent() {
        let mut empty = params();
        empty.keywords = "   ".to_string();
        empty.location = String::new();

        assert!(validate_params(&empty).is_err());
    }

    #[test]
    fn either_half_of_a_search_on_its_own_is_enough() {
        let mut keywords_only = params();
        keywords_only.location = String::new();
        assert!(validate_params(&keywords_only).is_ok());

        let mut location_only = params();
        location_only.keywords = String::new();
        assert!(validate_params(&location_only).is_ok());
    }

    #[test]
    fn boundary_the_query_length_cap_is_inclusive() {
        let mut at_limit = params();
        at_limit.keywords = "x".repeat(MAX_QUERY_CHARS);
        assert!(validate_params(&at_limit).is_ok());

        let mut over = params();
        over.keywords = "x".repeat(MAX_QUERY_CHARS + 1);
        assert!(validate_params(&over).is_err());

        let mut location_over = params();
        location_over.location = "x".repeat(MAX_QUERY_CHARS + 1);
        assert!(validate_params(&location_over).is_err());
    }

    #[test]
    fn a_rejection_message_never_repeats_the_search_back() {
        let secret_ish = "sk-do-not-log-me";
        let mut oversized = params();
        oversized.keywords = format!("{secret_ish}{}", "x".repeat(MAX_QUERY_CHARS));

        let message = validate_params(&oversized).unwrap_err();
        assert!(!message.contains(secret_ish), "the message echoed the search");
        assert!(!message.contains("xxx"), "the message echoed the search");
    }

    #[test]
    fn a_first_search_is_never_throttled() {
        assert_eq!(throttle_decision(None, Instant::now()), None);
    }

    #[test]
    fn boundary_a_search_at_the_minimum_gap_is_allowed() {
        let start = Instant::now();
        assert_eq!(
            throttle_decision(Some(start), start + SUBMIT_MIN_INTERVAL),
            None
        );
        assert_eq!(
            throttle_decision(Some(start), start + SUBMIT_MIN_INTERVAL + Duration::from_millis(1)),
            None
        );
    }

    #[test]
    fn boundary_a_search_one_millisecond_early_is_refused() {
        let start = Instant::now();
        let wait = throttle_decision(
            Some(start),
            start + SUBMIT_MIN_INTERVAL - Duration::from_millis(1),
        );

        assert_eq!(wait, Some(Duration::from_millis(1)));
    }

    #[test]
    fn an_immediate_second_search_waits_the_whole_interval() {
        let start = Instant::now();
        assert_eq!(throttle_decision(Some(start), start), Some(SUBMIT_MIN_INTERVAL));
    }

    #[test]
    fn a_clock_that_went_backwards_does_not_block_for_ever() {
        // `Instant` is monotonic, so this should be impossible - but
        // `saturating_duration_since` is what makes "impossible" not mean
        // "hangs the search button until the app restarts".
        let start = Instant::now();
        let later = start + Duration::from_secs(60);
        assert_eq!(throttle_decision(Some(later), start), Some(SUBMIT_MIN_INTERVAL));
    }

    #[test]
    fn the_gap_is_the_one_the_ui_depends_on() {
        assert_eq!(SUBMIT_MIN_INTERVAL, Duration::from_millis(1500));
    }

    #[test]
    fn the_timeouts_are_the_ones_each_board_needs() {
        assert_eq!(JobProvider::Adzuna.timeout(), Duration::from_secs(15));
        assert_eq!(JobProvider::Reed.timeout(), Duration::from_secs(10));
    }

    #[test]
    fn the_result_caps_are_the_ones_each_api_documents() {
        assert_eq!(JobProvider::Adzuna.result_cap(), ADZUNA_RESULT_CAP);
        assert_eq!(JobProvider::Reed.result_cap(), REED_RESULT_CAP);
        assert_eq!(ADZUNA_RESULT_CAP, 50);
        assert_eq!(REED_RESULT_CAP, 100);
    }

    #[test]
    fn error_kinds_match_the_typescript_union() {
        // These strings are members of `JobApiErrorKind` in
        // packages/job-apis/src/errors.ts. A typo here does not fail to compile
        // - it produces an error object the UI cannot classify, and the user
        // gets a generic message instead of the Settings screen.
        const ERRORS_TS: &str = include_str!("../../../../packages/job-apis/src/errors.ts");

        for kind in [
            "no-key",
            "network",
            "throttled",
            "bad-request",
            "bad-response",
        ] {
            assert!(
                ERRORS_TS.contains(&format!("| '{kind}'")),
                "{kind} is not a member of the TypeScript JobApiErrorKind union"
            );

            let rendered = transport_error(kind, "a message".to_string());
            let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
            assert_eq!(parsed["kind"], kind);
            assert_eq!(parsed["message"], "a message");
        }
    }

    #[test]
    fn the_frontend_calls_this_command_by_this_name() {
        const TRANSPORT_TS: &str = include_str!("../../src/jobs/transport.ts");
        assert!(
            TRANSPORT_TS.contains("'job_search'"),
            "src/jobs/transport.ts does not invoke job_search"
        );
        // The argument keys must be the Rust parameter names exactly. Both are
        // one word, so Tauri's snake_case-to-camelCase conversion cannot change
        // them.
        assert!(
            TRANSPORT_TS.contains("{ provider, params }"),
            "src/jobs/transport.ts no longer passes `provider` and `params`"
        );
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

    /// Everything before the test module - i.e. the code that actually ships.
    fn production_slice(source: &str) -> &str {
        match source.find("#[cfg(test)]") {
            Some(index) => &source[..index],
            None => source,
        }
    }

    #[test]
    fn the_production_slice_stops_at_the_test_module() {
        let whole = without_comments(include_str!("jobs.rs"));
        let production = production_slice(&whole);

        assert!(production.contains("pub(crate) async fn job_search"));
        assert!(!production.contains("mod tests"));
        assert!(
            production.len() > 1000,
            "the production slice is suspiciously small"
        );
    }

    #[test]
    fn there_is_no_generic_url_taking_command() {
        // The SSRF guard, as a test rather than a comment. Scanned up to
        // `#[cfg(test)]` only - see the same guard in providers.rs for why.
        let whole = without_comments(include_str!("jobs.rs"));
        let source = production_slice(&whole);

        for forbidden in ["url: String", "url: &str", "fn http_request", "base_url: "] {
            assert!(
                !source.contains(forbidden),
                "a command appears to take a URL from the caller: {forbidden}"
            );
        }
    }

    // ── Testing a key that has NOT been saved ────────────────────────────

    #[test]
    fn a_key_test_asks_for_exactly_one_result() {
        let probe = probe_params();

        // ONE. A key test that pulled a full page would spend twenty of Reed's
        // hundred daily requests to answer a yes/no question.
        assert_eq!(probe.limit, 1);
        assert_eq!(probe.distance_miles, None);
        assert_eq!(probe.salary_min, None);
        assert_eq!(probe.employment_type, None);

        // It has to be a search the boards will actually accept, or a failing
        // test would mean "our probe is malformed" rather than "your key is
        // wrong" - and the user would be told to re-check a perfectly good key.
        assert!(validate_params(&probe).is_ok());
    }

    #[test]
    fn the_probe_asks_each_board_for_one_result_in_that_board_s_own_words() {
        for (provider, name) in [
            (JobProvider::Adzuna, "results_per_page"),
            (JobProvider::Reed, "resultsToTake"),
        ] {
            let pairs = query_pairs(provider, &probe_params());
            assert_eq!(value_of(&pairs, name), Some("1"));
        }
    }

    #[test]
    fn candidate_credentials_come_back_in_the_order_the_request_builder_reads_them() {
        // Inserted app_key FIRST, on purpose. A HashMap has no order of its
        // own, and `job_search` reads the two Adzuna values out positionally -
        // so if this returned them the other way round the app id would be sent
        // as the app key and the user would be told their key was wrong.
        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::AdzunaAppKey, "the-key".to_string());
        supplied.insert(SecretKey::AdzunaAppId, "the-id".to_string());

        assert_eq!(
            candidate_credentials(JobProvider::Adzuna, &supplied).unwrap(),
            vec!["the-id".to_string(), "the-key".to_string()]
        );
    }

    #[test]
    fn half_an_adzuna_credential_is_refused_before_anything_is_sent() {
        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::AdzunaAppId, "the-id".to_string());

        let refused = candidate_credentials(JobProvider::Adzuna, &supplied).unwrap_err();
        let parsed: serde_json::Value = serde_json::from_str(&refused).unwrap();

        assert_eq!(parsed["kind"], "no-key");
        // Adzuna answers half a credential with a 401, which reads as "your key
        // is wrong" when the truth is "you only filled in one box".
        assert!(parsed["message"]
            .as_str()
            .unwrap()
            .contains("App ID and an App Key"));
    }

    #[test]
    fn a_blank_candidate_is_refused() {
        for blank in ["", "   ", "	
"] {
            let mut supplied = HashMap::new();
            supplied.insert(SecretKey::ReedApiKey, blank.to_string());
            assert!(
                candidate_credentials(JobProvider::Reed, &supplied).is_err(),
                "{blank:?} should be refused"
            );
        }
    }

    #[test]
    fn a_candidate_at_the_size_limit_is_accepted_and_one_byte_over_is_not() {
        // The same boundary `secret_set` enforces. Testing a key that could
        // never be saved would pass and then fail at the save, which is the one
        // outcome this whole flow exists to prevent.
        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::ReedApiKey, "k".repeat(MAX_CANDIDATE_BYTES));
        assert!(candidate_credentials(JobProvider::Reed, &supplied).is_ok());

        let mut oversized = HashMap::new();
        oversized.insert(SecretKey::ReedApiKey, "k".repeat(MAX_CANDIDATE_BYTES + 1));
        assert!(candidate_credentials(JobProvider::Reed, &oversized).is_err());
    }

    #[test]
    fn a_credential_for_another_board_is_ignored_rather_than_sent() {
        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::ReedApiKey, "reed-key".to_string());
        supplied.insert(SecretKey::AdzunaAppId, "adzuna-id".to_string());

        assert_eq!(
            candidate_credentials(JobProvider::Reed, &supplied).unwrap(),
            vec!["reed-key".to_string()]
        );
    }

    #[test]
    fn an_ai_credential_can_never_be_used_as_a_job_board_credential() {
        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::AnthropicApiKey, "sk-ant-nope".to_string());
        supplied.insert(SecretKey::OpenaiApiKey, "sk-nope".to_string());

        for provider in ALL {
            assert!(
                candidate_credentials(provider, &supplied).is_err(),
                "an AI key was accepted as a {provider:?} credential"
            );
        }
    }

    #[test]
    fn a_rejected_candidate_never_appears_in_the_message() {
        let secret = "sk-do-not-log-me";

        let mut supplied = HashMap::new();
        supplied.insert(SecretKey::AdzunaAppId, secret.to_string());
        let refused = candidate_credentials(JobProvider::Adzuna, &supplied).unwrap_err();
        assert!(!refused.contains(secret), "the message echoed the key back");

        let mut oversized = HashMap::new();
        oversized.insert(
            SecretKey::ReedApiKey,
            format!("{secret}{}", "x".repeat(MAX_CANDIDATE_BYTES)),
        );
        let too_long = candidate_credentials(JobProvider::Reed, &oversized).unwrap_err();
        assert!(!too_long.contains(secret), "the message echoed the key back");
    }

    #[test]
    fn testing_a_key_cannot_save_one() {
        // The structural half of "never persist an untested key". The command
        // that tests a candidate has no route to the credential store at all,
        // so the save can only happen afterwards, from the frontend, once the
        // test has come back green.
        let whole = without_comments(include_str!("jobs.rs"));
        let source = production_slice(&whole);

        for forbidden in ["secret_set", "set_password", "secret_delete"] {
            assert!(
                !source.contains(forbidden),
                "the job transport can write to the credential store: {forbidden}"
            );
        }
    }

    #[test]
    fn the_frontend_calls_the_key_test_by_this_name() {
        const PORT_TS: &str = include_str!("../../src/features/settings/keys/port.ts");
        assert!(
            PORT_TS.contains("'job_test_credentials'"),
            "the key wizard does not invoke job_test_credentials"
        );
        // The argument keys must be the Rust parameter names exactly. Both are
        // one word, so Tauri's snake_case-to-camelCase conversion cannot change
        // them - but a rename on either side would break silently otherwise.
        assert!(
            PORT_TS.contains("{ provider, supplied }"),
            "the key wizard no longer passes `provider` and `supplied`"
        );
    }

    #[test]
    fn the_key_test_command_is_registered_for_javascript() {
        let handler = without_comments(include_str!("lib.rs"));
        assert!(
            handler.contains("jobs::job_test_credentials,"),
            "job_test_credentials is not registered in generate_handler!"
        );
    }

    #[test]
    fn this_command_is_registered_for_javascript() {
        let handler = without_comments(include_str!("lib.rs"));
        assert!(
            handler.contains("jobs::job_search,"),
            "job_search is not registered in generate_handler!"
        );
    }
}
