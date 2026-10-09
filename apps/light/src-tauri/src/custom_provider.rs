//! One AI service at an address the user typed (L-150).
//!
//! ============================================================================
//! YES, THIS TAKES AN ADDRESS FROM JAVASCRIPT. READ THIS BEFORE CHANGING IT.
//! ============================================================================
//! `providers.rs` pins every provider's host to a `&'static str`, and its
//! module comment explains why a command that forwards an arbitrary address is
//! server-side request forgery with a friendly name. That rule still holds
//! THERE. This module is the one deliberate exception, for the many services
//! that speak OpenAI's chat-completions dialect at an address only the user
//! knows — LM Studio and llama.cpp on their own computer, a company gateway, a
//! hosted service CViper has never heard of.
//!
//! So the address is not trusted. Every one of these holds before a socket is
//! opened, on EVERY call — testing, saving, listing models and chatting:
//!
//!   1. the scheme is `https`, or `http` only when the user ticked "this runs
//!      on my own computer or network";
//!   2. the address carries no user name, password, query or fragment;
//!   3. every address the host resolves to is checked: without the tick every
//!      one must be public, WITH the tick every one must be the user's own
//!      (loopback, private, carrier-NAT, unique-local) — a ticked box never
//!      turns a public address into a plain-http one;
//!   4. link-local (and with it the cloud metadata endpoint at
//!      `169.254.169.254`), "this network", multicast, benchmarking and
//!      reserved space are refused whatever the box says;
//!   5. the connection is PINNED to the addresses that were just checked, so
//!      a name cannot resolve to something else between the check and the
//!      connect (DNS rebinding);
//!   6. redirects are never followed — a 3xx comes back as a status like any
//!      other, so a reply cannot walk the request somewhere unchecked;
//!   7. the reply is read with a byte cap applied WHILE STREAMING.
//!
//! ============================================================================
//! THE KEY IS BOUND TO ITS ADDRESS
//! ============================================================================
//! The address and the key are saved TOGETHER, as one credential-store entry
//! (`SecretKey::CustomProvider`), and only `custom_provider_save` writes it —
//! `secrets::secret_set` refuses that entry. So the saved key can only ever be
//! sent to the address it was saved with. A compromised frontend that wanted
//! to point the key somewhere else would have to supply a key to do it, which
//! means it would not be the user's key.
//!
//! Saving re-runs the test first, inside the same command, so an address and
//! key that do not work together cannot be saved — the test-before-save rule
//! `providers::provider_test_key` keeps, with no window between the two.
//!
//! The key never comes back out: `custom_provider_status` returns the address,
//! the tick and a bool, and nothing else. Every message here is a fixed
//! sentence — no host, no digit, not one byte of a reply.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::fetch_page;
use crate::providers::{self, KeyTestOutcome};
use crate::secrets::{self, SecretKey};

/// The longest address we accept, in bytes, after parsing.
///
/// Measured AFTER parsing, because a non-ASCII host is rewritten to its
/// punycode form and grows. It and `MAX_KEY_BYTES` share one credential-store
/// entry, which has to fit `secrets::MAX_SECRET_BYTES`;
/// `the_largest_bundle_fits_one_credential` holds the sum.
const MAX_ADDRESS_BYTES: usize = 300;

/// The longest key we accept, in bytes. Every real key is under 200.
const MAX_KEY_BYTES: usize = 600;

/// The same budgets as the fixed providers, for the same reasons: a local
/// model loading into memory can take half a minute before its first token.
const CHAT_TIMEOUT: Duration = Duration::from_secs(180);
const MODELS_TIMEOUT: Duration = Duration::from_secs(30);

/// The most reply we will read, in bytes. A chat reply is a few kilobytes and a
/// model list rarely more than a few hundred; this only stops a hostile or
/// broken service streaming forever.
const MAX_REPLY_BYTES: usize = 8 * 1024 * 1024;

/// Where an address sits, as far as this module is concerned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reach {
    /// On the internet.
    Public,
    /// On the user's own computer or network.
    Own,
    /// Nowhere CViper will connect to, whatever the box says.
    Never,
}

/// Why an address cannot be used. Each has one fixed sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AddressProblem {
    Empty,
    NotAnAddress,
    TooLong,
    CarriesExtras,
    NeedsHttps,
    OwnNetworkNeedsTick,
    NotOwnNetwork,
    Refused,
    NotFound,
}

/// Why a key cannot be used. Each has one fixed sentence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyProblem {
    Missing,
    TooLong,
    Unusable,
}

/// Where an IPv4 address sits. The user's own ranges are named here; what is
/// left is public unless `fetch_page` would refuse it, which makes it `Never`.
fn reach_v4(ip: Ipv4Addr) -> Reach {
    let [a, b, _, _] = ip.octets();
    let own = a == 127
        || a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        // Carrier-grade NAT, which is also where Tailscale puts a user's own
        // devices.
        || (a == 100 && (64..=127).contains(&b));
    if own {
        Reach::Own
    } else if fetch_page::ip_is_forbidden(IpAddr::V4(ip)) {
        Reach::Never
    } else {
        Reach::Public
    }
}

/// Where an address sits. An IPv4 address wearing an IPv6 costume is judged
/// as the IPv4 address it is.
fn reach(ip: IpAddr) -> Reach {
    match ip {
        IpAddr::V4(v4) => reach_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return reach_v4(mapped);
            }
            // `::1`, and fc00::/7 unique-local.
            if v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 {
                return Reach::Own;
            }
            if fetch_page::ip_is_forbidden(ip) {
                Reach::Never
            } else {
                Reach::Public
            }
        }
    }
}

