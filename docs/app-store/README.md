# App Store kit (L-84)

Everything the App Store Connect listing for **CViper Light** needs, in one
place, so the submission is a copy-and-paste job and not an afternoon of
remembering.

| File                                            | What it is                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`LISTING.md`](LISTING.md)                      | Name, subtitle, description, keywords, URLs, category, age rating, review notes, what's new |
| [`PRIVACY-LABEL.md`](PRIVACY-LABEL.md)          | The App Privacy questionnaire, answer by answer, with the test that proves each one         |
| [`privacy-policy.md`](privacy-policy.md)        | The privacy policy page. **Generated** — see below                                          |
| [`SCREENSHOTS.md`](SCREENSHOTS.md)              | Which screens, which sizes, the captions, and the script that captures them                 |
| `../../apps/light/src-tauri/RELEASE-SIGNING.md` | The human steps: team, certificate, TestFlight, upload                                      |

## The policy is generated

`privacy-policy.md` is rendered from `lib/outbound-hosts.ts` and
`dataLocations.ts` by `policyDocument.ts` — the same registry the app's
Settings → Privacy screen shows and that `outbound-hosts.contract.test.ts`
holds the code to. `policyDocument.test.ts` keeps this file byte-identical to
the render, so it cannot say something the app does not do. When a host or a
storage location changes:

```
npx vitest run apps/light/src/features/settings/privacy/policyDocument.test.ts -u
```

and commit the regenerated file with the change. The hosted site publishes it
at `cviper.ai/light/privacy` (CV-1394), which is the URL App Store Connect
asks for.

## Order of work

1. `LISTING.md` → App Store Connect → App Information and the version page.
2. `PRIVACY-LABEL.md` → App Privacy. Every answer is "no".
3. `SCREENSHOTS.md` → capture on the simulator, upload.
4. `RELEASE-SIGNING.md` → the signed build, TestFlight, then review.
