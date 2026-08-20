//! Fetching ONE page, because the user pasted its address and pressed a button.
//!
//! ============================================================================
//! YES, THIS COMMAND TAKES A URL. READ THIS BEFORE CHANGING ANYTHING IN IT.
//! ============================================================================
//! `providers.rs` and `jobs.rs` both carry a test forbidding a caller-supplied
//! URL, and both are right to: a command that forwards an arbitrary address is
//! server-side request forgery with a friendly name. This app feeds
//! attacker-influenced job adverts into a model all day, and a compromised or
//! merely careless frontend that could name a destination would be able to use
//! the desktop app as a proxy to anything the user's machine can reach —
//! `http://127.0.0.1:11434` (a real Ollama daemon on the developer's own box),
//! a router's admin page, a cloud metadata endpoint at `169.254.169.254`.
//!
//! So the URL is not trusted here. It is a REQUEST to fetch, and every one of
//! the following has to pass before a socket is opened, and again on every
//! redirect hop:
//!
//!   1. the scheme is `http` or `https` and nothing else;
//!   2. the URL carries no username or password;
//!   3. the host is not `localhost`, not under `.localhost`, not under `.local`;
//!   4. every address the host resolves to is a public one — loopback, private,
//!      link-local, carrier-NAT, benchmarking, multicast and reserved space are
//!      all refused, in IPv4 and in IPv6, including an IPv4 address wearing an
//!      IPv6 costume;
//!   5. the connection is PINNED to the addresses that were just checked, so
//!      the name cannot resolve to something else between the check and the
//!      connect (DNS rebinding);
//!   6. a redirect may not leave the registrable domain it started on, and at
//!      most a few are followed;
//!   7. the reply is HTML or plain text, and is read with a hard byte cap
//!      applied WHILE STREAMING rather than after;
//!   8. the whole thing is over inside a fixed wall-clock budget.
//!
//! What the difference between this and a generic `http_request(url)` comes
//! down to: this command cannot be pointed at anything the user's browser could
//! not equally be pointed at, it carries nothing that identifies the user, and
//! it brings back bytes rather than performing an action.
//!
//! ============================================================================
//! IT CARRIES NO CREDENTIALS. NOT ANY. NOT EVER.
//! ============================================================================
//! No cookies (the client is built without a cookie store and the redirect
//! chain is walked by hand, so nothing can be carried across a hop), no
//! `Authorization` header, no API key, and no call into `secrets` — this module
//! never names `secret_get`, and `this_command_cannot_reach_the_credential_store`
//! is the test that keeps it that way.
//!
//! ============================================================================
//! ITS OWN CLIENT, NOT `providers::client()`
//! ============================================================================
//! The shared client follows redirects BY ITSELF, up to ten of them, inside
//! `send()`. Reusing it would mean hops two through ten were never inspected —
//! the exact hole rule 6 exists to close — and there would be no way to notice,
//! because the happy path looks identical. So this module builds its own client
//! per hop, with redirects OFF, pinned to the addresses it just vetted. It
//! still uses `providers::install_crypto_provider`, because without a rustls
//! crypto provider `build()` is an unconditional panic that takes the window
//! with it.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::{Duration, Instant};

use reqwest::Url;
use serde::Serialize;

use crate::providers;

/// The whole operation's wall-clock budget, redirects and body read included.
///
/// Not per hop. A page that takes four seconds to answer and then redirects
/// three times must not be able to hold the button in "Fetching…" for a minute.
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// How many redirects will be followed before we give up.
///
/// Real job adverts redirect once or twice — `http` to `https`, a bare domain
/// to `www`, a tracking path to a canonical one. Three is generous for that and
/// short enough that a redirect loop ends immediately rather than eating the
/// whole timeout.
const MAX_REDIRECTS: usize = 3;

/// The most page we will read, in bytes.
///
/// A heavy job advert is 200-600 KB of HTML. Five megabytes never catches a
/// real page and is small enough that a hostile endpoint streaming forever
/// cannot push this process into swap. Enforced chunk by chunk as the body
/// arrives — a cap applied after reading the body is not a cap.
const MAX_PAGE_BYTES: usize = 5 * 1024 * 1024;

/// What we call ourselves.
///
/// Deliberately boring and deliberately versionless: it is not a credential and
/// it does not identify the user or the build. Sending nothing at all is worse
/// in practice — a missing `User-Agent` is what a lot of sites bounce first —
/// and sending a browser's is a lie.
const USER_AGENT: &str = "CViperLight";

/// Content types we are willing to read as text.
///
/// A closed list. Anything else — a PDF, an image, a zip, JSON, an octet-stream
/// — is refused before its body is read, because there is nothing `htmlToText`
/// could do with it but produce mojibake that the model would then confidently
/// summarise.
const READABLE_CONTENT_TYPES: [&str; 3] = ["text/html", "application/xhtml+xml", "text/plain"];

