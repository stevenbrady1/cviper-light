//! Fetching a whole public job feed, with no credential of any kind (L-110).
//!
//! ============================================================================
//! THIS MODULE HAS NO ROUTE TO THE CREDENTIAL STORE, AND THAT IS STRUCTURAL
//! ============================================================================
//! Neither feed takes a key. There is nothing to send, nothing to forget to
//! send, and nothing here that could send one by accident: this file cannot so
//! much as NAME `secrets`, `keyring`, an authorization header or an API-key
//! header, and `this_command_cannot_reach_the_credential_store` reads its own
//! source and fails the build if it ever does. Same guard, same reason, as the
//! one in `fetch_page.rs`.
//!
//! That matters more than it looks. The failure it prevents is not "a key is
//! stolen" — it is a future edit adding "and while we are here, send the Adzuna
//! key too" to a request going somewhere Adzuna has nothing to do with.
//!
//! ============================================================================
//! RUST OWNS BOTH ADDRESSES. JAVASCRIPT NAMES A FEED AND A PAGE NUMBER.
//! ============================================================================
//! Same rule as `jobs.rs` and `providers.rs`: the frontend passes a value from
//! a two-member enum and a small integer, and the URL is a `&'static str` in
//! this file. A command that forwarded an arbitrary address would be
//! server-side request forgery with a friendly name — see the long note at the
//! top of `fetch_page.rs`, which takes a URL and is the one place that does.
//!
//! The page number is CLAMPED, not validated: it is the one number JavaScript
//! supplies, and clamping it to 1..=`MAX_PAGES` means the worst a compromised
//! frontend can do is ask for a page we were willing to fetch anyway.
//!
//! ============================================================================
//! THE BYTES COME BACK RAW. THE PAGE PARSES THEM.
//! ============================================================================
//! Guardian Jobs is RSS. Parsing XML here would mean an XML crate in the part
//! of the app that holds the credentials, to do a job the WebView's own
//! `DOMParser` already does — so this returns the body and
//! `packages/job-apis/src/keyless/` reads it. The same split `fetch_page.rs`
//! uses for HTML.
//!
//! ============================================================================
//! "PLEASE DO NOT ABUSE" IS IN ARBEITNOW'S OWN TERMS, SO THE GAP IS ENFORCED
//! ============================================================================
//! A browse costs three requests: two pages of Arbeitnow and Guardian's one.
//! The minimum gap between fetches is enforced here rather than in the UI,
//! because a disabled button is a suggestion and the transport is the only
//! place that can actually refuse. The slot is per SOURCE AND PAGE: one browse
//! legitimately asks for page 1 and page 2 back to back, and a single gate
//! would refuse the second half of every browse.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::providers::{self, RequestFailure};

/// Which public feed. A CLOSED SET, for the same reason `JobProvider` is one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeylessSource {
    Arbeitnow,
    Guardian,
}

/// The most pages of one feed this command will ever fetch.
///
/// Two, and the frontend agrees (`KEYLESS_PAGES` in
/// `packages/job-apis/src/keyless/types.ts`). Clamped here as well because the
/// frontend is the part an injected script gets to influence.
const MAX_PAGES: u32 = 2;

/// The largest reply that will be read, in bytes.
///
/// One live Arbeitnow page is 2.1 MB, so this has real headroom above the
/// biggest thing either feed legitimately sends, and is a hard stop well short
/// of a hostile endpoint streaming until the machine runs out of memory.
const MAX_FEED_BYTES: usize = 8 * 1024 * 1024;

const FEED_TIMEOUT: Duration = Duration::from_secs(20);

/// The minimum gap between two fetches of the SAME feed and page.
const SUBMIT_MIN_INTERVAL: Duration = Duration::from_millis(1500);

/// What these requests call themselves. No version, no machine, no user.
const USER_AGENT: &str = "CViperLight";

