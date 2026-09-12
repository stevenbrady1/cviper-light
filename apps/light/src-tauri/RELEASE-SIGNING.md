# Signing and the updater — the human steps

`tauri.conf.json` is **strict JSON**. It has no comments, and this is not a
style choice: `tauri-build` parses it with `serde_json`, and adding a single
`//` fails the build with

```
unable to parse JSON Tauri config file ... because key must be a string
```

So the notes that belong beside `plugins.updater` live here instead. Read this
before touching that block.

## 1. The signing keypair — ALREADY GENERATED, AND NEVER TO BE REGENERATED

> ### Do not generate a new updater key. Ever.
>
> `plugins.updater.pubkey` in `tauri.conf.json` holds the **live** minisign
> public key, id **`7029FCBC6B4F158F`**. It is real and in use. Its private half
> and that key's password are set in this repository's GitHub Actions secrets,
> `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
>
> Every installed copy verifies updates against the key that was baked into it
> when it was built. Running `pnpm tauri signer generate` again and committing
> the new public key **permanently stops every existing install from accepting
> any future update** — silently, with no error the user can act on, and with no
> way to repair it short of every one of those people downloading a fresh
> installer by hand. The app checks one hardcoded key and there is no revocation
> path, so this cannot be fixed by shipping another release.

It was generated once, by the operator, with

```
pnpm tauri signer generate -w ~/.tauri/cviper-light.key
```

which wrote two files and printed the public key.

- The **private** key and its password went into the GitHub repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The **public** key is `plugins.updater.pubkey` in `tauri.conf.json`, set in
  `ce13a96`.

No keypair is generated, stored, or committed here — by anyone or anything,
ever. A signing key in version control is a signing key that lets a stranger
ship a signed binary to every user this app has, and there is no revocation
story for an app that checks one hardcoded public key.

## 2. The endpoint is a FIXED tag, and `/releases/latest/` is a trap

`plugins.updater.endpoints` points at `stevenbrady1/cviper-light`, set at the
same time as the pubkey. The address is

```
https://github.com/stevenbrady1/cviper-light/releases/download/updater/latest.json
```

`updater` is a permanent release whose single `latest.json` asset is
**overwritten** on every release. The address never changes; its contents do.

It used to end `/releases/latest/download/latest.json`, which reads as "whatever
the newest release is" and is not. GitHub resolves `/releases/latest/` to the
newest release that is **neither a draft nor a pre-release**, and this project
produces neither:

- `release.yml` always produces a DRAFT — see `releaseDraft` below, which is
  deliberate.
- Unsigned direct-download installers ship as PRE-RELEASES, because an installer
  SmartScreen warns about is not a headline download.

So the old endpoint 404ed with nothing published, and would have gone on 404ing
after the first real release — failing in the direction nobody investigates. The
user presses "Check for updates", is told there is nothing to compare against,
and concludes they are up to date.

`apps/light/src/lib/updater-endpoint.contract.test.ts` forbids the trap coming
back.

### How this was verified, rather than assumed

Read out of `tauri-plugin-updater` 2.10.1, the version pinned in `Cargo.lock`:

- `RemoteReleaseInner` (`updater.rs`) is an **untagged** enum whose `Static`
  variant is `{ platforms: HashMap<String, ReleaseManifestPlatform> }`. A static
  signed JSON file is a first-class supported shape, not a workaround.
- The check is a plain `GET` with `Accept: application/json` that requires a
  success status and parses the body. Nothing requires the URL to contain a tag,
  a version or a `{{target}}` placeholder — the `{{…}}` substitutions are
  optional string replacements applied before the request.
- `validate_endpoints` (`config.rs`) enforces exactly one thing in a release
  build: the scheme is `https`.
- GitHub answers `/releases/download/<tag>/<asset>` with a 302 to its object
  store, and `reqwest` follows redirects by default.

A 204 from an endpoint means "no update"; a 404 is an error, which is why the
old address produced a failure message rather than a silent "you are current".

## 3. Releasing: the human steps, in order

Nothing about a release is automatic. The workflow produces a draft; a person
decides everything after that.

1. **Push a `light-v*` tag.** The `bundle` job in `release.yml` builds the
   installers and uploads them to a **draft** release, with `latest.json`
   beside them. Nothing is public, and no installed copy can see any of it.
2. **Review the draft.** Download the installer, run it, check the version is
   what you expect. This is what the draft gate exists to make possible.
   `releaseDraft: true` is deliberate and is not a setting to flip: publishing
   is the moment every existing install starts downloading.
3. **Publish the draft as a PRE-RELEASE.** Pre-release rather than latest,
   because the direct-download installers are unsigned, SmartScreen warns about
   them, and they are not a headline download.
4. **Promote the manifest.** Actions → Release → _Run workflow_, with
   `promote_tag` set to the tag you just published. **This is the moment
   existing installs begin to see the new version.** Nothing before this step
   changes what the updater serves.

### Why step 4 is a workflow rather than "copy the file across"

A manual copy has none of the properties that matter here:

- **It runs no verification.** The promote job cannot skip its own gate. A
  missing `latest.json`, one that will not parse, or one carrying a signature
  made by a key the shipped binaries do not trust all fail the run _before_
  anything is uploaded — `pnpm verify:updater-manifest`, run with
  `--bundle-dir` so the signatures are checked against the real downloaded
  installers rather than by key id alone.
- **It leaves no record.** A workflow run says what was promoted, from which
  tag, and who pressed it.
- **It can go wrong quietly** — the wrong file, or a forgotten `--clobber` that
  leaves the previous manifest in place while looking like it worked.
- **It is the step that gets skipped at eleven at night.**

It is also deliberately separate from publishing the release. Releases get
published for reasons that have nothing to do with the updater — re-uploading an
asset, fixing the notes — and none of those should re-point every installed copy.

### The `updater` release

The promote job creates it on first use if it is not there: a permanent
pre-release tagged `updater` whose only job is to hold `latest.json` at an
address that never changes. It is a pre-release so that it never takes GitHub's
"Latest" badge from a real version.

**Do not delete it.** The endpoint compiled into every shipped binary points at
it, and there is no way to tell an installed copy to look somewhere else.

## Where the key is actually read

Read out of `tauri-plugin-updater` 2.10.1 rather than assumed. The pubkey is
decoded in `verify_signature`, which `updater.rs` calls at line 712 — inside the
DOWNLOAD path, after the bytes are in hand. `Builder::build()` merely clones the
config into managed state, and `UpdaterBuilder::build()` validates the endpoint
list and the architecture but never touches the key.

| Operation                            | What the key does there                                                  |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `cargo check`, `cargo test`          | Nothing. The pubkey is an opaque string to the build.                    |
| `pnpm tauri dev`                     | Nothing. Nothing parses the key at startup.                              |
| **Check for updates** in Settings    | Nothing. A check compares versions only.                                 |
| **Install** that update              | Verifies the downloaded bundle. A signature that fails installs nothing. |
| `tauri build` with updater artifacts | Signs the bundle with the private key from the Actions secrets.          |

The consequence worth knowing: a build whose baked-in public key does not match
the private key a release was signed with can OFFER an update it cannot install.
That is the safe direction to fail in — a refused signature is the check working
— but it is why the key in `tauri.conf.json`, the secrets in this repository and
every copy already installed have to stay in step with one another.

## Why `installMode` is `passive`

`"quiet"` hides the installer window completely. On a machine where the install
needs elevation that produces a UAC prompt with nothing behind it: the user gets
a permission request from nowhere and refuses it. `"passive"` shows a progress
bar and asks nothing.

## Why `createUpdaterArtifacts` is on

Without it a release builds installers that no existing install can ever see.
The omission is invisible until the first user fails to receive an update, which
is months later and looks like the updater is broken rather than absent.

## iOS — what CI does, and what only a person can do

`.github/workflows/ios.yml` runs on a Mac and proves two things on every pull
request: the Rust side compiles for `aarch64-apple-ios` and
`aarch64-apple-ios-sim`, and `tauri ios init` plus an **unsigned** simulator
build (`tauri ios build --target aarch64-sim --no-sign`) produce an `.app` that
is uploaded as an artefact. No certificate, profile or team is involved, and none is stored in
this repository.

The listing itself — copy, privacy questionnaire, policy page, screenshots —
is prepared in [`docs/app-store/`](../../../docs/app-store/README.md) (L-84).

Everything past that is human, in this order:

1. In App Store Connect, create the app record for `com.cviper.light` (the
   `identifier` in `tauri.conf.json`), named **CViper Light**.
2. Set `bundle.iOS.developmentTeam` in `tauri.conf.json` — or export
   `APPLE_DEVELOPMENT_TEAM` when building — to the team id from the developer
   account. A team id is not a secret; a signing certificate and its private
   key are, and they stay in the account's keychain and in repository secrets
   (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
   `APPLE_PASSWORD` / an App Store Connect API key) for a future release job.
3. `pnpm tauri ios build --export-method app-store-connect` on a Mac with the
   certificate installed, then upload with Transporter or the release job.
4. The App Privacy questionnaire: every answer "no" — Light collects nothing,
   and the contract tests under `src/lib/` are the evidence. Apple still
   requires a privacy policy URL; the hosted `cviper.ai/light/privacy` page
   (CV-1394) is that URL.

The updater plugin is not part of an iOS build at all (Cargo.toml target
section, `lib.rs` `cfg(desktop)`, `capabilities/desktop.json`): the App Store
delivers updates, and Settings says so on a phone instead of offering a check.