/// Public-suffix pairs this app cares about.
///
/// ============================================================================
/// A SHORT TABLE, NOT A PUBLIC SUFFIX LIST, AND WHY THAT IS ACCEPTABLE HERE
/// ============================================================================
/// The real Public Suffix List is ~10,000 entries and a crate that ships and
/// updates it. This table is what decides whether a redirect stayed on the same
/// site, and getting it wrong in the DANGEROUS direction means treating
/// `co.uk` as registrable and letting `jobs.co.uk` redirect to `evil.co.uk`.
/// The UK, Australian and New Zealand pairs are exactly where a UK job-search
/// tool's adverts live, so they are the ones listed.
///
/// A pair we have missed fails the other way: `a.com.mt` would be allowed to
/// redirect to `b.com.mt`. That hop is still scheme-checked, still IP-checked,
/// still credential-free and still capped, so the residual is "a page from a
/// neighbour under an unlisted registry" rather than anything reaching a
/// private address. Stated here rather than discovered later.
const MULTI_LABEL_SUFFIXES: [&str; 31] = [
    "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "net.nz", "org.nz", "co.za",
    "co.jp", "or.jp", "ne.jp", "com.br", "com.sg", "com.hk", "com.tw", "com.mx", "com.tr",
    "co.in", "co.il", "co.kr", "co.id",
];

/// What JavaScript gets back when the page was actually read.
///
/// The same `{status, body}` envelope `providers.rs` and `jobs.rs` return, for
/// the same reason: a non-2xx is a completed request, not a transport failure,
/// and the status travels with the body so the caller classifies rather than
/// this module inventing prose.
///
/// `body` is the RAW HTML, capped. Turning it into readable text is TypeScript's
/// job (`features/tracker/htmlToText.ts`) — it is pure string work that belongs
/// where it can be unit-tested against fixtures, and it keeps this file to the
/// one thing it is dangerous at.
#[derive(Debug, Serialize)]
pub(crate) struct FetchOutcome {
    pub(crate) status: u16,
    pub(crate) body: String,
}

/// The `Err` payload: a JSON object, not a bare sentence.
///
/// Same shape and same reasoning as `providers::TransportError`. The UI shows
/// ONE guided message for every one of these — see the fallback rule in
/// `features/tracker/runFetch.ts` — so `kind` is here for the caller to
/// classify with, never for the user to read.
#[derive(Serialize)]
struct FetchError {
    kind: &'static str,
    message: String,
}

/// Why a fetch did not happen, or did not finish.
///
/// A hand-rolled enum rather than `reqwest::Error` so the message table is a
/// pure function that can be tested exhaustively without a socket — and so that
/// nothing derived from the request or the response can reach a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// Unparseable, wrong scheme, or carrying a username or password.
    BadUrl,
    /// The destination is one we will not connect to, or a hop left the site.
    Blocked,
    /// Too many redirects.
    TooManyHops,
    /// The budget ran out.
    Timeout,
    /// It never completed.
    Network,
    /// The reply was bigger than the cap.
    TooLarge,
    /// The reply was not HTML or plain text.
    Unsupported,
}

impl Refusal {
    /// Which `PageFetchErrorKind` this is, in the TypeScript union's spelling.
    fn kind(self) -> &'static str {
        match self {
            Refusal::BadUrl => "bad-url",
            Refusal::Blocked | Refusal::TooManyHops => "blocked",
            Refusal::Timeout | Refusal::Network => "network",
            Refusal::TooLarge => "too-large",
            Refusal::Unsupported => "unsupported",
        }
    }

    /// What this failure says.
    ///
    /// ========================================================================
    /// EVERY ARM IS A FIXED SENTENCE. NOTHING IS INTERPOLATED.
    /// ========================================================================
    /// Not the address, not the host, not the status code, not the content
    /// type, and above all not one byte of the response body — the page came
    /// from someone else and an error string is exactly the thing that ends up
    /// in a screenshot or a bug report. `no_refusal_message_leaks_anything`
    /// enforces it, down to refusing digits.
    ///
    /// The user never sees these anyway: the UI answers every failure with the
    /// same guided sentence. They exist so a developer reading a rejected
    /// promise in the console learns something, and the discipline is kept
    /// because "it is only for developers" is how detail leaks.
    fn message(self) -> &'static str {
        match self {
            Refusal::BadUrl => "That does not look like a web address the app can open.",
            Refusal::Blocked => "That address is not one this app will open.",
            Refusal::TooManyHops => "That link kept redirecting.",
            Refusal::Timeout => "That page took too long to answer.",
            Refusal::Network => "That page could not be reached.",
            Refusal::TooLarge => "That page is too big to read.",
            Refusal::Unsupported => "That link is not a web page the app can read.",
        }
    }

    fn to_json(self) -> String {
        serde_json::to_string(&FetchError {
            kind: self.kind(),
            message: self.message().to_string(),
        })
        .unwrap_or_else(|_| r#"{"kind":"network","message":"That page could not be reached."}"#.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// The guards. Every one of these is a pure function, tested without a socket.
// ─────────────────────────────────────────────────────────────────────────────

/// `http` and `https`. Nothing else, ever.
///
/// `file:` reads the user's disk. `data:` and `javascript:` are not fetches at
/// all. `ftp:`, `gopher:`, `ws:` are protocols this app has no business
/// speaking. An allow-list rather than a block-list, because a block-list is
/// wrong the moment somebody invents a scheme.
fn scheme_is_allowed(scheme: &str) -> bool {
    matches!(scheme, "http" | "https")
}

/// Does this URL carry a username or a password?
///
/// `https://admin:hunter2@intranet/` makes reqwest send Basic auth. This
/// command promises to send no credentials, so a URL that packs some is refused
/// rather than stripped: silently dropping half of what the user pasted and
/// fetching the rest is a surprise, and the pattern is a phishing shape anyway.
fn url_carries_credentials(url: &Url) -> bool {
    !url.username().is_empty() || url.password().is_some()
}

/// Names we refuse before any resolver is consulted.
///
/// `localhost` is the important one — `http://localhost:11434` is a live Ollama
/// on this developer's machine, and a mistyped or hostile address must not
/// reach it. RFC 6761 reserves the whole `localhost.` TLD, so subdomains go too.
/// `.local` is mDNS: a printer, a NAS, a router on the user's own network.
fn host_is_forbidden_by_name(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "local"
        || host.ends_with(".local")
}

/// Is this IPv4 address one we refuse to connect to?
fn ipv4_is_forbidden(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    match a {
        // 0.0.0.0/8 — "this network". On Linux 0.0.0.0 reaches localhost.
        0 => true,
        // 10.0.0.0/8 — private.
        10 => true,
        // 100.64.0.0/10 — carrier-grade NAT.
        100 => (64..=127).contains(&b),
        // 127.0.0.0/8 — loopback. The whole /8, not just 127.0.0.1.
        127 => true,
        // 169.254.0.0/16 — link-local, and 169.254.169.254 with it: the cloud
        // metadata endpoint that turns an SSRF into stolen instance credentials.
        169 => b == 254,
        // 172.16.0.0/12 — private. NOT the whole of 172.
        172 => (16..=31).contains(&b),
        // 192.168.0.0/16 — private.
        192 => b == 168,
        // 198.18.0.0/15 — benchmarking.
        198 => b == 18 || b == 19,
        // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast.
        224..=255 => true,
        _ => false,
    }
}

/// Is this IPv6 address one we refuse to connect to?
///
/// The first thing this does is unwrap IPv4. `::ffff:127.0.0.1` is loopback
/// wearing a costume, and an IPv6 guard that only knows about `::1` waves it
/// straight through — which is the bypass, not a curiosity.
fn ipv6_is_forbidden(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return true;
    }
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return ipv4_is_forbidden(mapped);
    }
    // The deprecated IPv4-COMPATIBLE form, `::a.b.c.d`. Still routable by some
    // stacks, so still checked.
    if let Some(compatible) = ip.to_ipv4() {
        return ipv4_is_forbidden(compatible);
    }
    let first = ip.segments()[0];
    // fc00::/7 unique-local, fe80::/10 link-local.
    (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
}

fn ip_is_forbidden(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_is_forbidden(v4),
        IpAddr::V6(v6) => ipv6_is_forbidden(v6),
    }
}

