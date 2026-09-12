# MSIX + WACK spike (L-95)

A one-off experiment to turn an unknown into a fact **before** anyone spends
weeks on a Microsoft Store submission.

**The question:** does a **release**-built CViper Light, packaged as MSIX, pass
the Windows App Certification Kit?

Run it: Actions → **MSIX WACK spike (L-95)** → *Run workflow*. It is
`workflow_dispatch` and never runs on a push to `main`.

> **While this is still a pull request** it also carries a `push` trigger
> scoped to the single branch `ci/L-95-msix-wack-spike`, and that block is
> marked **delete before merge**. It exists because GitHub will not dispatch a
> workflow that is not already on the default branch — "This event will only
> trigger a workflow run if the workflow file exists on the default branch" —
> so a new spike workflow cannot otherwise be run from the PR that introduces
> it, which is the one place it needs to run. Merging first to make the button
> appear would mean landing an experiment before it had produced its answer.

## Why it might not

[`tauri-apps/tauri#14935`](https://github.com/tauri-apps/tauri/issues/14935) is
open and unfixed. A boilerplate Tauri v2 app failed WACK's **Blocked
Executables** check on `kernel32.dll!CreateProcessW`,
`shell32.dll!ShellExecuteW` and `cmd.exe`, and a Tauri maintainer replied "i
think this is impossible to fix... this is mostly WebView2". If that is real and
general, the Store route is closed for this app.

## Why it probably does

Four things point the other way, and the first is the reason this workflow
exists at all:

- Microsoft's own WACK documentation says **"The debug build of an app will fail
  this test even if the app uses only APIs for UWP apps."**
- Nobody in that thread confirmed testing a **release** build.
- The rejection email quoted in the thread was about undeclared hardware
  requirements — a different subject.
- [WSL-UI](https://apps.microsoft.com/), a real Tauri app, ships on the
  Microsoft Store today.

So the experiment builds **release**. Testing a debug build would faithfully
reproduce a documented, meaningless failure and send everyone the wrong way.

The `compare_debug` input builds a debug package too. It is worth spending the
extra runner time only if the release leg fails Blocked Executables — the
contrast is what tells you whether the failure is the documented debug artefact
or something real.

## How to read the result

The tick on the run is **not** the answer. The answer is in the job summary and
in `verdict.txt` inside the artefact.

| Job | Summary says | Means |
| --- | --- | --- |
| red | `INCONCLUSIVE` / `WACK COULD NOT RUN` | The kit never produced a report. An **environment** result. Says nothing about the app. |
| green | `WACK ran. Overall result: PASS` | The app passes certification. |
| green | `WACK ran. Overall result: FAIL` | The app **fails**, and the table lists which checks and why. |

A failing app is green on purpose. The whole point of a spike is to discover a
failure, so a red X would read as "the experiment broke" when in fact it worked.
This is the one place in this repo where a failure is allowed to be green, and
it is why the two cases are worded so differently.

What is **not** allowed is the two becoming indistinguishable. There is no
`|| true` and no `2>$null` anywhere near the `appcert` invocation: the branch is
decided by whether a report file exists, never by an exit code alone. This
repository has twice had every cron alarm silenced by exactly that idiom
(CV-373, CV-1314), which is what rule 71 exists to stop.

## What it actually does

1. Builds the web bundle, then `cargo build --release`.
2. **Inventories `target/release`** and writes it to the artefact.
3. Stages the discovered exe, any DLL beside it, and the three MSIX assets.
4. Installs `winapp` CLI v0.6.0 via `microsoft/setup-WinAppCli`, pinned to a SHA.
5. Generates and trusts a self-signed dev certificate.
6. Packs the MSIX.
7. Finds `appcert.exe`, installing the SDK feature if the image lacks it.
8. Runs WACK and parses the report.

### It does not run `tauri build`

`release.yml` opens with "THE ONLY PLACE `tauri build` IS EVER RUN", and that
invariant is worth more than the convenience of reusing it. Two further reasons
make it the wrong tool here anyway: `bundle.createUpdaterArtifacts` is true, so
`tauri build` demands `TAURI_SIGNING_PRIVATE_KEY` and fails at the bundling step
without it — and this experiment should not be handed a signing secret. And we
want the bare exe, not an NSIS installer. Microsoft's own Tauri sample test does
the same thing: `cargo build --release`.

### Staging is discovered, not assumed

The official winapp guide copies only `<app>.exe`. That is right for a
boilerplate app and silently wrong for one with sidecars (`bundle.externalBin`),
extra `bundle.resources`, or a DLL that must sit beside the binary — the MSIX
installs cleanly and then fails at runtime, the worst possible bug to find after
a submission.

A grep of this repo finds **no `externalBin`, no sidecar and no
`bundle.resources`**, so the expectation is "exe only". The workflow prints the
real directory contents into the artefact anyway, because an expectation is not
evidence. It also discovers the executable's *name* rather than hardcoding it: a
plain cargo build emits `light.exe` (the Cargo package name) while `tauri build`
renames it to `CViper Light.exe` (`productName`), and the manifest's
`Executable=` is rewritten to whatever was actually staged.

## Identity is fake, and that is fine

`apps/light/src-tauri/msix/appxmanifest.xml` carries placeholder identity. Real
Store `Name` and `Publisher` values are assigned by Partner Center at enrolment
and cannot be guessed. Nothing here is a decision about what the app is called.

Two details that are **not** placeholders:

- **The version is quad-format, `0.1.0.0`.** The Store reserves the fourth
  number and rejects a package that sets it to anything else. The app's own
  version stays the three-part `0.1.0`.
- **No `<uap:DefaultTile>`.** It requires `Wide310x150Logo.png`, which
  `icons/` does not have. A dangling asset reference fails WACK's "Application
  manifest resources" check — a failure about our packaging that would be
  indistinguishable in the report from the WebView2 one we are hunting.

## Signing

Microsoft **re-signs Store packages for free**, so a real submission needs no
purchased certificate. The self-signed certificate here exists only because an
MSIX must be signed by something for Windows to open it, and WACK deploys the
package in order to test it. It is generated on the runner, valid for a fake
publisher, and destroyed with the VM.

## Known risk: the runner may not be able to run WACK at all

`windows-latest` is Windows Server 2025 with a single Windows SDK
(10.0.26100.0). The App Certification Kit is a separate SDK **feature**
(`OptionId.WindowsSoftwareLogoToolkit`), and neither `appcert` nor that option
id appears anywhere in `actions/runner-images` — so it is probably absent. The
workflow installs the feature when the search comes up empty.

Beyond that, Microsoft documents that WACK "must be run within the context of an
active user session" and "cannot be run in Session0" — and a hosted runner's
agent is a service. The newer UWP documentation says the kit "can now be
integrated into an automated testing where no interactive user session is
available", so the two pages disagree. The workflow logs its session id before
invoking the kit, so if this is the blocker the log says so rather than leaving
a mystery.

Either way the outcome is a red job reading `WACK COULD NOT RUN`, which is an
environment result — **not** a verdict on the app.

## When this has answered, delete it

Delete `.github/workflows/msix-wack-spike.yml`, this file, and
`apps/light/src-tauri/msix/`. A manually-triggered experiment left lying around
becomes a workflow nobody runs and nobody trusts. Record the answer in the L-95
issue.