/// Everything about a typed address that can be decided without a resolver.
///
/// Returns the address tidied — trimmed, trailing slash dropped — which is the
/// form that is saved and joined to `models` and `chat/completions`.
fn parse_address(raw: &str, own_network: bool) -> Result<Url, AddressProblem> {
    let typed = raw.trim();
    if typed.is_empty() {
        return Err(AddressProblem::Empty);
    }
    if typed.len() > MAX_ADDRESS_BYTES {
        return Err(AddressProblem::TooLong);
    }

    let mut url = Url::parse(typed).map_err(|_| AddressProblem::NotAnAddress)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AddressProblem::NotAnAddress);
    }
    // Refused rather than stripped: a user name makes reqwest send Basic auth,
    // and silently dropping half of what was typed is a surprise.
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AddressProblem::CarriesExtras);
    }

    // A literal, or a name that can only mean this machine or its network, is
    // judged now. Any other name is judged by what it resolves to.
    let known = match url.host() {
        None => return Err(AddressProblem::NotAnAddress),
        Some(url::Host::Ipv4(v4)) => Some(reach(IpAddr::V4(v4))),
        Some(url::Host::Ipv6(v6)) => Some(reach(IpAddr::V6(v6))),
        Some(url::Host::Domain(name)) => {
            fetch_page::host_is_forbidden_by_name(name).then_some(Reach::Own)
        }
    };
    match (known, own_network) {
        (Some(Reach::Never), _) => return Err(AddressProblem::Refused),
        (Some(Reach::Own), false) => return Err(AddressProblem::OwnNetworkNeedsTick),
        (Some(Reach::Public), true) => return Err(AddressProblem::NotOwnNetwork),
        _ => {}
    }
    // The tick is what allows plain http, and only for the user's own
    // addresses — which the resolver check holds it to.
    if !own_network && url.scheme() != "https" {
        return Err(AddressProblem::NeedsHttps);
    }

    let tidy = url.path().trim_end_matches('/').to_string();
    url.set_path(&tidy);
    // Again AFTER parsing: a non-ASCII host grows into punycode.
    if url.as_str().len() > MAX_ADDRESS_BYTES {
        return Err(AddressProblem::TooLong);
    }
    Ok(url)
}

/// EVERY address the name resolved to has to match the box — not the first.
/// A name answering with a public address and a private one reaches the
/// private one on the next attempt.
fn check_resolved(addresses: &[SocketAddr], own_network: bool) -> Result<(), AddressProblem> {
    if addresses.is_empty() {
        return Err(AddressProblem::NotFound);
    }
    let reaches: Vec<Reach> = addresses
        .iter()
        .map(|address| reach(address.ip()))
        .collect();
    if reaches.contains(&Reach::Never) {
        return Err(AddressProblem::Refused);
    }
    if own_network && reaches.contains(&Reach::Public) {
        return Err(AddressProblem::NotOwnNetwork);
    }
    if !own_network && reaches.contains(&Reach::Own) {
        return Err(AddressProblem::OwnNetworkNeedsTick);
    }
    Ok(())
}

/// The key as it will be sent, `None` for a service that needs none.
///
/// Trimmed, because a pasted key often carries a newline. Visible ASCII only,
/// because a key goes in a header — and that also keeps the saved bundle the
/// size `the_largest_bundle_fits_one_credential` measured, since JSON escapes
/// nothing in that range but `"` and `\`.
fn checked_key(raw: &str, own_network: bool) -> Result<Option<String>, KeyProblem> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return if own_network {
            Ok(None)
        } else {
            Err(KeyProblem::Missing)
        };
    }
    if trimmed.len() > MAX_KEY_BYTES {
        return Err(KeyProblem::TooLong);
    }
    if !trimmed.bytes().all(|byte| (0x21..=0x7e).contains(&byte)) {
        return Err(KeyProblem::Unusable);
    }
    Ok(Some(trimmed.to_string()))
}

/// What to tell the user about an address. Fixed sentences: the address the
/// user typed is never repeated, so nothing here can carry a host.
fn address_message(problem: AddressProblem) -> &'static str {
    match problem {
        AddressProblem::Empty => "Type the service's address before testing it.",
        AddressProblem::NotAnAddress => {
            "That does not look like a web address. Type it as the service's documentation \
             gives it, starting with https://."
        }
        AddressProblem::TooLong => "That address is too long. Check it was pasted correctly.",
        AddressProblem::CarriesExtras => {
            "Type the address without a user name, a password, or anything after a ? or a #. \
             The key goes in its own box."
        }
        AddressProblem::NeedsHttps => {
            "An address on the internet must start with https://, so your key is never sent \
             unprotected. If the service runs on your own computer or network, tick the box."
        }
        AddressProblem::OwnNetworkNeedsTick => {
            "That address is on your own computer or network. Tick the box to allow it."
        }
        AddressProblem::NotOwnNetwork => {
            "That address is on the internet, not your own computer or network. Untick the box \
             to use it."
        }
        AddressProblem::Refused => "CViper will not connect to that address.",
        AddressProblem::NotFound => {
            "CViper could not find that address. Check it is typed correctly."
        }
    }
}

/// Which `ProviderErrorKind` each address problem maps to.
fn address_kind(problem: AddressProblem) -> &'static str {
    match problem {
        AddressProblem::NotFound => "network",
        _ => "bad-request",
    }
}

fn address_error(problem: AddressProblem) -> String {
    providers::transport_error(address_kind(problem), address_message(problem).to_string())
}