impl KeylessSource {
    /// Scheme, host AND path. NEVER built from anything JavaScript sent.
    ///
    /// Arbeitnow publishes its whole board here, 250 adverts a page, ordered
    /// newest first. Guardian's `jobsrss` is the same twenty items whatever is
    /// asked of it — there is no query form of either address to build.
    fn base_url(self) -> &'static str {
        match self {
            KeylessSource::Arbeitnow => "https://www.arbeitnow.com/api/job-board-api",
            KeylessSource::Guardian => "https://jobs.theguardian.com/jobsrss/",
        }
    }

    /// Does this feed paginate? Guardian publishes one page and ignores `page`.
    fn paginates(self) -> bool {
        matches!(self, KeylessSource::Arbeitnow)
    }

    /// What this feed sends, so a maintenance page is not read as data.
    fn accept(self) -> &'static str {
        match self {
            KeylessSource::Arbeitnow => "application/json",
            KeylessSource::Guardian => "application/rss+xml, application/xml, text/xml",
        }
    }

    /// How this feed is named in a sentence shown to a person.
    fn label(self) -> &'static str {
        match self {
            KeylessSource::Arbeitnow => "Arbeitnow",
            KeylessSource::Guardian => "Guardian Jobs",
        }
    }

    /// This feed's per-page timestamps.
    fn last_fetch(self) -> &'static Mutex<[Option<Instant>; MAX_PAGES as usize]> {
        match self {
            KeylessSource::Arbeitnow => &ARBEITNOW_LAST_FETCH,
            KeylessSource::Guardian => &GUARDIAN_LAST_FETCH,
        }
    }
}

/// The page number, clamped into the range this command is willing to fetch.
///
/// CLAMPED RATHER THAN REFUSED, and the zero case is the one that matters:
/// Arbeitnow answers `?page=0` with an empty page, and an empty page is
/// reported to the user as a feed that has stopped working. A frontend bug
/// would therefore surface as "Arbeitnow is broken", which is a false statement
/// about somebody else's service.
fn clamp_page(page: u32) -> u32 {
    page.clamp(1, MAX_PAGES)
}

/// Which slot in `last_fetch` this page uses. Always in range.
fn slot_index(page: u32) -> usize {
    (clamp_page(page) - 1) as usize
}

/// The query string for one fetch, as name/value pairs.
///
/// ============================================================================
/// ONE PARAMETER, WHOSE NAME IS A `&'static str` AND WHOSE VALUE IS A NUMBER
/// ============================================================================
/// There is nothing else to send. Neither feed accepts a keyword or a location
/// — that is the entire reason this feature filters on the user's machine — so
/// nothing the user typed reaches this function at all. It cannot: no parameter
/// of `keyless_fetch` carries text.
fn query_pairs(source: KeylessSource, page: u32) -> Vec<(&'static str, String)> {
    if source.paginates() {
        vec![("page", clamp_page(page).to_string())]
    } else {
        Vec::new()
    }
}

/// How long to wait before this feed and page may be fetched again, or `None`.
///
/// A pure function of the two instants, so the boundary can be tested exactly
/// rather than by sleeping and hoping. Written out here rather than shared with
/// `jobs.rs`: six lines of arithmetic are not worth this module importing the
/// one that reads the credential store, and the two policies are independent —
/// Reed's is a hundred requests a day, this one is Arbeitnow's "please do not
/// abuse".
///
/// `saturating_duration_since` matters: `Instant` is monotonic so `now` should
/// never be before `last`, but if it ever were, a plain subtraction would panic
/// and an unsaturated one would produce a nonsense gap that disabled browsing
/// until the app restarted.
fn throttle_decision(last: Option<Instant>, now: Instant) -> Option<Duration> {
    let previous = last?;
    let elapsed = now.saturating_duration_since(previous);
    if elapsed >= SUBMIT_MIN_INTERVAL {
        None
    } else {
        Some(SUBMIT_MIN_INTERVAL - elapsed)
    }
}

/// Take one page's slot, or report how long is left.
///
/// PER SOURCE AND PAGE. One browse asks for page 1 and page 2 within a few
/// hundred milliseconds of each other, which is correct and must not be
/// refused; two browses of the SAME page in the same second is the thing being
/// prevented.
fn claim(
    slots: &mut [Option<Instant>; MAX_PAGES as usize],
    page: u32,
    now: Instant,
) -> Option<Duration> {
    let index = slot_index(page);
    match throttle_decision(slots[index], now) {
        Some(wait) => Some(wait),
        None => {
            slots[index] = Some(now);
            None
        }
    }
}

