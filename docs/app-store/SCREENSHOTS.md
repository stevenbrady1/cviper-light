# Screenshots — CViper Light

App Store Connect needs one set for the largest iPhone and, because the app
runs on iPad (`TARGETED_DEVICE_FAMILY 1,2`), one set for the largest iPad.
Apple scales the rest down from these.

| Device slot         | Simulator to use      | Pixels (portrait) |
| ------------------- | --------------------- | ----------------- |
| iPhone 6.9" display | iPhone 17 Pro Max     | 1320 × 2868       |
| iPad 13" display    | iPad Pro 13-inch (M5) | 2064 × 2752       |

The simulator produces exactly these sizes, so nothing is resized by hand.
If the installed Xcode names the devices differently, `xcrun simctl list
devicetypes` shows what is available; any device in the same size class works.

## The five shots, in order

1. **Analysis, result on screen** — a CV selected, an advert pasted, the
   "What you have / What they asked for" lists visible. Caption: _See what
   the advert wants that your CV does not say._
2. **Tracker** — four or five applications across the columns. Caption:
   _Every application, and how long each has sat still._
3. **Share sheet** — Files showing a PDF with "Open in CViper Light" in the
   sheet. Caption: _Open a CV from Files, Mail or Safari._
4. **Settings → Privacy** — the generated notice with the address list.
   Caption: _Every address the app can contact, listed. Nothing else._
5. **Search** — the keyless board links. Caption: _Nine UK job boards, one
   tap, no key._

Captions go in the marketing frame, not in the app: the screenshot is the
app as it is. Use sample data that is obviously sample (a CV for "Jane
Smith", adverts for made-up companies) — never a real CV.

## Capturing them

`apps/light/scripts/ios-screenshots.sh` boots the two simulators, installs
the unsigned simulator `.app` (the artefact from the `iOS` workflow, or a
local `tauri ios build --target aarch64-sim --no-sign`), launches it and
saves a screenshot each time you press Enter. It runs on a Mac only.

```
apps/light/scripts/ios-screenshots.sh path/to/CViper\ Light.app
```

Output: `docs/app-store/screenshots/<device>/<n>.png`. The folder is
gitignored — screenshots are uploaded to App Store Connect, not committed.
