# Submitting CViper Light to the Microsoft Store

Everything the submission needs, in the order Partner Center asks for it, so it
is a copy-and-paste job rather than an afternoon of reading policy.

**Who this is for:** the account holder. Every step below is a human step.
Nothing in this repository can enrol an account, reserve a name or press submit.

---

## Why the Store, and why there is no alternative on Windows

A Windows installer downloaded from a web page shows a SmartScreen warning
until it has built up reputation. Getting rid of that warning normally means
buying a code-signing certificate, at roughly £120–250 a year.

The Microsoft Store is the free way round it, because **the Store re-signs what
it accepts** with a Microsoft certificate. That applies to MSIX packages only.
Three things follow, and they are the reason this document exists:

- **The Store does not re-sign an `.msi` or `.exe`.** Policy 10.2.9 requires a
  binary submitted that way to be signed by a certificate chaining to the
  Microsoft Trusted Root Program. A self-signed one is rejected.
- **Azure Artifact Signing — the cheap managed-certificate route — is not
  available.** It admits individual developers in the USA and Canada only.
- **Buying a certificate would not fix day one anyway.** Extended-validation
  certificates stopped granting instant SmartScreen reputation in 2024.
  Reputation now accrues over several weeks and hundreds of clean installs,
  and there is no way to ask for it to be granted early.

> **Record this plainly: the Store is the only route to a warning-free FIRST
> download.** A signed direct `.exe` would still warn the first people who
> tried it, for weeks. That is not an argument the Store is better; it is the
> reason there is no second option for Windows unless a certificate is bought.

---

## Step 1 — Enrol as an INDIVIDUAL developer

Go to **<https://storedeveloper.microsoft.com>** and press **Get started for
free**. That address is the only entry point to the free flow — reaching
Partner Center any other way lands on the old, paid one.

Choose **Individual developer**.

| What you need      | Detail                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Fee                | **None.** The old $19 registration fee is waived in this flow.                                        |
| Identity           | A **government-issued ID and a selfie**. Photograph the original document, on a phone, in good light. |
| Sign-in            | A Microsoft account. Use one you will still have in five years.                                       |
| After verification | You are taken to the Partner Center dashboard. If it does not appear, wait five minutes and refresh.  |

### Three things that cannot be undone

Read these before pressing anything. All three are one-way doors.

1. **The country or region cannot be changed later.** Choose the one you
   actually live in.
2. **An individual account cannot be converted to a company account.** If the
   product ever needs a company account, that means a second account and a
   fresh submission.
3. **A company account needs a real registered business entity** — a legal name
   and a company number. That is why individual was chosen here; there is
   nothing to incorporate.

### The one policy that decides the whole listing

**Policy 10.8.3**: a product from an individual account _"cannot require
financial information for primary functionality"_, and Microsoft's own list of
what counts as financial information includes **API secret keys**.

CViper Light clears this honestly rather than narrowly — the tracker, the
keyword match, the deterministic checks and the keyless board links genuinely
need no key at all. Since L-110 the strongest part of that case is that
**finding a job inside the app needs no key either**: two free feeds are read
with no key and no account. Job discovery is about as close to "primary
functionality" as this app has, so say it in the listing rather than leaving a
reviewer to infer it from a bullet about browser links. But clearing it is a **standing constraint on the listing**,
not a box already ticked: the description, the screenshots and the first
paragraph must lead with what works with no key, and present the AI lane as an
optional extra the user pays OpenAI for directly. The copy in Step 7 is written
that way. Do not reorder it.

---

## Step 2 — Reserve the name

Partner Center → **Apps and games** → **New product** → **MSIX or PWA app**.

Reserve **`CViper Light`**. If it is taken, reserve a variant and use the same
string everywhere below — the reserved name is what appears in the Store.

---

## Step 3 — Set the publisher display name to YOUR OWN NAME

Partner Center → **Account settings** → **Publisher display name**.

**Use the owner's own personal name. Not "CViper".**

**Policy 10.14** requires a company account where _"a reasonable consumer would
interpret your application or publisher name to be that of a business entity"_.
"CViper" reads as a business. A personal name does not, and it is the name an
individual account is for.

This is the name shown on the Store listing under the app title. It is separate
from the app's own name, which stays `CViper Light`.