/// The registrable part of a host — `jobs.example.co.uk` becomes `example.co.uk`.
///
/// Only used to answer "did this redirect stay on the same site". See
/// `MULTI_LABEL_SUFFIXES` for what the table is and is not.
fn registrable_domain(host: &str) -> String {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() <= 2 {
        return host;
    }

    let last_two = labels[labels.len() - 2..].join(".");
    if MULTI_LABEL_SUFFIXES.contains(&last_two.as_str()) && labels.len() >= 3 {
        return labels[labels.len() - 3..].join(".");
    }
    last_two
}

/// Are these two hosts the same site?
///
/// An IP literal has no registrable domain — `93.184.216.34` and `9.9.216.34`
/// would both "end in `216.34`" — so an address is only ever the same site as
/// itself.
fn same_site(a: &str, b: &str) -> bool {
    let a = a.trim_end_matches('.').to_ascii_lowercase();
    let b = b.trim_end_matches('.').to_ascii_lowercase();
    if a.parse::<IpAddr>().is_ok() || b.parse::<IpAddr>().is_ok() {
        return a == b;
    }
    registrable_domain(&a) == registrable_domain(&b)
}

/// Is this a content type we can read as text?
///
/// An ABSENT header is not readable. We cannot know what the bytes are, and
/// guessing is how a `.docx` ends up in a prompt as line noise.
fn content_type_is_readable(value: Option<&str>) -> bool {
    let Some(value) = value else { return false };
    let essence = value
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    READABLE_CONTENT_TYPES.contains(&essence.as_str())
}

/// May another redirect be followed?
fn may_follow(redirects_so_far: usize) -> bool {
    redirects_so_far < MAX_REDIRECTS
}

/// Would adding this chunk take us past the cap?
fn would_exceed_cap(so_far: usize, incoming: usize) -> bool {
    so_far.saturating_add(incoming) > MAX_PAGE_BYTES
}

/// Is a declared `Content-Length` already past the cap?
///
/// Only a fast path. A server may lie or omit it, which is why the streaming
/// check exists and is the one that actually enforces the rule.
fn declared_length_is_too_large(length: Option<u64>) -> bool {
    match length {
        Some(length) => length > MAX_PAGE_BYTES as u64,
        None => false,
    }
}

/// Everything about a URL that can be decided without asking a resolver.
///
/// Called for the FIRST address and for EVERY redirect target, from the one
/// place — `prepare_destination` — so "the checks run on every hop" is a
/// property of the code rather than a promise in a comment.
fn vet_url(url: &Url) -> Result<(), Refusal> {
    if !scheme_is_allowed(url.scheme()) {
        return Err(Refusal::BadUrl);
    }
    if url_carries_credentials(url) {
        return Err(Refusal::BadUrl);
    }

    match url.host() {
        None => Err(Refusal::BadUrl),
        Some(url::Host::Ipv4(v4)) => {
            if ipv4_is_forbidden(v4) {
                Err(Refusal::Blocked)
            } else {
                Ok(())
            }
        }
        Some(url::Host::Ipv6(v6)) => {
            if ipv6_is_forbidden(v6) {
                Err(Refusal::Blocked)
            } else {
                Ok(())
            }
        }
        Some(url::Host::Domain(name)) => {
            if name.is_empty() || host_is_forbidden_by_name(name) {
                Err(Refusal::Blocked)
            } else {
                Ok(())
            }
        }
    }
}

