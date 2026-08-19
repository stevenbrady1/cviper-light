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

`plugins.updater.endpoints` currently points at `PLACEHOLDER-ORG`. Change it to
the real GitHub owner and repository at the same time as the pubkey. The tag in
the URL stays `latest`: `release.yml` republishes `latest.json` on every
release, so the endpoint is never edited again.

## What the placeholder does today

| Operation                            | With the placeholder in place                                             |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `cargo check`, `cargo test`          | Pass. The pubkey is an opaque string to the build.                        |
| `pnpm tauri dev`                     | Runs. The plugin registers; nothing parses the key until a check is made. |
| **Check for updates** in Settings    | Returns an error, which Settings shows. Correct for an unsigned build.    |
| `tauri build` with updater artifacts | Fails outright. Also correct — an unsigned update is not shippable.       |

## Why `installMode` is `passive`

`"quiet"` hides the installer window completely. On a machine where the install
needs elevation that produces a UAC prompt with nothing behind it: the user gets
a permission request from nowhere and refuses it. `"passive"` shows a progress
bar and asks nothing.

## Why `createUpdaterArtifacts` is on

Without it a release builds installers that no existing install can ever see.
The omission is invisible until the first user fails to receive an update, which
is months later and looks like the updater is broken rather than absent.