---

## Step 4 — Build the package

Actions → **MSIX (Microsoft Store)** → **Run workflow**, leaving
_Run the Windows App Certification Kit_ on.

It builds the Store flavour of the app, packs it as an `.msix`, runs the
certification kit over it, and uploads everything as the run artefact
`cviper-light-msix`. Download that artefact; the `.msix` inside is the file
Partner Center wants.

**Read the job summary before going further.** It reports the kit's overall
result. An overall `FAIL` turns the run red and that package must not be
submitted. An overall `PASS` with one _optional_ failure listed is the expected
outcome — see "What is proven" at the end of this document for what that one is
and why it is stated rather than ignored.

### What is in the package, and what is deliberately not

- The application executable and the Store icon set. Nothing else.
- **No updater.** An installed MSIX's files are read-only, so the in-app update
  check cannot work there — Windows and the Store replace the whole package
  instead. The Store build is compiled with the plugin removed entirely, and
  the app's Settings → Updates section says _"On this device, updates come from
  the Microsoft Store"_ rather than offering a button that would fail.
- No analytics, no crash reporting, no account, and no API key of ours.

---

## Step 4a — Install the package once, on a real PC

The certification kit in Step 4 never opens the app. Its own report says
_"Running tests without application deployment"_: it reads the package, it does
not run it. So a package can pass every check in Step 4, be reported overall
**PASS**, and still fail to draw a window — and until somebody installs it,
nobody knows which.

This is the test that finds out. The owner does it once, on a real Windows PC,
and it takes about ten minutes.

### What it proves, and what it does not

**It proves the package installs and the app opens and can be used.** That is
the one question CI cannot answer, and the one the certification kit explicitly
did not ask.

**It does not prove the Store will accept the submission.** The certification
kit is a local approximation of the Store's gate rather than the gate itself,
and this test is not even that — it is one PC installing one package. Only a
real submission settles certification.

### Three things to know before you start

**The `.cer` and the `.msix` have to come from the SAME run.** The certificate
is generated fresh on every run of the workflow, so one run's certificate cannot
vouch for another run's package. Mix them and the install fails with a signature
error that reads exactly like a broken package. It is not a broken package; it
is a mismatched pair. Take both files from one run, and do not keep an old
`.cer` to reuse.

