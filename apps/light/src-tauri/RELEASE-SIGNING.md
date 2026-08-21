# Signing and the updater — the human steps

`tauri.conf.json` is **strict JSON**. It has no comments, and this is not a
style choice: `tauri-build` parses it with `serde_json`, and adding a single
`//` fails the build with

```
unable to parse JSON Tauri config file ... because key must be a string
```

So the notes that belong beside `plugins.updater` live here instead. Read this
before touching that block.

## 1. Generate the signing keypair — NOT in this repository

```
pnpm tauri signer generate -w ~/.tauri/cviper-light.key
```

It writes two files and prints the public key.

- The **private** key and its password go into the GitHub repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- The **public** key replaces `plugins.updater.pubkey` in `tauri.conf.json`.

No keypair is generated, stored, or committed here — by anyone or anything,
ever. A signing key in version control is a signing key that lets a stranger
ship a signed binary to every user this app has, and there is no revocation
story for an app that checks one hardcoded public key.

## 2. Set the real owner and repository

`plugins.updater.endpoints` points at `stevenbrady1/cviper-light`, set at the
same time as the pubkey. The tag in the URL stays `latest`. The tag in
the URL stays `latest`: `release.yml` republishes `latest.json` on every
release, so the endpoint is never edited again.

## What the placeholder does today

Read out of `tauri-plugin-updater` 2.10.1 rather than assumed. The pubkey is
decoded in `verify_signature`, which `updater.rs` calls at line 712 — inside the
DOWNLOAD path, after the bytes are in hand. `Builder::build()` merely clones the
config into managed state, and `UpdaterBuilder::build()` validates the endpoint
list and the architecture but never touches the key.

| Operation                            | With the placeholder in place                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `cargo check`, `cargo test`          | Pass. The pubkey is an opaque string to the build.                                 |
| `pnpm tauri dev`                     | Runs. Nothing parses the key at startup.                                           |
| **Check for updates** in Settings    | Works, and can report an update as available — a check compares versions only.     |
| **Install** that update              | Fails at signature verification. Settings shows the message; nothing is installed. |
| `tauri build` with updater artifacts | Fails outright. Correct — an unsigned update is not shippable.                     |

The consequence worth knowing: until the real key is in place, a build can OFFER
an update it cannot install. That is the safe direction to fail in — a refused
signature is the check working — but it is not a state to ship to users, which
is why the release workflow needs the secrets before anything is published.

## Why `installMode` is `passive`

`"quiet"` hides the installer window completely. On a machine where the install
needs elevation that produces a UAC prompt with nothing behind it: the user gets
a permission request from nowhere and refuses it. `"passive"` shows a progress
bar and asks nothing.

## Why `createUpdaterArtifacts` is on

Without it a release builds installers that no existing install can ever see.
The omission is invisible until the first user fails to receive an update, which
is months later and looks like the updater is broken rather than absent.
