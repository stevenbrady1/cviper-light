# App icon

`cviper-icon-1024.png` is the source every icon in `src-tauri/icons/` (and the
Microsoft Store set in `src-tauri/icons/msix/`) is generated from. It is checked
in so the set can be regenerated without hunting for the original.

## Where it comes from (L-184)

Since L-184 CViper Light uses **CViper's own mark** — the navy badge with three
rising teal bars — rather than a Light-only icon. `cviper-mark.svg` here is a
byte-for-byte copy of CViper's `frontend/public/cviper-mark.svg` (the same file
cviper.ai serves as `logo.svg`). The sidebar draws the same artwork inline
(`src/app/CViperMark.tsx`), and `CViperMark.source.test.tsx` fails if its bars
or colours ever stop matching this SVG.

The PNG was rendered from the SVG at 1024 × 1024 in Chromium with a transparent
background, so the badge's rounded corners are transparent:

```
svg width/height 512 -> 1024, rendered with Playwright, omitBackground: true
```

To change the logo, replace `cviper-mark.svg`, re-render the PNG the same way,
then regenerate everything below and update `CViperMark.tsx` to match.

## Regenerating

```
pnpm --filter @cviper/light tauri icon branding/cviper-icon-1024.png
```

It rewrites every file in `src-tauri/icons/`, and creates `icons/android/` and
`icons/ios/`. `icons/ios/` is KEPT since L-80/L-84: the iOS project generated
by `tauri ios init` takes its app icon set from it, and
`AppIcon-512@2x.png` (1024 × 1024, fully opaque) is the App Store marketing
icon. Generate it with the brand navy behind it, because an iOS icon may carry
no transparency:

```
pnpm --filter @cviper/light tauri icon branding/cviper-icon-1024.png --ios-color "#0f2044"
```

`icons/android/` is still deleted until there is an Android target (L-86).

Then regenerate the Store set from the same source:

```
pnpm assets:msix
```

`tauri.conf.json` names only five of the generated files. The rest are used by
the Windows Store packaging targets and are generated for completeness.