/// The same, against this feed's real slots, under its lock.
fn claim_slot(source: KeylessSource, page: u32, now: Instant) -> Option<Duration> {
    let mut slots = match source.last_fetch().lock() {
        Ok(guard) => guard,
        // A poisoned lock means some other thread panicked while holding it.
        // There is no invariant to restore inside an array of instants, and
        // refusing every future browse over it would be worse.
        Err(poisoned) => poisoned.into_inner(),
    };

    claim(&mut slots, page, now)
}

/// The `Err` payload of this command: a JSON object, not a bare sentence.
///
/// Same reasoning as `jobs::transport_error` — the UI needs to know WHICH
/// failure it was, and matching on English prose breaks the first time somebody
/// improves the wording. `kind` values are members of `KeylessErrorKind` in
/// packages/job-apis/src/keyless/errors.ts, which
/// `error_kinds_match_the_typescript_union` enforces by reading that file.
fn transport_error(kind: &'static str, message: String) -> String {
    serde_json::to_string(&TransportError { kind, message }).unwrap_or_else(|_| {
        r#"{"kind":"network","message":"The job feed could not be read."}"#.to_string()
    })
}

#[derive(Serialize)]
struct TransportError {
    kind: &'static str,
    message: String,
}

/// What JavaScript gets back for a request that actually reached the server.
///
/// A NON-2xx IS `Ok`, NOT `Err` — same envelope, same reason, as `jobs.rs`. A
/// 404 completed perfectly, and it is the single most likely way one of these
/// feeds dies. The page turns it into a message naming the feed.
#[derive(Serialize)]
struct HttpEnvelope {
    status: u16,
    body: String,
}

/// Turn a transport failure into something safe to show a user.
///
/// EVERY ARM IS A FIXED SENTENCE, and nothing is interpolated except the feed's
/// own name. `reqwest::Error`'s `Display` includes the request URL, and an
/// error string is exactly the thing that ends up in a screenshot or a bug
/// report.
fn describe_request_failure(source: KeylessSource, failure: RequestFailure) -> String {
    let feed = source.label();

    match failure {
        RequestFailure::Connect => {
            format!("Could not reach {feed}. Check your internet connection and try again.")
        }
        RequestFailure::Timeout => format!("{feed} did not answer in time. Try again in a moment."),
        RequestFailure::Body => format!("The list of jobs from {feed} could not be read."),
        RequestFailure::Decode => format!("The reply from {feed} could not be read. Try again."),
        RequestFailure::Other => format!("The request to {feed} failed before it was sent."),
    }
}

/// Would this chunk take the body past the cap? Saturating, so it cannot wrap.
fn would_exceed_cap(so_far: usize, incoming: usize) -> bool {
    so_far.saturating_add(incoming) > MAX_FEED_BYTES
}

/// Is the length the server declared already too large to accept?
fn declared_length_is_too_large(length: Option<u64>) -> bool {
    matches!(length, Some(declared) if declared > MAX_FEED_BYTES as u64)
}

/// Read the body IN CHUNKS, against a cap.
///
/// Not `response.text()`. That reads the whole body into memory first and then
/// hands it over, so a cap applied to its result is a cap that has already been
/// exceeded — which for an endpoint streaming without end is the whole problem
/// rather than a technicality. Same shape as `read_capped` in `fetch_page.rs`.
async fn read_capped(
    source: KeylessSource,
    mut response: reqwest::Response,
) -> Result<String, String> {
    let too_large = || {
        transport_error(
            "bad-response",
            format!(
                "{} sent far more data than a page of jobs, so it was not read.",
                source.label()
            ),
        )
    };

    if declared_length_is_too_large(response.content_length()) {
        return Err(too_large());
    }

    let mut bytes: Vec<u8> = Vec::new();
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if would_exceed_cap(bytes.len(), chunk.len()) {
                    return Err(too_large());
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(error) => {
                let failure = providers::classify(&error);
                return Err(transport_error(
                    "network",
                    describe_request_failure(source, failure),
                ));
            }
        }
    }

    // Lossy on purpose. A feed with one bad byte in one advert is still a page
    // of jobs, and a hard failure over it would be reported to the user as a
    // dead feed — which would be false.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// One page of one public job feed. No credential, and no way to reach one.