**A run from before the certificate change has no `.cer` at all, and cannot be
installed.** The public half of the signing certificate is only in the artefact
for runs made after
[#84](https://github.com/stevenbrady1/cviper-light/pull/84) merges. If the
artefact you downloaded holds only the `.msix`, the manifest and the
certification report, stop: nothing on your PC trusts that package's signer and
no amount of retrying will change that. Re-run the workflow and use the new
artefact.

**`Add-AppxPackage -AllowUnsigned` is a dead end — do not spend an hour on it.**
That switch is for genuinely _unsigned_ packages, which say so by carrying a
special OID marker in `Identity/Publisher`. This package is signed, and its
`Identity/Publisher` is the real Store publisher `CN=F08F8DD5-…` from Step 5.
Building an OID-marked variant to get round the problem would install a
different identity from the one being submitted, which answers a different
question from the one being asked.

### Do it

Everything below runs in **PowerShell opened as administrator** — right-click
the Start button → **Terminal (Admin)**, or right-click PowerShell → **Run as
administrator**. Trusting a certificate for the machine and installing a package
both need it, and both fail with a bare "access denied" without it.

**1. Get the artefact.** Actions → **MSIX (Microsoft Store)** → the run you want
→ download `cviper-light-msix` and unzip it somewhere short, such as
`C:\msix-test`. Open the administrator PowerShell in that folder. Two files
matter: `CViperLight-store.msix` and `devcert-public.cer`.

**2. Trust this run's signer.** This tells Windows you accept the certificate
that signed this package. The file holds the public half only — there is no
private key in it, and the workflow reads it back to prove that before
uploading.

```powershell
Import-Certificate -FilePath devcert-public.cer -CertStoreLocation Cert:\LocalMachine\TrustedPeople
```

A good result: one line naming the certificate, with a thumbprint. **Copy that
thumbprint somewhere now** — you need it to undo this at the end. It is also
printed in the workflow run's job summary, under "Installing this package for
the one-time open test".

**3. Install the package.**

```powershell
Add-AppxPackage -Path CViperLight-store.msix
```

A good result: nothing at all. PowerShell just returns to the prompt. An error
mentioning a signature or a certificate nearly always means the two files came
from different runs — go back to the top of this section.

**4. Open it and use it.** Start menu → **CViper Light**. A good result: the
window opens, the introduction appears, you can dismiss it, go to Analysis, pick
a PDF, paste some advert text and press Check. Spend a minute clicking around.
This is the entire point of the exercise — a package that installs and then
fails to draw a window is exactly what Step 4 could not have told you.

### Clean up — this part is not optional

Two things are now on your machine that should not stay there: the app, and a
self-signed certificate that your PC has been told to trust. The certificate is
the one that matters. While it sits in `LocalMachine\TrustedPeople`, this PC
will accept anything signed with it, and the private half of it lived on a build
runner belonging to a public repository. Leaving it behind is a worse end state
than never having run the test at all.

**Remove the app.**

```powershell
Get-AppxPackage StBr.CViperLight | Remove-AppxPackage
```

A good result: no output, and the Start menu entry is gone.

**Remove the certificate by its THUMBPRINT.** Put the thumbprint from step 2 in
place of `<thumbprint>`.

```powershell
Remove-Item -Path Cert:\LocalMachine\TrustedPeople\<thumbprint>
```

A good result: no output.

> **Never remove it by subject name.** The workflow generates the development
> certificate with `winapp cert generate --manifest`, which takes the subject
> straight from the manifest — so this throwaway certificate carries the **same
> `CN=F08F8DD5-FEF4-41DC-84E4-37C56C36B399` as the real Store publisher**. A
> tidy-up that matched on that `CN=` would look perfectly reasonable and could
> later delete something legitimate that shares it. A thumbprint is the hash of
> one specific certificate and nothing else. It is the only safe handle.

**Check it is really gone.**

```powershell
Get-ChildItem Cert:\LocalMachine\TrustedPeople | Where-Object Thumbprint -eq '<thumbprint>'
```

A good result: nothing is printed. If a line comes back, the certificate is
still trusted and the clean-up is not finished.

---

## Step 5 — The identity fields in the manifest

This is the only code change a submission needs, and it can only happen **after**
Step 2, because Partner Center invents the values.

**It is already done.** The name has been reserved, and the three values Partner
Center issued are in
[`apps/light/src-tauri/msix/Package.appxmanifest`](../apps/light/src-tauri/msix/Package.appxmanifest)
on `main`. There is nothing to type here. Read the table, satisfy yourself that
Partner Center → your product → **Product identity** still shows the same three
strings, and go on to Step 6.

| Partner Center shows           | Lives in the manifest as                         | And now reads                             |
| ------------------------------ | ------------------------------------------------ | ----------------------------------------- |
| **Package/Identity/Name**      | `<Identity Name="…">`                            | `StBr.CViperLight`                        |
| **Package/Identity/Publisher** | `<Identity Publisher="…">`                       | `CN=F08F8DD5-FEF4-41DC-84E4-37C56C36B399` |
| **Publisher display name**     | `<PublisherDisplayName>…</PublisherDisplayName>` | `Steven Brady`                            |

`Identity/@Publisher` is case sensitive and has to match the reservation
character for character. `StBr` is the publisher id Partner Center issued, not
an abbreviation somebody chose — it must not be tidied into `StevenBrady`.

### If the name is ever re-reserved

A fresh reservation, a new product entry or a second account issues new values,
and then this becomes a live step again. Replace **all three or none** — a
half-filled identity looks finished, passes every other check, and is rejected
at upload.

A test in this repository (`apps/light/src/lib/msix-store-build.contract.test.ts`)
holds that line. It fails the build if the three fall out of step with each
other, and it also pins the shape of each value, so a field left blank, retyped
as an example or reverted to a placeholder goes red here rather than at Partner
Center.

### Two fields people look for here and will not find

**Package Family Name** and **Store ID** are **not manifest fields**. Partner
Center derives both from the identity above. Nothing is pasted back in.

### The version's fourth number must be 0

`Version="0.1.0.0"`, not `Version="0.1.0"`. MSIX versions are four-part and the
Store **reserves the fourth number** for its own use; a package that sets it to
anything else is rejected at upload. The app's own version stays the three-part
`0.1.0` in `tauri.conf.json` — the trailing `.0` belongs in the manifest and
nowhere else.

**A package built before the identity landed cannot be uploaded.** The three
values were merged on 13 September 2026
([#76](https://github.com/stevenbrady1/cviper-light/pull/76)), so submit a
package from a Step 4 run made after that date, and throw away any older `.msix`
still sitting on your disk. The same applies if the identity is ever changed
again: commit it, re-run Step 4, and upload the package that run produced.

---

## Step 6 — Upload the package

Partner Center → your product → **Submissions** → **Packages** → drag the
`.msix` in.

Device family: **Windows 10/11 Desktop**. Nothing else is supported — this is a
desktop application, not a UWP one.

If the upload is rejected, the message names which identity field disagrees with
the reservation. That is Step 5 done wrong, not a build problem.

---

## Step 7 — Store listing

### Name

```
CViper Light
```

### Short description (up to 500 characters)

```
Make every application count. CViper Light keeps your job hunt in one place on
your own computer: every application you have sent, what each advert actually
asked for, and how your CV reads against it. No account, no sign-up, and it
works the moment you open it.
```

### Description

> **Paste this as written.** The order is a policy requirement, not a style
> choice — see Step 1 on policy 10.8.3. Everything that needs no key comes
> first; the AI lane is an optional extra, after it, clearly marked as the
> user's own account with OpenAI.

```
Make every application count.

CViper Light keeps your job hunt in one place on your own computer: every
application you have sent, what each advert actually asked for, and how your CV
reads against it. There is no account to create and no server behind the app.
Your CVs and your applications stay on your own machine.

WORKS THE MOMENT YOU OPEN IT — NO KEY, NO SIGN-UP

• Track every application. A board of everything you are chasing, where each
  one has got to, and how long it has sat still — because age is what tells you
  who to chase next. Works with no internet connection at all.
• Check your CV against the advert. Paste the job description beside your CV
  and see which of its words you already use and which you are missing. It runs
  on your computer, instantly, offline.
• Read a PDF, a Word file or a JSON Resume, and save one back out again.
• Browse recent job adverts inside the app. Two free feeds are read straight
  from the web with no key and no account, and narrowed down on your own
  computer. It is a browse of what has just been posted rather than a search of
  the whole market, and each feed tells you on screen if it stops working.
• Search nine UK job boards in your browser with one click. Turn any of them
  off, put them in the order you use them, or add your own.
• Export everything to a single file whenever you like, and import it back.

IF YOU WANT AN AI SECOND OPINION — OPTIONAL, AND YOURS

• Add your own OpenAI key and a model will read your CV properly and explain
  itself. You pay OpenAI directly, under your own account. We do not supply a
  key, we do not stand in the middle, and we receive nothing.
• Or run a free model on your own machine with Ollama, in which case your CV
  does not go anywhere at all.
• Add your own free Adzuna or Reed key and the same screen searches those two
  boards properly as well — a full search rather than the recent-postings
  browse, which needs no key and is there either way.

None of the features above this section need any of that.

WHAT IT NEVER DOES

• It never asks you to sign up.
• It never sends anything to us. There is no "us" to send it to: no server, no
  analytics, no crash reporting.
• It never contacts a service you did not press a button for. Settings →
  Privacy lists every address the app is allowed to name, and a test in the
  public source code fails the build if another one is added.

CViper Light is free and open source under the MIT licence.
```

### Product features (up to 20, short lines)

```
Track every application in one place, with no account
Check your CV against a job advert on your own computer
Browse recent job adverts in the app with no key and no account
Nine UK job boards, one click, no key needed
Reads PDF, Word and JSON Resume files
Export and import everything as one file
Optional: bring your own OpenAI key, or run a model locally with Ollama
No telemetry, no analytics, no crash reporting
Open source under the MIT licence
```

### Search terms (up to 7)

```
cv
resume
ats
job tracker
job search
cv checker
applications
```

### Category

**Productivity**, with **Business** as the secondary category.

### Support and website

| Field                | Value                                                 |
| -------------------- | ----------------------------------------------------- |
| Support contact info | `https://github.com/stevenbrady1/cviper-light/issues` |
| Website              | `https://cviper.ai/light`                             |

---

## Step 8 — Privacy policy URL

```
https://cviper.ai/privacy/
```

**That page must be live before you submit.** It is added by a pull request in
the landing-site repository; check the URL in a browser and see the policy
before pasting it here. A privacy policy URL that 404s is a certification
failure, and it is one of the slowest to get resolved because the reviewer
simply marks the submission incomplete.

A privacy policy is required even though the app collects nothing: policy 10.5.1
requires one from any product that _can_ access personal information, and
explicitly names Win32 and Desktop Bridge products.

---

## Step 9 — Age rating

Partner Center runs the IARC questionnaire. Answer **no** or **none** to every
question. There is no violence, no mature content, no gambling, no in-app
purchase, no user-generated content shared between users, and no unrestricted
web browsing — the app hands links to the user's own browser and does not load
pages itself.

The expected result is the lowest rating in each region (PEGI 3 / ESRB
Everyone).

---

## Step 10 — The generative-AI declaration

**Policy 11.16 applies**, because the optional AI analysis produces dynamic
content from a live generative model in response to what the user supplies. It
applies even though the feature is optional and even though the user brings
their own key.

The policy asks for four things. Three are declarations, one is a feature:

1. **Disclose the use of live generative AI in the metadata.** The description
   in Step 7 does this — the "IF YOU WANT AN AI SECOND OPINION" section.
2. **Note it in Partner Center during submission.** There is a question in the
   product-declarations page. Answer **yes**.
3. **Make sure AI output complies with Store policies.** Nothing is published
   or shared between users; the output is shown to the one person who asked for
   it.
4. **Provide a means for users to report inappropriate content to the
   developer, and act on what is reported.**

Point 4 is already built. **Settings → Report a problem** opens a pre-filled
issue on the app's public GitHub tracker in the user's own browser. It carries
two facts — the app version and which Windows and WebView2 are running — and
nothing else, and the user reads the whole thing and decides whether to send it.
That is the reporting route, it is one screen from the analysis output, and it
satisfies the requirement. Say so in the certification notes:

```
Reporting bad AI output: Settings -> Report a problem opens a pre-filled issue
on the app's public issue tracker in the user's own browser. Nothing is sent by
the app; the user reads and submits it themselves. Reports are read and acted on
there.
```

### Notes for certification (paste as written)

```
CViper Light needs no account and works with no API key. To try it: open the
app, dismiss the introduction, go to Analysis, select a CV (any PDF), paste some
text into the advert box and press Check. The basic match runs on the device
with no key and no network.

The app can optionally use an AI provider. That requires the user's OWN OpenAI
API key, which the user pastes into Settings; it is stored in Windows Credential
Manager and the request goes from the device to OpenAI under the user's own
account. We do not supply a key, we do not proxy the request and we receive
nothing. No key is needed to review any screen.

This is a packaged desktop (Win32) app. It declares runFullTrust and nothing
else. It contains no analytics or crash-reporting SDK and no automatic update
check — updates come from the Microsoft Store, and the in-app updater is not
compiled into this build at all. Settings -> Privacy lists every address the app
is allowed to contact. The source is public:
https://github.com/stevenbrady1/cviper-light
```

---

## Step 11 — Screenshots

**Four**, PNG, at least **1366 × 768**. Take them on a real Windows desktop at
1920 × 1080 and crop nothing.

Use sample data that is obviously sample — a CV for "Jane Smith", adverts for
made-up companies. **Never a real CV.**

| #   | Screen                                                        | Why it is first, second, third, fourth                                                                                                                     |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Analysis, with a result on screen**                         | The "what you have / what they asked for / what is missing" lists, run with **no key**. This is the shot that shows the product works with nothing set up. |
| 2   | **The tracker**, four or five applications across the columns | The other thing that needs no key, and the one people will use daily.                                                                                      |
| 3   | **Search**, showing the keyless board links                   | Nine boards, one click, no key.                                                                                                                            |
| 4   | **Settings → Privacy**, showing the generated address list    | The claim that nothing is collected, shown rather than asserted.                                                                                           |

The AI lane is deliberately **not** one of the four. A screenshot of a key-entry
screen would be the first thing a reviewer sees, and the listing's whole
compliance position is that keys are optional.

---

## Submission checklist

- [ ] Enrolled as an **individual** developer at `storedeveloper.microsoft.com`
- [ ] Country is correct (it cannot be changed later)
- [ ] Publisher display name is **the owner's own name**, not "CViper"
- [ ] Name `CViper Light` reserved
- [ ] `https://cviper.ai/privacy/` is **live** and shows the policy
- [ ] Identity: all three fields pasted from Product identity; version ends `.0`
- [ ] MSIX rebuilt **after** the identity was pasted, and downloaded from CI
- [ ] Certification kit reported overall **PASS** in the run summary
- [ ] Step 4a done: the package installed on a real PC, the window opened, **and
      the app and the certificate were both removed again**
- [ ] Description pasted **in the order given** — keyless features first
- [ ] Four screenshots uploaded, PNG, ≥ 1366 × 768, no real CV in any of them
- [ ] Age rating questionnaire completed, all answers none/no
- [ ] Generative-AI declaration answered **yes**
- [ ] Certification notes pasted

---

## Accepted open risk — not a solved problem

**Policy 10.14** says company accounts must be used by _"any person acting in
relation to their trade or profession"_, and individual accounts are for _"a
single developer working on their own"_.

CViper Light is free, open source, sells nothing and has no in-app purchase.
It does carry an optional one-line link out to a paid hosted product owned by
the same person, at cviper.ai — shown in three places, opened only in the user's
own browser when they tap it.

**Whether that link makes the submission "in relation to a trade or profession"
is not settled, and nothing in this repository settles it.** It is recorded here
as an accepted risk rather than a cleared one, so that if the Store ever raises
it nobody has to reconstruct whether it was seen coming. The realistic
consequence, if raised, is being asked to move to a company account — which
would mean incorporating first, and a fresh account, because individual accounts
cannot be converted.

**UPDATE, 13 September 2026 (L-114).** The two paragraphs above are kept as
written, because they record what was believed at the time. What they describe
no longer exists. The hosted service they call a paid product was mothballed on
10 September 2026 and its infrastructure deleted; there is nothing at cviper.ai
to buy, subscribe to or sign into. The address now serves this app's own site:
its download page and its privacy policy.

What remains true today is smaller than what the paragraphs above weighed. The
app hands out only its own addresses — a single line in Settings → Privacy that
opens `https://cviper.ai/privacy/`, this app's own generated policy — plus the
About entry naming where it was made and linking to its page and its
MIT-licensed source. All of them are this free app's own pages. Nothing is sold anywhere,
by anyone, at any point.

The 10.14 question is therefore narrower than it was when it was written: it is
no longer "does a link to a paid product make this a trade", but "does a free
app linking to its own website make this a trade". That is still not settled
here, and it is still recorded rather than cleared — but the exposure is
smaller, not larger, than the assessment above assumed.

---

## What is proven, and what a submission is still needed to find out

**Proven, by CI:**

- A **real `tauri build` artefact** packs as an MSIX. (The earlier L-95 spike
  proved only that a bare `cargo build --release` binary did. The file anybody
  would actually submit had never been packaged until this workflow existed.)
- The Store flavour contains no updater — asserted against the resolved cargo
  dependency graph, in both directions, immediately before packaging.
- Every icon the manifest names exists at exactly its declared pixel size.

**Expected, and stated rather than hidden:** the certification kit reports
overall **PASS** with one **optional** failure, _"Blocked executables"_. It
originates in WebView2, reproduces on release builds, and is
[`tauri-apps/tauri#14935`](https://github.com/tauri-apps/tauri/issues/14935).
Microsoft documents that the Store _"may apply all tests from this workflow"_, so
an optional failure is a submission risk to be aware of, not a non-event.

**Not proven, and not provable from here:**

1. **Whether the Store's own gate accepts it.** The certification kit is a
   local approximation of that gate, not the gate. Only a real submission
   settles it.
2. **Whether the packaged app RUNS.** The kit analyses the package statically
   — its own report says _"Running tests without application deployment"_.
   Nothing in CI has installed the MSIX and opened the window. **Step 4a** is
   the one-off human test that does, and it is the only thing that answers this.
3. **arm64.** Only x64 is built and tested.
4. **The account-type question above.**
