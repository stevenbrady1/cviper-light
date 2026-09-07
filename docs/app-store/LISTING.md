# App Store listing — CViper Light

Copy for App Store Connect. UK English throughout; the store shows it as
written. Where the tone could go two ways, both are given — pick one and
delete the other before pasting.

## App Information

| Field              | Value                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Name               | `CViper Light`                                                                                                  |
| Bundle ID          | `com.cviper.light` (the `identifier` in `tauri.conf.json`)                                                      |
| SKU                | `cviper-light-ios`                                                                                              |
| Primary language   | English (UK)                                                                                                    |
| Primary category   | Business                                                                                                        |
| Secondary category | Productivity                                                                                                    |
| Content rights     | Does not contain, show or access third-party content                                                            |
| Age rating         | 4+ (see `PRIVACY-LABEL.md`)                                                                                     |
| Licence agreement  | Apple's standard EULA                                                                                           |
| Copyright          | `© 2026 Steven Brady`                                                                                           |
| Price              | Free. No in-app purchases. Nothing is sold inside the app, so there is nothing for Guideline 3.1.1 to apply to. |

### Subtitle (30 characters max)

Pick one:

- `Check your CV. Nothing sent.` (28) — quiet
- `Private CV checker & tracker` (28) — plain
- `Your CV, checked on your phone` (30) — warm

### Promotional text (170 characters, editable without a new build)

> Read your CV, match it to the advert, track every application — on your
> phone, with no account and nothing collected. Free, and the code is public.

## Description (4,000 characters max)

> Make every application count.
>
> CViper Light reads your CV, checks it against the job advert you paste in,
> tells you what is missing, and keeps track of every application you are
> chasing — and it does all of that on your phone. There is no account to
> create and no server behind the app. Apple's privacy label on this page says
> "Data Not Collected" because that is exactly what happens.
>
> WHAT IT DOES
>
> • Reads a PDF, a Word file or a JSON Resume — open one straight from Files,
> Mail or Safari with "Open in CViper Light".
> • Matches your CV to a job advert and shows what you have, what they asked
> for, and what is missing. The basic match needs no key, no sign-up and no
> internet.
> • Tracks every application: where it is, how long it has sat still, and
> what to do next.
> • Searches nine UK job boards in your browser with one tap, no key needed.
>
> IF YOU WANT MORE
>
> • Bring your own OpenAI or Anthropic key for a deeper analysis. The key is
> stored in your phone's Keychain and never shown to the app's screen. The
> request goes from you to them, under your account — we are not in the
> middle.
> • Bring your own free Adzuna or Reed key to search inside the app.
>
> WHAT IT NEVER DOES
>
> • It never asks you to sign up.
> • It never sends anything to us. There is no "us" to send it to: no server,
> no analytics, no crash reporting.
> • It never contacts a service you did not press a button for. Settings →
> Privacy lists every address the app is allowed to name — and a test in the
> public source code fails the build if another is added.
>
> TAKE IT WITH YOU
>
> Export everything to one file whenever you like. Import it on another
> device, or into the full CViper at cviper.ai when you want the same tools
> across every job you save, kept up to date for you.
>
> CViper Light is free, open source under the MIT licence, and made by the
> people behind cviper.ai.

## Keywords (100 characters max, comma-separated, no spaces after commas)

```
cv,resume,ats,cv checker,job tracker,job search,applications,private,offline,uk jobs,cover
```

(96 characters. Do not repeat words from the name or subtitle — Apple ignores
them.)

## URLs

| Field              | Value                                                 |
| ------------------ | ----------------------------------------------------- |
| Support URL        | `https://github.com/stevenbrady1/cviper-light/issues` |
| Marketing URL      | `https://cviper.ai/light` (CV-1394)                   |
| Privacy Policy URL | `https://cviper.ai/light/privacy` (CV-1394)           |

## App Review Information

**Sign-in required:** No. Leave the demo account fields empty and tick
"Sign-in not required".

**Contact:** Steve Brady, the developer account's phone and email.

**Notes for the reviewer** (paste as written):

> CViper Light needs no account and works fully offline. To try it: open the
> app, dismiss the introduction, go to Analysis, tap "Upload a CV" and pick
> any PDF from Files, paste some text into the advert box and tap "Check".
> The basic match runs on the device with no key.
>
> The app can optionally use an AI provider. That requires the user's OWN
> OpenAI or Anthropic API key, which the user pastes into Settings; the key
> is stored in the Keychain and the request is made from the device to that
> provider under the user's own account. We do not supply a key, we do not
> proxy the request and we receive nothing. No key is needed to review any
> screen.
>
> The app makes no network request on launch and none the user did not start
> by pressing a button. There is no analytics or crash-reporting SDK. Settings
> → Privacy lists every address the app is allowed to contact. The source is
> public: https://github.com/stevenbrady1/cviper-light

## Version information

**What's New in This Version** (first release):

> First release. Reads your CV, checks it against an advert, tracks your
> applications — on your phone, with no account and nothing collected.

**Build:** the TestFlight build uploaded per `RELEASE-SIGNING.md`.

**Version:** must match `tauri.conf.json` `version` and `backup.ts`
`APP_VERSION` (a test keeps those two aligned). Apple requires each submitted
version to be greater than the last; check the live value before changing it.

## EU Digital Services Act — trader status

App Store Connect → Agreements → the DSA trader question. Because the listing
links to a paid product (cviper.ai), the safe declaration is **trader**, which
publishes a contact address and phone or email on the EU storefront. Declaring
**non-trader** and later being judged a trader gets the app removed from the EU
storefront until fixed. This is a legal choice for the account holder, not a
technical one.

## TestFlight

1. Upload the signed build (`RELEASE-SIGNING.md`).
2. TestFlight → the build → **Test Information**: paste the reviewer notes
   above as "What to Test".
3. **External Testing** → create a group `Beta` → **Enable Public Link**.
   The link is what goes to the waitlist cohort (hosted H-60 / CV-1388).
4. The first external build needs Beta App Review; it uses the same notes.

## Submission checklist

- [ ] `LISTING.md` fields pasted; a subtitle chosen
- [ ] `PRIVACY-LABEL.md`: "Data Not Collected"; policy URL live
- [ ] Screenshots for 6.9" iPhone and 13" iPad uploaded (`SCREENSHOTS.md`)
- [ ] 1024×1024 icon present (`src-tauri/icons/ios/AppIcon-512@2x.png`, opaque)
- [ ] Age rating 4+; no IAP; no sign-in
- [ ] DSA trader status declared
- [ ] Build passed TestFlight external review
- [ ] Reviewer notes pasted