///
/// The whole account of why this is safe is at the top of this file. The short
/// version: two fixed addresses, one clamped page number, no key, nothing the
/// user typed, a minimum gap between requests, and a hard cap on the reply.
#[tauri::command]
pub(crate) async fn keyless_fetch(source: KeylessSource, page: u32) -> Result<String, String> {
    let page = clamp_page(page);

    if let Some(wait) = claim_slot(source, page, Instant::now()) {
        // Rounded up to whole seconds so the message is never "wait 0 seconds".
        let seconds = wait.as_millis().div_ceil(1000).max(1);
        return Err(transport_error(
            "throttled",
            format!(
                "That was very quick after the last one. Wait about {seconds} second(s) and try \
                 again — these job feeds are free, and one of them asks in its own terms not to \
                 be hammered."
            ),
        ));
    }

    let response = providers::client()?
        .get(source.base_url())
        .timeout(FEED_TIMEOUT)
        .header("user-agent", USER_AGENT)
        .header("accept", source.accept())
        .query(&query_pairs(source, page))
        .send()
        .await
        .map_err(|error| {
            let failure = providers::classify(&error);
            transport_error("network", describe_request_failure(source, failure))
        })?;

    let status = response.status().as_u16();
    let body = read_capped(source, response).await?;

    serde_json::to_string(&HttpEnvelope { status, body }).map_err(|_| {
        transport_error(
            "bad-response",
            format!("The reply from {} could not be read.", source.label()),
        )
    })
}

static ARBEITNOW_LAST_FETCH: Mutex<[Option<Instant>; MAX_PAGES as usize]> =
    Mutex::new([None; MAX_PAGES as usize]);