/// Every address a name resolved to has to be one we would connect to.
///
/// EVERY one, not the first. A name that answers with a public address and a
/// loopback address is a name that will reach loopback on the next connection
/// attempt or on a different machine, and "it worked in testing" is precisely
/// how that ships.
fn vet_resolved(addresses: &[SocketAddr]) -> Result<(), Refusal> {
    if addresses.is_empty() {
        return Err(Refusal::Network);
    }
    if addresses.iter().any(|address| ip_is_forbidden(address.ip())) {
        return Err(Refusal::Blocked);
    }
    Ok(())
}

/// Where a redirect wants to go, vetted, or a refusal.
///
/// `origin` is the address the USER pasted, not the previous hop — otherwise a
/// chain could walk `a.com` → `b.com` → `c.com` one "same site" step at a time.
fn next_hop(origin: &Url, current: &Url, location: &str) -> Result<Url, Refusal> {
    let Ok(target) = current.join(location) else {
        return Err(Refusal::BadUrl);
    };

    let (Some(origin_host), Some(target_host)) = (origin.host_str(), target.host_str()) else {
        return Err(Refusal::BadUrl);
    };
    if !same_site(origin_host, target_host) {
        return Err(Refusal::Blocked);
    }

    vet_url(&target)?;
    Ok(target)
}

// ─────────────────────────────────────────────────────────────────────────────
// The part that opens a socket.
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve a host, off the async runtime's threads.
///
/// `to_socket_addrs` is a blocking call into the platform resolver and can sit
/// there for seconds. Running it inline would block a runtime worker for the
/// duration; `spawn_blocking` is what Tauri's own runtime is for.
async fn resolve_host(host: String, port: u16) -> Result<Vec<SocketAddr>, Refusal> {
    let joined = format!("{host}:{port}");
    match tauri::async_runtime::spawn_blocking(move || {
        joined
            .to_socket_addrs()
            .map(|addresses| addresses.collect::<Vec<_>>())
    })
    .await
    {
        Ok(Ok(addresses)) => Ok(addresses),
        // A name that will not resolve, or a resolver thread that fell over.
        // Neither is worth telling apart, and neither says anything more than
        // "that page could not be reached".
        _ => Err(Refusal::Network),
    }
}

/// The addresses this URL may be connected to, or a refusal. Never a socket.
async fn prepare_destination(url: &Url) -> Result<Vec<SocketAddr>, Refusal> {
    vet_url(url)?;

    let Some(host) = url.host() else {
        return Err(Refusal::BadUrl);
    };
    let port = url.port_or_known_default().unwrap_or(0);

    let addresses = match host {
        // A literal was already vetted by `vet_url`. No resolver involved.
        url::Host::Ipv4(v4) => vec![SocketAddr::new(IpAddr::V4(v4), port)],
        url::Host::Ipv6(v6) => vec![SocketAddr::new(IpAddr::V6(v6), port)],
        url::Host::Domain(name) => resolve_host(name.to_string(), port).await?,
    };

    vet_resolved(&addresses)?;
    Ok(addresses)
}

/// A client that will connect ONLY to the addresses we just approved.
///
/// `resolve_to_addrs` overrides DNS for this host on this client, which is what
/// closes the gap between "we checked the name" and "the connection went
/// somewhere" — a name whose answer changes in between (DNS rebinding) cannot
/// move the connection, because the connection is not going to ask again.
///
/// Redirects are OFF. They are walked by hand above so every hop is vetted.
fn pinned_client(host: &str, addresses: &[SocketAddr]) -> Result<reqwest::Client, Refusal> {
    // BEFORE `build()`, always: with `rustls-no-provider` and nothing installed,
    // building a client is an unconditional panic inside reqwest, and a panic in
    // a Tauri command takes the window with it. See providers.rs.
    providers::install_crypto_provider();

    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|_| Refusal::Network)
}