/// What to tell the user about a key. NOTHING is interpolated: the value IS
/// the secret.
fn key_message(problem: KeyProblem) -> &'static str {
    match problem {
        KeyProblem::Missing => {
            "Paste your API key before testing it. Only a service on your own computer or \
             network can be used without one."
        }
        KeyProblem::TooLong => "That key is too long to save. Check it was pasted correctly.",
        KeyProblem::Unusable => {
            "That key contains spaces or characters a key cannot have. Check it was pasted \
             correctly."
        }
    }
}

fn key_error(problem: KeyProblem) -> String {
    let kind = match problem {
        KeyProblem::Missing => "no-key",
        KeyProblem::TooLong | KeyProblem::Unusable => "bad-request",
    };
    providers::transport_error(kind, key_message(problem).to_string())
}

/// What a finished test says, for each outcome. The fixed providers' table
/// names the provider; this one has no name to give, so it says "that service".
fn test_message(outcome: KeyTestOutcome) -> &'static str {
    match outcome {
        KeyTestOutcome::Refused => {
            "That service did not accept the key. Check it was pasted whole — a brand new key \
             can take a few minutes to become active."
        }
        KeyTestOutcome::Unreachable => {
            "CViper could not reach that address. Check it is typed correctly and the service \
             is running."
        }
        KeyTestOutcome::RateLimited => {
            "That service is rate-limiting this key. Wait a moment and test it again."
        }
        KeyTestOutcome::ProviderFault => {
            "That service is having trouble at its end. Try again shortly."
        }
        KeyTestOutcome::Rejected => {
            "That address did not answer like an OpenAI-compatible service. Check it is the base \
             address the service's documentation gives, which usually ends in a version such as \
             v-one."
        }
    }
}

/// What a request that never completed says. Same rule: fixed sentences.
fn failure_message(failure: providers::RequestFailure) -> &'static str {
    match failure {
        providers::RequestFailure::Connect => {
            "Could not reach the AI service at the saved address. Check it is running and try \
             again."
        }
        providers::RequestFailure::Timeout => {
            "The AI service did not answer in time. Try again — a model on your own computer \
             may still be loading."
        }
        providers::RequestFailure::Body => "The request could not be sent. Try again.",
        providers::RequestFailure::Decode => "The AI service's reply could not be read. Try again.",
        providers::RequestFailure::Other => "The request failed before it reached the AI service.",
    }
}

fn failure_error(error: &reqwest::Error) -> String {
    providers::transport_error(
        "network",
        failure_message(providers::classify(error)).to_string(),
    )
}

const TOO_LARGE: &str = "The AI service's reply was too large to read.";
const NOTHING_SAVED: &str = "No AI service address is saved. Add one in Settings before using it.";
const UNREADABLE_SAVE: &str =
    "The saved AI service could not be read. Remove it in Settings and add it again.";

/// `{base}/{suffix}`. Safe as plain joining because a vetted base has no query
/// and no fragment, and its trailing slash was dropped when it was parsed.
fn endpoint(base: &Url, suffix: &str) -> String {
    format!("{}/{suffix}", base.as_str().trim_end_matches('/'))
}

/// Resolve the host, off the async runtime's threads. A literal needs no
/// resolver.
async fn resolve(url: &Url) -> Result<Vec<SocketAddr>, AddressProblem> {
    let port = url.port_or_known_default().unwrap_or(0);
    match url.host() {
        Some(url::Host::Ipv4(v4)) => Ok(vec![SocketAddr::new(IpAddr::V4(v4), port)]),
        Some(url::Host::Ipv6(v6)) => Ok(vec![SocketAddr::new(IpAddr::V6(v6), port)]),
        Some(url::Host::Domain(name)) => {
            let joined = format!("{name}:{port}");
            match tauri::async_runtime::spawn_blocking(move || {
                joined
                    .to_socket_addrs()
                    .map(|addresses| addresses.collect::<Vec<_>>())
            })
            .await
            {
                Ok(Ok(addresses)) => Ok(addresses),
                _ => Err(AddressProblem::NotFound),
            }
        }
        None => Err(AddressProblem::NotAnAddress),
    }
}

/// A client that connects ONLY to the addresses just approved, and never
/// follows a redirect.
///
/// With the tick, no system proxy either: a request meant for the user's own
/// machine or network must go straight there, not out to a proxy that would
/// resolve the name again on its own terms and undo the pin.
fn pinned_client(
    url: &Url,
    addresses: &[SocketAddr],
    own_network: bool,
) -> Result<reqwest::Client, String> {
    // BEFORE `build()`, always: see `providers::install_crypto_provider`.
    providers::install_crypto_provider();

    let mut builder = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none());
    if own_network {
        builder = builder.no_proxy();
    }
    if let Some(url::Host::Domain(name)) = url.host() {
        builder = builder.resolve_to_addrs(name, addresses);
    }
    builder.build().map_err(|_| {
        providers::transport_error(
            "network",
            "Secure networking is unavailable in this build.".to_string(),
        )
    })
}

/// The ONE way to a usable destination: parse, resolve, check every address,
/// pin. Every command below goes through it, every time.
async fn prepare(address: &str, own_network: bool) -> Result<(Url, reqwest::Client), String> {
    let url = parse_address(address, own_network).map_err(address_error)?;
    let addresses = resolve(&url).await.map_err(address_error)?;
    check_resolved(&addresses, own_network).map_err(address_error)?;
    let client = pinned_client(&url, &addresses, own_network)?;
    Ok((url, client))
}

fn with_key(request: reqwest::RequestBuilder, key: Option<String>) -> reqwest::RequestBuilder {
    match key {
        Some(key) => request.header("authorization", format!("Bearer {key}")),
        None => request,
    }
}