static GUARDIAN_LAST_FETCH: Mutex<[Option<Instant>; MAX_PAGES as usize]> =
    Mutex::new([None; MAX_PAGES as usize]);

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [KeylessSource; 2] = [KeylessSource::Arbeitnow, KeylessSource::Guardian];

    // ── The addresses ───────────────────────────────────────────────────────

    #[test]
    fn every_feed_has_a_fixed_https_address() {
        for source in ALL {
            let url = source.base_url();
            assert!(url.starts_with("https://"), "{url} is not https");
            // Nothing that looks like interpolation. The whole safety property
            // is that these are constants.
            assert!(!url.contains('{'), "{url} looks like a template");
        }
    }

    #[test]
    fn the_two_feeds_are_not_the_same_address() {
        assert_ne!(
            KeylessSource::Arbeitnow.base_url(),
            KeylessSource::Guardian.base_url()
        );
    }

    #[test]
    fn each_feed_asks_for_the_kind_of_reply_it_actually_sends() {
        assert!(KeylessSource::Arbeitnow.accept().contains("json"));
        assert!(KeylessSource::Guardian.accept().contains("xml"));
    }

    // ── The one number JavaScript supplies ──────────────────────────────────

    #[test]
    fn a_page_number_is_clamped_rather_than_trusted() {
        assert_eq!(clamp_page(1), 1);
        assert_eq!(clamp_page(2), 2);
    }

    #[test]
    fn boundary_a_page_below_the_first_becomes_the_first() {
        // A zero or a negative arriving as a huge u32 must not become
        // `?page=0`, which Arbeitnow answers with an empty page — and an empty
        // page is reported to the user as a dead feed.
        assert_eq!(clamp_page(0), 1);
    }

    #[test]
    fn boundary_a_page_beyond_the_last_becomes_the_last() {
        assert_eq!(clamp_page(3), MAX_PAGES);
        assert_eq!(clamp_page(9_999), MAX_PAGES);
        assert_eq!(clamp_page(u32::MAX), MAX_PAGES);
    }

    #[test]
    fn only_the_feed_that_paginates_is_sent_a_page() {
        let arbeitnow = query_pairs(KeylessSource::Arbeitnow, 2);
        assert_eq!(arbeitnow, vec![("page", "2".to_string())]);

        // Guardian ignores every parameter it is given — measured, not assumed
        // — so sending one would be noise on somebody else's server.
        assert!(query_pairs(KeylessSource::Guardian, 2).is_empty());
    }

    #[test]
    fn the_query_carries_nothing_but_the_page() {
        // Not the user's keywords, not their location. These feeds cannot
        // filter, and sending a query would imply to the next reader that they
        // can.
        for source in ALL {
            for (name, _) in query_pairs(source, 1) {
                assert_eq!(name, "page", "an unexpected parameter is being sent");
            }
        }
    }

    // ── The gap between requests ────────────────────────────────────────────

    #[test]
    fn a_first_fetch_is_never_throttled() {
        assert_eq!(throttle_decision(None, Instant::now()), None);
    }

    #[test]
    fn boundary_a_fetch_exactly_on_the_interval_is_allowed() {
        let then = Instant::now();
        assert_eq!(throttle_decision(Some(then), then + SUBMIT_MIN_INTERVAL), None);
    }

    #[test]
    fn boundary_a_fetch_one_millisecond_early_is_refused() {
        let then = Instant::now();
        let wait = throttle_decision(
            Some(then),
            then + SUBMIT_MIN_INTERVAL - Duration::from_millis(1),
        );
        assert_eq!(wait, Some(Duration::from_millis(1)));
    }

    #[test]
    fn one_browse_may_ask_for_page_two_immediately_after_page_one() {
        // The reason the slot is per PAGE and not per feed. A browse fetches
        // page 1 and page 2 a few hundred milliseconds apart; a single gate per
        // feed would refuse the second half of every browse, and the user would
        // silently get half the adverts.
        let mut slots: [Option<Instant>; MAX_PAGES as usize] = [None; MAX_PAGES as usize];
        let now = Instant::now();

        assert_eq!(claim(&mut slots, 1, now), None);
        assert_eq!(claim(&mut slots, 2, now + Duration::from_millis(200)), None);
    }

    #[test]
    fn the_same_page_twice_in_a_moment_is_refused() {
        let mut slots: [Option<Instant>; MAX_PAGES as usize] = [None; MAX_PAGES as usize];
        let now = Instant::now();

        assert_eq!(claim(&mut slots, 1, now), None);
        assert!(claim(&mut slots, 1, now + Duration::from_millis(200)).is_some());
        // And is allowed again once the gap has passed.
        assert_eq!(claim(&mut slots, 1, now + SUBMIT_MIN_INTERVAL), None);
    }

    #[test]
    fn boundary_an_out_of_range_page_cannot_index_past_the_slots() {
        // `slot_index` clamps, so a frontend bug is a repeated fetch of the
        // last page rather than a panic that takes the window with it.
        let mut slots: [Option<Instant>; MAX_PAGES as usize] = [None; MAX_PAGES as usize];
        let now = Instant::now();

        assert_eq!(slot_index(0), 0);
        assert_eq!(slot_index(u32::MAX), (MAX_PAGES - 1) as usize);
        assert_eq!(claim(&mut slots, u32::MAX, now), None);
        assert!(claim(&mut slots, MAX_PAGES, now).is_some());
    }

    #[test]
    fn a_clock_that_went_backwards_does_not_lock_the_feed_out() {
        // `Instant` is monotonic, so this should not happen; an unsaturated
        // subtraction would panic, and a wrapped one would refuse every fetch
        // until the app restarted.
        let then = Instant::now();
        assert!(throttle_decision(Some(then + Duration::from_secs(60)), then).is_some());
    }

    // ── Structural guards ───────────────────────────────────────────────────

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
        // Without this, the scans below could silently become scans of an empty
        // string and pass no matter what ships.
        let whole = without_comments(include_str!("keyless.rs"));
        let production = production_slice(&whole);

        assert!(production.contains("pub(crate) async fn keyless_fetch"));
        assert!(production.contains("fn clamp_page"));
        assert!(!production.contains("mod tests"));
        assert!(
            production.len() > 1000,
            "the production slice is suspiciously small"
        );
    }

    #[test]
    fn this_command_cannot_reach_the_credential_store() {
        // The structural half of "these feeds take no credential". There is no
        // key to send, so there must be no route to one — and no future edit
        // can attach one to a request without deleting this test first.
        let whole = without_comments(include_str!("keyless.rs"));
        let source = production_slice(&whole);

        for forbidden in [
            "secrets",
            "secret_get",
            "secret_set",
            "SecretKey",
            "get_password",
            "keyring",
            "auth_headers",
            "authorization",
            "basic_auth",
            "bearer_auth",
            "x-api-key",
            "api_key",
        ] {
            assert!(
                !source.contains(forbidden),
                "the keyless feed transport can reach a credential: {forbidden}"
            );
        }
    }

    #[test]
    fn there_is_no_generic_url_taking_command() {
        let whole = without_comments(include_str!("keyless.rs"));
        let source = production_slice(&whole);

        for forbidden in ["url: String", "url: &str", "fn http_request", "base_url: "] {
            assert!(
                !source.contains(forbidden),
                "a command appears to take a URL from the caller: {forbidden}"
            );
        }
    }

    #[test]
    fn the_reply_is_capped_while_it_streams() {
        // `response.text()` reads the whole body into memory and hands it over,
        // so a cap applied afterwards is a cap that has already been exceeded.
        // Same reasoning as `read_capped` in fetch_page.rs.
        let whole = without_comments(include_str!("keyless.rs"));
        let source = production_slice(&whole);

        assert!(
            !source.contains(".text().await"),
            "the body must be read in chunks against a cap, not all at once"
        );
        assert!(source.contains("MAX_FEED_BYTES"));
    }

    #[test]
    fn error_kinds_match_the_typescript_union() {
        // These strings are members of `KeylessErrorKind` in
        // packages/job-apis/src/keyless/errors.ts. A typo here does not fail to
        // compile — it produces an error object the UI cannot classify, and the
        // user gets a generic message instead of one naming the feed.
        const ERRORS_TS: &str =
            include_str!("../../../../packages/job-apis/src/keyless/errors.ts");

        for kind in ["network", "bad-response", "throttled"] {
            assert!(
                ERRORS_TS.contains(&format!("| '{kind}'")),
                "{kind} is not a member of the TypeScript KeylessErrorKind union"
            );

            let rendered = transport_error(kind, "a message".to_string());
            let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
            assert_eq!(parsed["kind"], kind);
            assert_eq!(parsed["message"], "a message");
        }
    }

    #[test]
    fn the_outcome_travels_as_the_status_and_body_envelope() {
        let rendered = serde_json::to_string(&HttpEnvelope {
            status: 200,
            body: "{\"data\":[]}".to_string(),
        })
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(parsed["status"], 200);
        assert_eq!(parsed["body"], "{\"data\":[]}");
    }

    #[test]
    fn the_command_is_registered_for_javascript() {
        // A `#[tauri::command]` that is not in `generate_handler!` is invisible
        // to the frontend and fails at runtime with "command not found" — there
        // is no compile error for it.
        let handler = without_comments(include_str!("lib.rs"));
        assert!(
            handler.contains("keyless::keyless_fetch,"),
            "keyless_fetch is not registered in generate_handler!"
        );
    }

    #[test]
    fn the_frontend_calls_this_command_by_this_name() {
        const TRANSPORT_TS: &str = include_str!("../../src/jobs/keylessTransport.ts");
        assert!(
            TRANSPORT_TS.contains("'keyless_fetch'"),
            "src/jobs/keylessTransport.ts does not invoke keyless_fetch"
        );
        // The argument keys must be the Rust parameter names exactly. Both are
        // one word, so Tauri's snake_case-to-camelCase conversion cannot change
        // them — but a rename on either side would break silently otherwise.
        assert!(
            TRANSPORT_TS.contains("{ source, page }"),
            "src/jobs/keylessTransport.ts no longer passes `source` and `page`"
        );
    }

    #[test]
    fn the_frontend_and_this_file_agree_on_how_many_pages() {
        const TYPES_TS: &str = include_str!("../../../../packages/job-apis/src/keyless/types.ts");
        // The frontend decides how many pages to ask for; this clamps what it
        // asks. If the frontend asked for more than this allows, the extra
        // pages would silently be fetches of the last page over and over.
        assert!(
            TYPES_TS.contains(&format!("arbeitnow: {MAX_PAGES}")),
            "KEYLESS_PAGES.arbeitnow does not match MAX_PAGES ({MAX_PAGES})"
        );
    }

    #[test]
    fn the_source_names_match_the_typescript_union() {
        const TYPES_TS: &str = include_str!("../../../../packages/job-apis/src/keyless/types.ts");
        // `#[serde(rename_all = "snake_case")]` turns the enum into these two
        // strings on the wire.
        for name in ["arbeitnow", "guardian"] {
            assert!(
                TYPES_TS.contains(&format!("'{name}'")),
                "{name} is not a member of the TypeScript KeylessSourceId union"
            );
        }
        assert_eq!(
            serde_json::to_string(&KeylessSource::Arbeitnow).unwrap(),
            "\"arbeitnow\""
        );
        assert_eq!(
            serde_json::to_string(&KeylessSource::Guardian).unwrap(),
            "\"guardian\""
        );
    }
}
