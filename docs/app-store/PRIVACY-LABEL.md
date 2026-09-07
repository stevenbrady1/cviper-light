# App Privacy questionnaire — CViper Light

App Store Connect → App Privacy. Apple asks one question, then a form. This is
the answer to each, and the test in this repository that proves it.

## The one question

> **Do you or your third-party partners collect data from this app?**

**No.** The resulting label is **Data Not Collected**.

## Why "no" is the honest answer

Apple's definition of "collect" is transmitting data off the device in a way
that is accessible to the developer or to the developer's third-party partners
(analytics, advertising, SDK vendors). CViper Light:

| Fact                                                                                 | Proof in the repository                                                                 |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Has no server of ours; no address it can contact belongs to us                       | `apps/light/src/lib/outbound-hosts.ts` + `outbound-hosts.contract.test.ts`              |
| Has no analytics, crash-reporting or session-recording SDK, in either language       | `no-analytics-dependencies.contract.test.ts` (npm + Cargo, transitively)                |
| Has no API key of ours compiled in, so no request can be billed to us or identify us | `no-baked-in-key.contract.test.ts` + gitleaks over the built bundle in CI               |
| Makes no request on launch, and none the user did not start                          | `telemetry.contract.test.ts`, `noAutoCheck.test.ts`, `privacy-promise.contract.test.ts` |
| Stores CV text, jobs and applications only in the on-device database                 | `dataLocations.ts`; the wipe in `db/wipe.ts`                                            |
| Stores API keys only in the OS credential store, unreadable from the page            | `secrets.rs` (no `secret_get` command), `secret_get_is_not_exposed_to_javascript`       |

### The one thing to be clear about with the reviewer

A user may paste their **own** OpenAI or Anthropic key and then press
"Analyse". The CV text goes to that provider, under the user's own account,
by the user's explicit action each time. Those providers are not our partners
— we have no agreement, no account and no key with them; the user does — and
we receive nothing from the exchange. That is why the answer is still "no".

If App Review pushes back, the fallback declaration that is still true is:

- **Data type:** User Content → "Other User Content" (the CV text)
- **Use:** App Functionality
- **Linked to the user's identity:** No
- **Used for tracking:** No
- with the note that it is sent only to a service the user chose and holds
  their own account with, only when they press the button, and never to us.

Do not declare anything under Contact Info, Identifiers, Usage Data,
Diagnostics or Location. None of it is collected by anyone.

## Privacy policy URL

Required even for "Data Not Collected". Enter:

```
https://cviper.ai/light/privacy
```

The page is `privacy-policy.md` in this folder, generated from the app's own
host registry (see `README.md`).

## Tracking

> **Does this app use data for tracking?**

**No.** There is no advertising, no attribution SDK, no fingerprinting, and
`App Tracking Transparency` is not needed because nothing is tracked. Do not
add `NSUserTrackingUsageDescription` to `Info.ios.plist` — its presence would
tell Apple the app tracks.

## Age rating

Every question **None** / **No**: no violence, no mature themes, no gambling,
no unrestricted web access (the app opens links in the user's own browser and
never loads a page itself), no user-generated content shared with others.
Result: **4+**.