/// One cheap request that proves the address and the key work together. The
/// model list: unbilled on every service that has one, and the body is never
/// read — the status answers the only question asked.
async fn probe(client: &reqwest::Client, base: &Url, key: Option<String>) -> Result<(), String> {
    let request = with_key(
        client.get(endpoint(base, "models")).timeout(MODELS_TIMEOUT),
        key,
    );
    let response = request.send().await.map_err(|_| {
        providers::transport_error(
            providers::key_test_kind(KeyTestOutcome::Unreachable),
            test_message(KeyTestOutcome::Unreachable).to_string(),
        )
    })?;
    match providers::key_test_outcome(response.status().as_u16()) {
        None => Ok(()),
        Some(outcome) => Err(providers::transport_error(
            providers::key_test_kind(outcome),
            test_message(outcome).to_string(),
        )),
    }
}

/// What is saved: the address, the tick and the key, as ONE entry.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Saved {
    address: String,
    own_network: bool,
    /// Empty when the service needs no key.
    key: String,
}

fn bundle(base: &Url, own_network: bool, key: Option<String>) -> Result<String, String> {
    serde_json::to_string(&Saved {
        address: base.as_str().to_string(),
        own_network,
        key: key.unwrap_or_default(),
    })
    .map_err(|_| providers::transport_error("bad-request", UNREADABLE_SAVE.to_string()))
}

fn read_bundle(stored: &str) -> Option<Saved> {
    serde_json::from_str(stored).ok()
}