/// Read a body with the cap applied AS IT ARRIVES.
///
/// Not `response.text()`. That reads the whole body into memory first and then
/// hands it over, so a cap applied to its result is a cap that has already been
/// exceeded — which for a hostile endpoint streaming gigabytes is the whole
/// problem rather than a technicality.
async fn read_capped(mut response: reqwest::Response, deadline: Instant) -> Result<String, Refusal> {
    if declared_length_is_too_large(response.content_length()) {
        return Err(Refusal::TooLarge);
    }

    let mut bytes: Vec<u8> = Vec::new();
    loop {
        if Instant::now() >= deadline {
            return Err(Refusal::Timeout);
        }
        match response.chunk().await {
            Ok(Some(chunk)) => {
                if would_exceed_cap(bytes.len(), chunk.len()) {
                    return Err(Refusal::TooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(_) => return Err(Refusal::Network),
        }
    }

    // Lossy on purpose. A page in an encoding we cannot read is a page the user
    // will look at in the box and re-paste; a hard failure over a stray byte
    // would be worse.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// The whole walk: vet, connect, follow what we are allowed to follow, read.
async fn fetch(raw: &str) -> Result<FetchOutcome, Refusal> {
    let Ok(origin) = Url::parse(raw.trim()) else {
        return Err(Refusal::BadUrl);
    };

    let deadline = Instant::now() + FETCH_TIMEOUT;
    let mut current = origin.clone();
    let mut redirects = 0usize;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(Refusal::Timeout);
        }

        // Rules 1-5, for THIS hop. Nothing below runs until they pass.
        let addresses = prepare_destination(&current).await?;
        let Some(host) = current.host_str() else {
            return Err(Refusal::BadUrl);
        };

        let response = pinned_client(host, &addresses)?
            .get(current.clone())
            .timeout(remaining)
            .header("user-agent", USER_AGENT)
            .header("accept", "text/html,application/xhtml+xml,text/plain")
            .send()
            .await
            .map_err(|error| match providers::classify(&error) {
                providers::RequestFailure::Timeout => Refusal::Timeout,
                _ => Refusal::Network,
            })?;

        if response.status().is_redirection() {
            if !may_follow(redirects) {
                return Err(Refusal::TooManyHops);
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(|value| value.to_string());
            let Some(location) = location else {
                // A 3xx with nowhere to go. Not a page, not an error worth its
                // own kind.
                return Err(Refusal::Network);
            };

            current = next_hop(&origin, &current, &location)?;
            redirects += 1;
            continue;
        }

        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        if !content_type_is_readable(content_type.as_deref()) {
            return Err(Refusal::Unsupported);
        }

        let status = response.status().as_u16();
        let body = read_capped(response, deadline).await?;
        return Ok(FetchOutcome { status, body });
    }
}

/// Fetch the one page the user pasted, and bring back its HTML.
///
/// Everything about why this is safe is at the top of this file. The short
/// version: the address is vetted before every connection, the connection is
/// pinned to the vetted address, redirects cannot leave the site, nothing
/// identifying is sent, and the reply is capped while it streams.
#[tauri::command]
pub(crate) async fn fetch_job_page(url: String) -> Result<FetchOutcome, String> {
    fetch(&url).await.map_err(Refusal::to_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// No test here opens a socket. Everything below exercises the parts that
    /// decide WHETHER a request may happen and WHERE it may go — which is the
    /// whole security surface of this module.
    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("test URL should parse")
    }

    fn v4(raw: &str) -> SocketAddr {
        SocketAddr::new(raw.parse::<IpAddr>().expect("test IP should parse"), 80)
    }

    // ── Rule 1: the scheme allow-list ───────────────────────────────────────

    #[test]
    fn only_http_and_https_are_allowed_schemes() {
        assert!(scheme_is_allowed("http"));
        assert!(scheme_is_allowed("https"));
    }

    #[test]
    fn every_other_scheme_is_refused() {
        for scheme in [
            "file",
            "ftp",
            "data",
            "javascript",
            "gopher",
            "ws",
            "wss",
            "mailto",
            "about",
            "blob",
            "chrome",
            "tauri",
            "",
            "HTTPX",
        ] {
            assert!(!scheme_is_allowed(scheme), "{scheme} must not be allowed");
        }
    }

    #[test]
    fn a_url_in_a_refused_scheme_never_gets_past_vetting() {
        // The whole-URL form, because `vet_url` is what the fetch loop calls.
        for raw in [
            "file:///C:/Windows/win.ini",
            "file:///etc/passwd",
            "ftp://ftp.example.com/pub",
            "data:text/html,<h1>hello</h1>",
            "javascript:alert(1)",
            "ws://example.com/socket",
            "mailto:someone@example.com",
        ] {
            let parsed = url(raw);
            assert_eq!(
                vet_url(&parsed),
                Err(Refusal::BadUrl),
                "{raw} must be refused"
            );
        }
    }

    // ── Rule 2: no credentials in the address ───────────────────────────────

    #[test]
    fn a_url_carrying_a_username_or_password_is_refused() {
        for raw in [
            "http://admin@router.example.com/",
            "https://admin:hunter2@intranet.example.com/",
            "https://:onlyapassword@example.com/",
        ] {
            let parsed = url(raw);
            assert!(url_carries_credentials(&parsed), "{raw} carries credentials");
            assert_eq!(vet_url(&parsed), Err(Refusal::BadUrl), "{raw} must be refused");
        }
    }

    #[test]
    fn an_ordinary_url_carries_no_credentials() {
        assert!(!url_carries_credentials(&url("https://www.example.com/jobs/1")));
    }

    // ── Rule 3: names we refuse outright ────────────────────────────────────

    #[test]
    fn localhost_by_name_is_refused_in_every_spelling() {
        for host in [
            "localhost",
            "LOCALHOST",
            "localhost.",
            "api.localhost",
            "anything.LocalHost",
            "printer.local",
            "nas.local.",
            "local",
        ] {
            assert!(host_is_forbidden_by_name(host), "{host} must be refused");
        }
    }

    #[test]
    fn the_live_ollama_on_this_machine_cannot_be_reached_by_name() {
        // http://localhost:11434 is a real daemon on the developer's own box.
        // A mistyped or hostile address must not reach it.
        assert_eq!(
            vet_url(&url("http://localhost:11434/api/tags")),
            Err(Refusal::Blocked)
        );
    }

    #[test]
    fn an_ordinary_public_name_is_not_refused_by_name() {
        for host in [
            "example.com",
            "www.reed.co.uk",
            "localhosting.example.com",
            "notlocal.example.com",
            "mylocalhost.com",
        ] {
            assert!(!host_is_forbidden_by_name(host), "{host} should be allowed");
        }
    }

    // ── Rule 4: the address ranges, one test per range ──────────────────────

    #[test]
    fn loopback_is_refused() {
        for address in ["127.0.0.1", "127.0.0.53", "127.1.2.3", "127.255.255.254"] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn the_ten_dot_private_range_is_refused() {
        for address in ["10.0.0.1", "10.128.44.9", "10.255.255.255"] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn the_one_seven_two_private_range_is_refused_and_its_neighbours_are_not() {
        for address in ["172.16.0.1", "172.20.10.1", "172.31.255.254"] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
        // Boundary: 172.15 and 172.32 are ordinary public space and must NOT be
        // caught by a lazy `a == 172`.
        for address in ["172.15.255.254", "172.32.0.1"] {
            assert!(!ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn the_one_nine_two_private_range_is_refused_and_its_neighbours_are_not() {
        for address in ["192.168.0.1", "192.168.1.254", "192.168.255.255"] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
        for address in ["192.167.1.1", "192.169.1.1", "192.0.78.24"] {
            assert!(!ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn link_local_is_refused_including_the_cloud_metadata_address() {
        assert!(ip_is_forbidden("169.254.169.254".parse().unwrap()));
        assert!(ip_is_forbidden("169.254.0.1".parse().unwrap()));
        assert!(ip_is_forbidden("169.254.255.255".parse().unwrap()));
        // Boundary: 169.253 and 169.255 are public.
        assert!(!ip_is_forbidden("169.253.0.1".parse().unwrap()));
        assert!(!ip_is_forbidden("169.255.0.1".parse().unwrap()));
    }

    #[test]
    fn the_zero_network_is_refused() {
        for address in ["0.0.0.0", "0.1.2.3", "0.255.255.255"] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn carrier_nat_benchmarking_multicast_and_broadcast_are_refused() {
        for address in [
            "100.64.0.1",
            "100.127.255.254",
            "198.18.0.1",
            "198.19.255.254",
            "224.0.0.1",
            "239.255.255.250",
            "240.0.0.1",
            "255.255.255.255",
        ] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
        // Boundary either side of 100.64/10.
        assert!(!ip_is_forbidden("100.63.255.254".parse().unwrap()));
        assert!(!ip_is_forbidden("100.128.0.1".parse().unwrap()));
    }

    #[test]
    fn ipv6_loopback_unique_local_and_link_local_are_refused() {
        for address in [
            "::1",
            "::",
            "fc00::1",
            "fd12:3456:789a::1",
            "fe80::1",
            "febf::1",
            "ff02::1",
        ] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn an_ipv4_address_wearing_an_ipv6_costume_is_still_that_address() {
        // The classic bypass: an IPv6 guard that only knows `::1` waves
        // ::ffff:127.0.0.1 straight through to loopback.
        for address in [
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "::ffff:10.0.0.1",
            "::ffff:192.168.1.1",
            "::127.0.0.1",
        ] {
            assert!(ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
        // …and a mapped PUBLIC address is still allowed, so the rule is
        // unwrapping rather than blanket-refusing.
        assert!(!ip_is_forbidden("::ffff:93.184.216.34".parse().unwrap()));
    }

    #[test]
    fn ordinary_public_addresses_are_allowed() {
        for address in [
            "93.184.216.34",
            "8.8.8.8",
            "1.1.1.1",
            "2606:4700:4700::1111",
            "2a00:1450:4009:81f::200e",
        ] {
            assert!(!ip_is_forbidden(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn a_private_address_typed_straight_into_the_box_is_refused() {
        for raw in [
            "http://127.0.0.1:11434/api/tags",
            "http://127.0.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/admin",
            "http://192.168.1.1/",
            "http://172.16.4.5/",
            "http://[::1]:11434/api/tags",
            "http://[::ffff:127.0.0.1]/",
            "http://0.0.0.0:8080/",
        ] {
            assert_eq!(vet_url(&url(raw)), Err(Refusal::Blocked), "{raw}");
        }
    }

    #[test]
    fn a_name_that_resolves_to_a_private_address_is_refused() {
        // The DNS half of rule 4: the name looked fine, the answer did not.
        assert_eq!(
            vet_resolved(&[v4("127.0.0.1")]),
            Err(Refusal::Blocked),
            "a name resolving to loopback must be refused"
        );
        assert_eq!(
            vet_resolved(&[v4("169.254.169.254")]),
            Err(Refusal::Blocked)
        );
    }

    #[test]
    fn every_resolved_address_is_checked_not_merely_the_first() {
        // A name answering with one public address and one private address is
        // the shape that survives a "check addresses[0]" guard, and reaches
        // loopback on the next connection or on somebody else's machine.
        assert_eq!(
            vet_resolved(&[v4("93.184.216.34"), v4("127.0.0.1")]),
            Err(Refusal::Blocked)
        );
        assert_eq!(
            vet_resolved(&[v4("93.184.216.34"), v4("8.8.8.8")]),
            Ok(())
        );
    }

    #[test]
    fn a_name_that_resolves_to_nothing_is_a_network_failure_not_a_block() {
        assert_eq!(vet_resolved(&[]), Err(Refusal::Network));
    }

    // ── Rule 6: redirects ───────────────────────────────────────────────────

    #[test]
    fn a_redirect_that_stays_on_the_site_is_followed() {
        let origin = url("https://jobs.example.com/advert/1");
        for location in [
            "https://jobs.example.com/advert/1?utm=x",
            "/advert/1/canonical",
            "https://www.example.com/advert/1",
            "https://example.com/advert/1",
        ] {
            assert!(
                next_hop(&origin, &origin, location).is_ok(),
                "{location} should be followed"
            );
        }
    }

    #[test]
    fn a_redirect_off_the_site_is_refused() {
        let origin = url("https://jobs.example.com/advert/1");
        for location in [
            "https://evil.example.net/",
            "https://example.com.evil.test/",
            "https://notexample.com/",
            "https://example.org/",
        ] {
            assert_eq!(
                next_hop(&origin, &origin, location),
                Err(Refusal::Blocked),
                "{location} should be refused"
            );
        }
    }

    #[test]
    fn a_public_host_redirecting_to_a_private_one_is_refused() {
        // THE classic bypass: the address the user pasted is fine, and the site
        // answers with a 302 to loopback or to cloud metadata. This is why the
        // hops are walked by hand instead of by reqwest.
        let origin = url("https://jobs.example.com/advert/1");
        for location in [
            "http://127.0.0.1:11434/api/tags",
            "http://localhost:11434/api/tags",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/",
            "http://[::1]/",
            "file:///etc/passwd",
        ] {
            assert!(
                next_hop(&origin, &origin, location).is_err(),
                "{location} must not be followed"
            );
        }
    }

    #[test]
    fn a_redirect_chain_cannot_walk_off_the_site_one_step_at_a_time() {
        // Each hop is compared with the address the USER pasted, not with the
        // previous hop — otherwise a.com → b.com → c.com is three "same site"
        // steps and one completely different destination.
        let origin = url("https://jobs.example.com/advert/1");
        let second = url("https://www.example.com/advert/1");
        assert_eq!(
            next_hop(&origin, &second, "https://elsewhere.test/"),
            Err(Refusal::Blocked)
        );
    }

    #[test]
    fn boundary_three_redirects_are_followed_and_a_fourth_is_not() {
        assert!(may_follow(0));
        assert!(may_follow(1));
        assert!(may_follow(2));
        assert!(!may_follow(3));
        assert!(!may_follow(4));
        assert_eq!(MAX_REDIRECTS, 3);
    }

    #[test]
    fn the_registrable_domain_knows_about_two_part_suffixes() {
        assert_eq!(registrable_domain("www.reed.co.uk"), "reed.co.uk");
        assert_eq!(registrable_domain("reed.co.uk"), "reed.co.uk");
        assert_eq!(registrable_domain("jobs.seek.com.au"), "seek.com.au");
        assert_eq!(registrable_domain("a.b.c.example.com"), "example.com");
        assert_eq!(registrable_domain("example.com"), "example.com");
        assert_eq!(registrable_domain("EXAMPLE.COM."), "example.com");
    }

    #[test]
    fn two_sites_under_the_same_two_part_suffix_are_not_the_same_site() {
        // The reason the suffix table exists: without it, `co.uk` looks
        // registrable and every UK site is "the same site" as every other.
        assert!(!same_site("jobs.co.uk", "evil.co.uk"));
        assert!(!same_site("reed.co.uk", "totaljobs.co.uk"));
        assert!(same_site("www.reed.co.uk", "jobs.reed.co.uk"));
    }

    #[test]
    fn an_address_is_only_ever_the_same_site_as_itself() {
        assert!(same_site("93.184.216.34", "93.184.216.34"));
        // Both "end in 216.34". Neither has a registrable domain.
        assert!(!same_site("93.184.216.34", "9.9.216.34"));
        assert!(!same_site("93.184.216.34", "example.com"));
    }

    // ── Rule 7: content type and the size cap ───────────────────────────────

    #[test]
    fn html_and_plain_text_are_readable() {
        for value in [
            "text/html",
            "text/html; charset=utf-8",
            "TEXT/HTML;charset=ISO-8859-1",
            "  text/plain  ",
            "application/xhtml+xml",
        ] {
            assert!(content_type_is_readable(Some(value)), "{value}");
        }
    }

    #[test]
    fn anything_that_is_not_html_or_text_is_refused() {
        for value in [
            "application/pdf",
            "application/json",
            "application/octet-stream",
            "image/png",
            "application/zip",
            "text/csv",
            "video/mp4",
            "",
        ] {
            assert!(!content_type_is_readable(Some(value)), "{value}");
        }
    }

    #[test]
    fn a_reply_with_no_content_type_at_all_is_refused() {
        // We cannot know what the bytes are, and guessing is how a .docx ends
        // up in a prompt as line noise.
        assert!(!content_type_is_readable(None));
    }

    #[test]
    fn boundary_a_body_at_the_cap_is_read_and_one_byte_past_it_is_not() {
        assert!(!would_exceed_cap(0, MAX_PAGE_BYTES));
        assert!(!would_exceed_cap(MAX_PAGE_BYTES - 1, 1));
        assert!(would_exceed_cap(MAX_PAGE_BYTES, 1));
        assert!(would_exceed_cap(MAX_PAGE_BYTES - 1, 2));
    }

    #[test]
    fn an_oversize_body_is_refused_chunk_by_chunk_not_after_the_fact() {
        // A hostile endpoint streaming for ever never gets to finish: the cap
        // is asked about every chunk, so the refusal happens at five megabytes
        // rather than at whatever it decided to send.
        let chunk = 64 * 1024;
        let mut so_far = 0usize;
        let mut chunks = 0usize;
        while !would_exceed_cap(so_far, chunk) {
            so_far += chunk;
            chunks += 1;
            assert!(chunks < 10_000, "the cap never fired");
        }
        assert!(so_far <= MAX_PAGE_BYTES);
        assert!(so_far + chunk > MAX_PAGE_BYTES);
    }

    #[test]
    fn a_declared_length_past_the_cap_is_refused_before_the_body_is_read() {
        assert!(declared_length_is_too_large(Some(MAX_PAGE_BYTES as u64 + 1)));
        assert!(declared_length_is_too_large(Some(50 * 1024 * 1024)));
        // Boundary, and the honest absence.
        assert!(!declared_length_is_too_large(Some(MAX_PAGE_BYTES as u64)));
        assert!(!declared_length_is_too_large(None));
    }

    #[test]
    fn the_caps_and_budgets_are_the_ones_the_ui_depends_on() {
        assert_eq!(FETCH_TIMEOUT, Duration::from_secs(15));
        assert_eq!(MAX_PAGE_BYTES, 5 * 1024 * 1024);
    }

    // ── What a refusal is allowed to say ────────────────────────────────────

    const ALL_REFUSALS: [Refusal; 7] = [
        Refusal::BadUrl,
        Refusal::Blocked,
        Refusal::TooManyHops,
        Refusal::Timeout,
        Refusal::Network,
        Refusal::TooLarge,
        Refusal::Unsupported,
    ];

    #[test]
    fn no_refusal_message_leaks_anything() {
        for refusal in ALL_REFUSALS {
            let message = refusal.message();
            assert!(!message.is_empty());
            for forbidden in [
                "http", "://", "127.0", "localhost", "169.254", "example", "html", "Content",
                "sk-", "Bearer",
            ] {
                assert!(
                    !message.contains(forbidden),
                    "a refusal message leaked {forbidden:?}: {message}"
                );
            }
            // A status code, a port or a byte count would arrive as digits.
            assert!(
                !message.chars().any(|character| character.is_ascii_digit()),
                "a refusal message contains a number: {message}"
            );
        }
    }

    #[test]
    fn error_kinds_match_the_typescript_union() {
        // These strings are the `PageFetchErrorKind` union in
        // src/features/tracker/pageFetch.ts. A typo here does not fail to
        // compile — it produces an error object the UI cannot classify.
        for refusal in ALL_REFUSALS {
            let rendered = refusal.to_json();
            let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
            let kind = parsed["kind"].as_str().unwrap();
            assert!(
                ["bad-url", "blocked", "network", "too-large", "unsupported"].contains(&kind),
                "{kind} is not a PageFetchErrorKind"
            );
            assert!(!parsed["message"].as_str().unwrap().is_empty());
        }
    }

    #[test]
    fn the_outcome_travels_as_the_status_and_body_envelope() {
        let rendered = serde_json::to_string(&FetchOutcome {
            status: 200,
            body: "<html></html>".to_string(),
        })
        .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&rendered).unwrap();
        assert_eq!(parsed["status"], 200);
        assert_eq!(parsed["body"], "<html></html>");
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
        let whole = without_comments(include_str!("fetch_page.rs"));
        let production = production_slice(&whole);

        assert!(production.contains("pub(crate) async fn fetch_job_page"));
        assert!(production.contains("fn vet_url"));
        assert!(!production.contains("mod tests"));
        assert!(
            production.len() > 1000,
            "the production slice is suspiciously small"
        );
    }

    #[test]
    fn this_command_cannot_reach_the_credential_store() {
        // The structural half of "it sends no credentials". A page fetch has no
        // route to a saved key at all, so no future edit can attach one to a
        // request without deleting this test first.
        let whole = without_comments(include_str!("fetch_page.rs"));
        let source = production_slice(&whole);

        for forbidden in [
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
        ] {
            assert!(
                !source.contains(forbidden),
                "the page fetch can reach a credential: {forbidden}"
            );
        }
    }

    #[test]
    fn the_fetch_loop_vets_every_hop_with_its_own_client() {
        // Two things that would silently undo rule 6, both invisible in a
        // passing happy path:
        //   * reusing providers::client(), which follows redirects itself;
        //   * building a client whose redirect policy is anything but `none`.
        let whole = without_comments(include_str!("fetch_page.rs"));
        let source = production_slice(&whole);

        assert!(
            !source.contains("providers::client"),
            "the shared client follows redirects by itself, so every hop after \
             the first would go unchecked"
        );
        assert!(
            source.contains("redirect::Policy::none()"),
            "redirects must be off so they can be walked and vetted by hand"
        );
        assert!(
            source.contains("resolve_to_addrs"),
            "the connection must be pinned to the addresses that were vetted"
        );
        // `prepare_destination` is inside the loop, so it runs for the first
        // address and for every redirect target.
        assert!(
            source.contains("prepare_destination(&current).await?"),
            "every hop must go through the same vetting function"
        );
    }

    #[test]
    fn the_command_is_registered_for_javascript() {
        // A `#[tauri::command]` that is not in `generate_handler!` is invisible
        // to the frontend and fails at runtime with "command not found" — there
        // is no compile error for it.
        let handler = without_comments(include_str!("lib.rs"));
        assert!(
            handler.contains("fetch_job_page"),
            "fetch_job_page is not registered in generate_handler!"
        );
    }

    #[test]
    fn the_frontend_calls_this_command_by_this_name() {
        const TRANSPORT_TS: &str = include_str!("../../src/features/tracker/pageFetch.ts");
        assert!(
            TRANSPORT_TS.contains("'fetch_job_page'"),
            "src/features/tracker/pageFetch.ts does not invoke fetch_job_page"
        );
        // The argument key must be the Rust parameter name exactly. It is one
        // word, so Tauri's snake_case-to-camelCase conversion cannot change it.
        assert!(
            TRANSPORT_TS.contains("{ url }"),
            "src/features/tracker/pageFetch.ts no longer passes `url`"
        );
    }
}
