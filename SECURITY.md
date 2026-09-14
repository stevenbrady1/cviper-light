# Security policy

## Reporting a vulnerability

Report security findings privately through
[GitHub's private vulnerability reporting](https://github.com/stevenbrady1/cviper-light/security/advisories/new)
rather than in a public issue. This is a one-person project, so expect a reply
within a week rather than within the hour; you will be credited in the fix
unless you ask not to be, and disclosure is coordinated with the patch.

If the private form is unavailable, open a public issue that names the _class_
of problem without a working recipe, and say that you have details to share
privately.

There is no bounty programme.

## Threat model, honestly stated

CViper Light feeds text it did not write — job adverts pasted in, fetched from
a link or read from a feed — into a language model, on a machine that also
holds your CV and your API keys. That combination is the main risk surface. It
cannot be removed, only narrowed, and this section says what the narrowing
actually is.

### What leaves the machine, and when

Nothing goes to a server belonging to this project: there is none. Every
address the app can contact is listed in `apps/light/src/lib/outbound-hosts.ts`,
Settings → Privacy shows that list, and `outbound-hosts.contract.test.ts`
fails the build if shipped code names a host that is not on it.

On its own, the app does two things: at launch it reads this app's GitHub
releases to see whether there is a newer version, unless you switch that off
in Settings → Updates, and it asks this same computer whether Ollama is
running — a loopback request that never leaves it. On Windows, the WebView2
runtime also talks to Microsoft on its own schedule; that is the operating
system's request, not the app's, and the privacy notice says so.

Everything else happens because you pressed something: a job search with your
own Adzuna or Reed key; a read of the two keyless feeds; a CV analysis or a
pasted advert sent to the cloud provider you chose, under your own key; one
page fetched from a link you pasted; a manual update check; and links opened
in your own browser, which the app hands over and does not load.

### Rust owns every outbound request

The web view cannot open a socket. Its Content-Security-Policy names no
external host, allows no `eval` and no wildcard (`csp.contract.test.ts`), there
is no Tauri HTTP plugin and no `http:*` capability, and every real network call
is a Rust command reached over IPC. Whatever ends up executing in the page —
an advert's HTML, a model's reply — still cannot reach the network itself.

The AI and job-board transports in Rust refuse a caller-supplied address:
`there_is_no_generic_url_taking_command` in `providers.rs` and `jobs.rs` fails
if one is ever added. The one command that takes a URL is Fetch, below.

### Keys live in the operating system's credential store

API keys go through the `keyring` crate into Windows Credential Manager, the
macOS Keychain, the Secret Service on Linux or the iOS data-protection
keychain. They are never written to a file, the database or the page. Three
commands are exposed to JavaScript — set, delete, and a status that returns a
boolean — and none returns any part of a stored key;
`no_registered_command_returns_any_part_of_a_stored_secret` in `secrets.rs`
keeps it that way. A forgotten key is replaced, never recovered.

### Fetch opens one page, and only the page you named

`apps/light/src-tauri/src/fetch_page.rs` treats the pasted address as a
request to fetch, not as an instruction. Before a socket is opened, and again
on every redirect hop, the scheme must be `http` or `https`, the URL may carry
no username or password, the host may not be `localhost`, `.localhost` or
`.local`, and every address the host resolves to must be public — loopback,
private, link-local, carrier-NAT, multicast and reserved ranges are refused in
IPv4 and IPv6, including an IPv4 address written as IPv6. The connection is
pinned to the addresses just vetted, so the name cannot change its mind between
the check and the connect. A redirect may not leave the registrable domain it
started on, and at most three are followed. The reply must be HTML or plain
text, is capped in bytes while streaming, and the whole operation has a
fifteen-second budget.

It carries no cookies, no `Authorization` header and no API key, and it cannot
reach the credential store: `this_command_cannot_reach_the_credential_store`
fails if the module ever names it. It follows no links in the page it fetched,
loads no images, scripts or subresources, and the text it brings back lands in
a form you read before anything is saved.

### Per-provider consent before a CV reaches a cloud AI

A dialog names the provider and says what will be sent — the CV text and the
job advert, under your key — before the first run against any cloud provider.
The gate is enforced in the code that builds the transport, not only in the
UI, and `ai-call-sites-consent.contract.test.ts` derives the list of every
module that can build the transport and fails if one skips the check. A local
Ollama run is exempt by construction: there is no branch for it to fall into.

### Job adverts are untrusted input

The model reads text an attacker could have written. Two defences are in the
prompt: `sanitizeForPrompt` in `packages/cv-parsing` strips the override
phrasings the hosted product actually saw in the wild, and the trust-boundary
clause (L-153, landing alongside this policy) tells the model that the advert
is data to be evaluated, not instructions to be followed. A model's rejected
output is sanitised again before it is quoted back in a repair prompt.

**These are instruction-level defences, not a sandbox.** A small local model
is, if anything, easier to talk out of its instructions than a large one. What
limits the damage is the shape of what the model can do: it returns a JSON
object that is validated in TypeScript, the verdict is computed in TypeScript
and never trusted from the model, it cannot open a link, run a command or
reach the network, and nothing it says about an advert is saved until you have
read every field of the form it filled in. Treat what a model says about an
advert as a suggestion from someone who has just read that advert.

### What this policy does not cover

- A compromised or shared machine. The credential store and the database are
  only as private as the user account they belong to.
- The AI providers' and job boards' own services. What you send them under
  your key is governed by their terms, not by this file.
- Your IP address. The site you Fetch from, the feeds you browse and the
  provider you call all see it, exactly as your browser would show it.
- Something you paste into an advert box that you should not have — the app
  cannot tell a secret from a salary.

## Scope notes

- In scope: the app under `apps/light`, the Rust commands under
  `apps/light/src-tauri`, the packages under `packages/`, and the workflows
  under `.github/workflows/` that produce a shipped artefact — including the
  build-failing guards the README lists, since a guard that has gone quietly
  inert is a finding in its own right.
- Out of scope: the hosted CViper product, which was mothballed in September
  2026 and no longer runs; `apps/cloud`, which is an empty stub; and the
  `cviper.ai` website, which lives in its own repository.
- No release has been published yet. Fixes land on `main`; once releases
  exist, only the latest one is supported.