/// The saved service, or `None` when nothing is saved.
fn load_saved() -> Result<Option<Saved>, String> {
    match secrets::secret_get(SecretKey::CustomProvider) {
        Ok(stored) => read_bundle(&stored)
            .map(Some)
            .ok_or_else(|| providers::transport_error("no-key", UNREADABLE_SAVE.to_string())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(providers::transport_error(
            "no-key",
            secrets::describe(&error),
        )),
    }
}

fn load() -> Result<Saved, String> {
    load_saved()?.ok_or_else(|| providers::transport_error("no-key", NOTHING_SAVED.to_string()))
}

fn saved_key(saved: &Saved) -> Option<String> {
    if saved.key.is_empty() {
        None
    } else {
        Some(saved.key.clone())
    }
}

/// Read a reply with the cap applied AS IT ARRIVES, then wrap it the way the
/// fixed providers do: a non-2xx is `Ok`, with its status, for the adapter to
/// classify.
async fn send(request: reqwest::RequestBuilder) -> Result<String, String> {
    let mut response = request
        .send()
        .await
        .map_err(|error| failure_error(&error))?;
    let status = response.status().as_u16();

    if response
        .content_length()
        .is_some_and(|length| length > MAX_REPLY_BYTES as u64)
    {
        return Err(providers::transport_error(
            "bad-response",
            TOO_LARGE.to_string(),
        ));
    }
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| failure_error(&error))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_REPLY_BYTES {
            return Err(providers::transport_error(
                "bad-response",
                TOO_LARGE.to_string(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    serde_json::to_string(&providers::HttpEnvelope {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
    .map_err(|_| {
        providers::transport_error(
            "bad-response",
            "The AI service's reply could not be read.".to_string(),
        )
    })
}

/// Does this address and key work together? A real request, nothing saved.
///
/// THIS COMMAND CANNOT SAVE ANYTHING. `testing_cannot_save` reads its body.
#[tauri::command]
pub(crate) async fn custom_provider_test(
    address: String,
    own_network: bool,
    key: String,
) -> Result<(), String> {
    let key = checked_key(&key, own_network).map_err(key_error)?;
    let (base, client) = prepare(&address, own_network).await?;
    probe(&client, &base, key).await
}

/// Test, and only if the test passes, save the address and key together.
#[tauri::command]
pub(crate) async fn custom_provider_save(
    address: String,
    own_network: bool,
    key: String,
) -> Result<(), String> {
    let key = checked_key(&key, own_network).map_err(key_error)?;
    let (base, client) = prepare(&address, own_network).await?;
    probe(&client, &base, key.clone()).await?;
    let stored = bundle(&base, own_network, key)?;
    secrets::store_custom_provider(&stored)
        .map_err(|message| providers::transport_error("bad-request", message))
}

/// What Settings may know about the saved service. NEVER the key.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct CustomProviderStatus {
    address: String,
    own_network: bool,
    has_key: bool,
}

fn status_of(saved: &Saved) -> CustomProviderStatus {
    CustomProviderStatus {
        address: saved.address.clone(),
        own_network: saved.own_network,
        has_key: !saved.key.is_empty(),
    }
}

/// Is a service saved, and where? `None` when nothing is saved.
#[tauri::command]
pub(crate) fn custom_provider_status() -> Result<Option<CustomProviderStatus>, String> {
    Ok(load_saved()?.as_ref().map(status_of))
}

/// List the saved service's models. The saved address is vetted again.
#[tauri::command]
pub(crate) async fn custom_provider_models() -> Result<String, String> {
    let saved = load()?;
    let (base, client) = prepare(&saved.address, saved.own_network).await?;
    let request = with_key(
        client
            .get(endpoint(&base, "models"))
            .timeout(MODELS_TIMEOUT),
        saved_key(&saved),
    );
    send(request).await
}

/// Send one chat request to the saved service. The saved address is vetted
/// again; `body` is the chat-completions JSON built in TypeScript.
#[tauri::command]
pub(crate) async fn custom_provider_chat(body: String) -> Result<String, String> {
    providers::validate_chat_body(&body)
        .map_err(|message| providers::transport_error("bad-request", message))?;
    let saved = load()?;
    let (base, client) = prepare(&saved.address, saved.own_network).await?;
    let request = with_key(
        client
            .post(endpoint(&base, "chat/completions"))
            .timeout(CHAT_TIMEOUT)
            .header("content-type", "application/json")
            .body(body),
        saved_key(&saved),
    );
    send(request).await
}

#[cfg(test)]
mod tests {
    use std::net::Ipv6Addr;

    use super::*;

    fn v4(text: &str) -> IpAddr {
        IpAddr::V4(text.parse::<Ipv4Addr>().unwrap())
    }

    fn v6(text: &str) -> IpAddr {
        IpAddr::V6(text.parse::<Ipv6Addr>().unwrap())
    }

    fn at(ip: IpAddr) -> SocketAddr {
        SocketAddr::new(ip, 443)
    }

    // ── Where an address sits ────────────────────────────────────────────

    #[test]
    fn the_users_own_computer_and_network_are_own() {
        for ip in [
            v4("127.0.0.1"),
            v4("127.255.255.254"),
            v4("10.0.0.5"),
            v4("172.16.0.1"),
            v4("172.31.255.255"),
            v4("192.168.1.20"),
            v4("100.64.0.1"),
            v4("100.127.255.255"),
            v6("::1"),
            v6("fd12:3456::1"),
            v6("fc00::1"),
            v6("::ffff:192.168.1.20"),
        ] {
            assert_eq!(reach(ip), Reach::Own, "{ip}");
        }
    }

    #[test]
    fn internet_addresses_are_public() {
        for ip in [
            v4("8.8.8.8"),
            v4("93.184.216.34"),
            v6("2606:4700::1111"),
            v6("::ffff:8.8.8.8"),
        ] {
            assert_eq!(reach(ip), Reach::Public, "{ip}");
        }
    }

    #[test]
    fn boundary_the_edges_of_each_private_range() {
        // One step outside each range is the internet, not the user's network.
        for ip in [
            v4("172.15.255.255"),
            v4("172.32.0.0"),
            v4("192.167.255.255"),
            v4("192.169.0.0"),
            v4("100.63.255.255"),
            v4("100.128.0.0"),
            v4("11.0.0.0"),
            v4("9.255.255.255"),
        ] {
            assert_eq!(reach(ip), Reach::Public, "{ip}");
        }
    }

    #[test]
    fn negative_metadata_link_local_and_reserved_space_is_never_reached() {
        // The tick cannot open these: the cloud metadata endpoint is the
        // classic way an address-taking command becomes stolen credentials.
        for ip in [
            v4("169.254.169.254"),
            v4("169.254.0.1"),
            v4("0.0.0.0"),
            v4("0.1.2.3"),
            v4("224.0.0.1"),
            v4("239.255.255.250"),
            v4("240.0.0.1"),
            v4("255.255.255.255"),
            v4("198.18.0.1"),
            v4("198.19.255.255"),
            v6("::"),
            v6("fe80::1"),
            v6("febf::1"),
            v6("ff02::1"),
            v6("::ffff:169.254.169.254"),
        ] {
            assert_eq!(reach(ip), Reach::Never, "{ip}");
        }
    }

    // ── Reading what was typed ───────────────────────────────────────────

    #[test]
    fn an_https_internet_address_is_accepted_and_tidied() {
        let url = parse_address("  https://api.example.com/v1/  ", false).unwrap();
        assert_eq!(url.as_str(), "https://api.example.com/v1");
        assert_eq!(
            endpoint(&url, "models"),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            endpoint(&url, "chat/completions"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn an_address_with_no_path_joins_cleanly() {
        let url = parse_address("https://api.example.com", false).unwrap();
        assert_eq!(endpoint(&url, "models"), "https://api.example.com/models");
    }

    #[test]
    fn with_the_tick_a_plain_http_address_on_the_users_machine_is_accepted() {
        for address in [
            "http://localhost:1234/v1",
            "http://127.0.0.1:8080/v1",
            "http://192.168.1.20:11434/v1",
            "http://[::1]:1234/v1",
            "http://my-box.local:1234/v1",
            "https://localhost:8443/v1",
        ] {
            assert!(parse_address(address, true).is_ok(), "{address}");
        }
    }

    #[test]
    fn negative_an_empty_address_is_refused() {
        for blank in ["", "   ", "\n\t"] {
            assert_eq!(parse_address(blank, false), Err(AddressProblem::Empty));
            assert_eq!(parse_address(blank, true), Err(AddressProblem::Empty));
        }
    }

    #[test]
    fn negative_something_that_is_not_a_web_address_is_refused() {
        for address in [
            "api.example.com/v1",
            "not an address",
            "ftp://api.example.com/v1",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/plain,hello",
            "https://",
        ] {
            assert_eq!(
                parse_address(address, true),
                Err(AddressProblem::NotAnAddress),
                "{address}"
            );
        }
    }

    #[test]
    fn negative_credentials_queries_and_fragments_are_refused() {
        for address in [
            "https://user:pass@api.example.com/v1",
            "https://user@api.example.com/v1",
            "https://api.example.com/v1?key=abc",
            "https://api.example.com/v1?",
            "https://api.example.com/v1#models",
        ] {
            assert_eq!(
                parse_address(address, false),
                Err(AddressProblem::CarriesExtras),
                "{address}"
            );
        }
    }

    #[test]
    fn negative_plain_http_to_the_internet_is_refused_without_the_tick() {
        assert_eq!(
            parse_address("http://api.example.com/v1", false),
            Err(AddressProblem::NeedsHttps)
        );
        assert_eq!(
            parse_address("http://93.184.216.34/v1", false),
            Err(AddressProblem::NeedsHttps)
        );
    }

    #[test]
    fn negative_the_users_own_machine_needs_the_tick() {
        for address in [
            "http://localhost:1234/v1",
            "https://localhost:1234/v1",
            "https://LOCALHOST./v1",
            "https://box.localhost/v1",
            "https://nas.local/v1",
            "https://127.0.0.1/v1",
            "https://192.168.1.20/v1",
            "https://[::1]/v1",
            "https://[fd00::1]/v1",
        ] {
            assert_eq!(
                parse_address(address, false),
                Err(AddressProblem::OwnNetworkNeedsTick),
                "{address}"
            );
        }
    }

    #[test]
    fn negative_the_tick_does_not_make_an_internet_ip_local() {
        assert_eq!(
            parse_address("http://93.184.216.34/v1", true),
            Err(AddressProblem::NotOwnNetwork)
        );
        assert_eq!(
            parse_address("https://[2606:4700::1111]/v1", true),
            Err(AddressProblem::NotOwnNetwork)
        );
    }

    #[test]
    fn negative_the_metadata_endpoint_is_refused_with_or_without_the_tick() {
        for own_network in [false, true] {
            for address in [
                "http://169.254.169.254/latest/meta-data",
                "https://169.254.169.254/v1",
                "http://[fe80::1]/v1",
                "http://0.0.0.0:1234/v1",
                "http://[::ffff:169.254.169.254]/v1",
            ] {
                assert_eq!(
                    parse_address(address, own_network),
                    Err(AddressProblem::Refused),
                    "{address} with the tick {own_network}"
                );
            }
        }
    }

    #[test]
    fn boundary_the_address_length_limit() {
        let base = "https://api.example.com/";
        let at_limit = format!("{base}{}", "a".repeat(MAX_ADDRESS_BYTES - base.len()));
        assert_eq!(at_limit.len(), MAX_ADDRESS_BYTES);
        assert!(parse_address(&at_limit, false).is_ok());

        let over = format!("{at_limit}a");
        assert_eq!(parse_address(&over, false), Err(AddressProblem::TooLong));
    }

    #[test]
    fn boundary_a_host_that_grows_into_punycode_is_measured_after_parsing() {
        // `ü` is two bytes as typed and becomes `xn--...` once parsed. A limit
        // checked only on what was typed would let a longer address through.
        // Mixed scripts in short labels: each label pays the `xn--` prefix and
        // punycode's deltas, so the parsed form is far longer than the typed.
        let letters: Vec<char> = "üaa中aaäaaжaaกaaöaaéaaяaa"
            .chars()
            .filter(|letter| *letter != 'a')
            .flat_map(|letter| [letter, 'a'])
            .collect::<Vec<_>>()
            .repeat(8);
        let labels: Vec<String> = letters
            .chunks(10)
            .map(|chunk| chunk.iter().collect())
            .collect();
        let typed = format!("https://{}.example.com/v1", labels.join("."));
        assert!(typed.len() < MAX_ADDRESS_BYTES);
        let parsed_len = Url::parse(&typed).unwrap().as_str().len();
        assert!(
            parsed_len > MAX_ADDRESS_BYTES,
            "the fixture no longer grows"
        );
        assert_eq!(parse_address(&typed, false), Err(AddressProblem::TooLong));
    }

    // ── What the name resolved to ────────────────────────────────────────

    #[test]
    fn every_resolved_address_must_match_the_box() {
        let public = [at(v4("93.184.216.34")), at(v6("2606:4700::1111"))];
        let own = [at(v4("127.0.0.1")), at(v6("::1"))];
        assert_eq!(check_resolved(&public, false), Ok(()));
        assert_eq!(check_resolved(&own, true), Ok(()));
    }

    #[test]
    fn negative_one_bad_answer_among_good_ones_is_enough_to_refuse() {
        // EVERY address, not the first: a name answering with a public and a
        // private address reaches the private one on the next attempt.
        let mixed = [at(v4("93.184.216.34")), at(v4("192.168.1.1"))];
        assert_eq!(
            check_resolved(&mixed, false),
            Err(AddressProblem::OwnNetworkNeedsTick)
        );
        assert_eq!(
            check_resolved(&mixed, true),
            Err(AddressProblem::NotOwnNetwork)
        );

        let metadata = [at(v4("127.0.0.1")), at(v4("169.254.169.254"))];
        assert_eq!(
            check_resolved(&metadata, true),
            Err(AddressProblem::Refused)
        );
        assert_eq!(
            check_resolved(&metadata, false),
            Err(AddressProblem::Refused)
        );
    }

    #[test]
    fn negative_a_name_that_resolved_to_nothing_is_not_found() {
        assert_eq!(check_resolved(&[], false), Err(AddressProblem::NotFound));
        assert_eq!(check_resolved(&[], true), Err(AddressProblem::NotFound));
    }

    // ── The key ──────────────────────────────────────────────────────────

    #[test]
    fn a_pasted_key_is_trimmed() {
        assert_eq!(
            checked_key("  sk-abc123\n", false),
            Ok(Some("sk-abc123".to_string()))
        );
    }

    #[test]
    fn with_the_tick_a_key_is_optional() {
        assert_eq!(checked_key("", true), Ok(None));
        assert_eq!(checked_key("   ", true), Ok(None));
        assert_eq!(
            checked_key("lm-studio", true),
            Ok(Some("lm-studio".to_string()))
        );
    }

    #[test]
    fn negative_without_the_tick_a_key_is_required() {
        assert_eq!(checked_key("", false), Err(KeyProblem::Missing));
        assert_eq!(checked_key(" \n", false), Err(KeyProblem::Missing));
    }

    #[test]
    fn negative_a_key_that_cannot_go_in_a_header_is_refused() {
        for bad in ["sk abc", "sk-\u{e9}", "sk-\u{0}", "sk-\tx", "sk-\u{7f}"] {
            assert_eq!(
                checked_key(bad, false),
                Err(KeyProblem::Unusable),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn boundary_the_key_length_limit() {
        let at_limit = "k".repeat(MAX_KEY_BYTES);
        assert_eq!(checked_key(&at_limit, false), Ok(Some(at_limit.clone())));
        assert_eq!(
            checked_key(&format!("{at_limit}k"), false),
            Err(KeyProblem::TooLong)
        );
    }

    #[test]
    fn the_largest_bundle_fits_one_credential() {
        // The address and the key share one credential-store entry, which
        // `secrets::store_custom_provider` refuses past MAX_SECRET_BYTES. A
        // pair that tests green and then cannot be saved is the failure
        // test-before-save exists to prevent.
        let base = "https://api.example.com/";
        let address = format!("{base}{}", "a".repeat(MAX_ADDRESS_BYTES - base.len()));
        let url = parse_address(&address, false).unwrap();
        let key = checked_key(&"k".repeat(MAX_KEY_BYTES), false).unwrap();
        let stored = bundle(&url, false, key).unwrap();
        assert!(
            stored.len() <= secrets::MAX_SECRET_BYTES,
            "the largest bundle is {} bytes",
            stored.len()
        );
    }

    // ── What is saved, and what comes back out ───────────────────────────

    #[test]
    fn the_bundle_round_trips() {
        let url = parse_address("http://localhost:1234/v1", true).unwrap();
        let stored = bundle(&url, true, Some("lm-studio".to_string())).unwrap();
        assert_eq!(
            read_bundle(&stored),
            Some(Saved {
                address: "http://localhost:1234/v1".to_string(),
                own_network: true,
                key: "lm-studio".to_string(),
            })
        );
    }

    #[test]
    fn negative_a_damaged_bundle_reads_as_nothing() {
        for damaged in ["", "sk-abc", "{}", "{\"address\":1}", "[]"] {
            assert_eq!(read_bundle(damaged), None, "{damaged}");
        }
    }

    #[test]
    fn the_status_never_carries_the_key() {
        let saved = Saved {
            address: "https://api.example.com/v1".to_string(),
            own_network: false,
            key: "sk-do-not-return-me".to_string(),
        };
        let status = status_of(&saved);
        let rendered = serde_json::to_string(&status).unwrap();
        assert!(!rendered.contains("sk-do-not-return-me"));
        assert_eq!(
            rendered,
            r#"{"address":"https://api.example.com/v1","own_network":false,"has_key":true}"#
        );

        let keyless = Saved {
            key: String::new(),
            ..saved
        };
        assert!(!status_of(&keyless).has_key);
    }

    // ── What the user is told ────────────────────────────────────────────

    const ALL_ADDRESS_PROBLEMS: [AddressProblem; 9] = [
        AddressProblem::Empty,
        AddressProblem::NotAnAddress,
        AddressProblem::TooLong,
        AddressProblem::CarriesExtras,
        AddressProblem::NeedsHttps,
        AddressProblem::OwnNetworkNeedsTick,
        AddressProblem::NotOwnNetwork,
        AddressProblem::Refused,
        AddressProblem::NotFound,
    ];

    const ALL_OUTCOMES: [KeyTestOutcome; 5] = [
        KeyTestOutcome::Refused,
        KeyTestOutcome::RateLimited,
        KeyTestOutcome::Unreachable,
        KeyTestOutcome::ProviderFault,
        KeyTestOutcome::Rejected,
    ];

    const ALL_FAILURES: [providers::RequestFailure; 5] = [
        providers::RequestFailure::Timeout,
        providers::RequestFailure::Connect,
        providers::RequestFailure::Body,
        providers::RequestFailure::Decode,
        providers::RequestFailure::Other,
    ];

    fn every_message() -> Vec<&'static str> {
        let mut all: Vec<&'static str> = Vec::new();
        all.extend(ALL_ADDRESS_PROBLEMS.map(address_message));
        all.extend(
            [
                KeyProblem::Missing,
                KeyProblem::TooLong,
                KeyProblem::Unusable,
            ]
            .map(key_message),
        );
        all.extend(ALL_OUTCOMES.map(test_message));
        all.extend(ALL_FAILURES.map(failure_message));
        all.extend([TOO_LARGE, NOTHING_SAVED, UNREADABLE_SAVE]);
        all
    }

    #[test]
    fn no_message_carries_a_number_or_an_address() {
        // Fixed sentences only. A digit would mean a status code or a port got
        // in; a dot between letters would mean a host did.
        for message in every_message() {
            assert!(!message.is_empty());
            assert!(
                !message.chars().any(|character| character.is_ascii_digit()),
                "a message carries a number: {message}"
            );
            assert!(
                !message.contains("example") && !message.contains("localhost"),
                "a message names an address: {message}"
            );
        }
    }

    #[test]
    fn each_address_problem_has_its_own_sentence() {
        let mut messages: Vec<&str> = ALL_ADDRESS_PROBLEMS.map(address_message).to_vec();
        messages.sort_unstable();
        messages.dedup();
        assert_eq!(messages.len(), ALL_ADDRESS_PROBLEMS.len());
    }

    #[test]
    fn errors_travel_as_the_kinds_the_typescript_union_knows() {
        for problem in ALL_ADDRESS_PROBLEMS {
            let parsed: serde_json::Value = serde_json::from_str(&address_error(problem)).unwrap();
            assert!(["bad-request", "network"].contains(&parsed["kind"].as_str().unwrap()));
            assert_eq!(parsed["message"], address_message(problem));
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&key_error(KeyProblem::Missing)).unwrap();
        assert_eq!(parsed["kind"], "no-key");
    }

    // ── Structure ────────────────────────────────────────────────────────

    /// Drop `//` comments so a rule about code cannot be tripped by prose.
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

    fn production() -> String {
        let whole = without_comments(include_str!("custom_provider.rs"));
        let cut = whole.find("#[cfg(test)]").unwrap_or(whole.len());
        whole[..cut].to_string()
    }

    /// The text of one function, from its `fn` line to the next `#[`.
    fn body_of(source: &str, name: &str) -> String {
        let start = source
            .find(&format!("fn {name}("))
            .unwrap_or_else(|| panic!("{name} not found"));
        let rest = &source[start..];
        let end = rest[1..].find("#[").map_or(rest.len(), |index| index + 1);
        rest[..end].to_string()
    }

    #[test]
    fn the_production_slice_holds_the_commands() {
        let source = production();
        assert!(source.contains("pub(crate) async fn custom_provider_chat"));
        assert!(!source.contains("mod tests"));
    }

    #[test]
    fn every_command_that_connects_vets_the_address_first() {
        let source = production();
        for command in [
            "custom_provider_test",
            "custom_provider_save",
            "custom_provider_models",
            "custom_provider_chat",
        ] {
            assert!(
                body_of(&source, command).contains("prepare("),
                "{command} connects without vetting the address"
            );
        }
        // And the one way to a client is pinned, with redirects off.
        assert!(source.contains("redirect::Policy::none()"));
        assert!(source.contains("resolve_to_addrs"));
        assert!(
            source.contains("builder.no_proxy()"),
            "a request to the user's own network could leave through a proxy"
        );
        assert!(
            !source.contains("providers::client"),
            "the shared client follows redirects and is not pinned"
        );
    }

    #[test]
    fn testing_cannot_save() {
        let source = production();
        let test = body_of(&source, "custom_provider_test");
        assert!(test.contains("probe("), "the slice is not the test command");
        for forbidden in [
            "store_custom_provider",
            "secret_set",
            "set_password",
            "bundle(",
        ] {
            assert!(
                !test.contains(forbidden),
                "custom_provider_test can save: {forbidden}"
            );
        }
        // Saving tests first, in the same command.
        let save = body_of(&source, "custom_provider_save");
        let probed = save.find("probe(").expect("save does not test");
        let stored = save
            .find("store_custom_provider")
            .expect("save does not store");
        assert!(probed < stored, "save stores before it tests");
    }

    #[test]
    fn the_key_never_leaves_through_a_command() {
        // The status is the only thing that reads back, and its type has no
        // field that could hold the key.
        let source = production();
        let start = source
            .find("pub(crate) struct CustomProviderStatus {")
            .expect("the status type moved");
        let fields = &source[start..start + source[start..].find('}').unwrap()];
        assert!(
            fields.contains("has_key: bool"),
            "the slice is not the status type"
        );
        assert!(
            !fields.contains("String,\n    key") && !fields.contains(" key:"),
            "the status type can carry the key"
        );
    }

    #[test]
    fn the_frontend_calls_chat_and_models_by_these_names() {
        // A renamed command or argument fails nowhere but at runtime, in a
        // built app. The body is one word, so Tauri's camelCase conversion
        // cannot change it; the model list takes no argument at all.
        const TRANSPORT_TS: &str = include_str!("../../src/ai/transport.ts");
        assert!(TRANSPORT_TS.contains("'custom_provider_chat'"));
        assert!(TRANSPORT_TS.contains("'custom_provider_models'"));
        assert!(TRANSPORT_TS.contains("call(provider, CUSTOM_CHAT_COMMAND, { body })"));
        assert!(TRANSPORT_TS.contains("call(provider, CUSTOM_LIST_MODELS_COMMAND, {})"));
        // Anti-inert: the haystack is the real transport.
        assert!(TRANSPORT_TS.contains("createTauriTransport"));
    }

    #[test]
    fn the_settings_card_calls_save_and_status_by_these_names() {
        // `own_network` is two words, so Tauri expects it as `ownNetwork` on
        // the JavaScript side — exactly the drift nothing would report until
        // a user pressed the button.
        const PORT_TS: &str = include_str!("../../src/features/settings/keys/customServicePort.ts");
        assert!(PORT_TS.contains("'custom_provider_save'"));
        assert!(PORT_TS.contains("'custom_provider_status'"));
        assert!(PORT_TS.contains("invoke(SAVE_COMMAND, { address, ownNetwork, key })"));
        assert!(
            !PORT_TS.contains("own_network:"),
            "the card sends the snake_case name, which Tauri will not match"
        );
        // The card never writes the entry through `secret_set`, which refuses it.
        assert!(!PORT_TS.contains("'secret_set'"));
    }

    #[test]
    fn every_command_is_registered_for_javascript() {
        let handler = without_comments(include_str!("lib.rs"));
        for command in [
            "custom_provider_test",
            "custom_provider_save",
            "custom_provider_status",
            "custom_provider_models",
            "custom_provider_chat",
        ] {
            assert!(
                handler.contains(&format!("custom_provider::{command},")),
                "{command} is not registered in generate_handler!"
            );
        }
    }
}
