# App icon

`cviper-icon-1024.png` is the source every icon in `src-tauri/icons/` was
generated from. It is checked in so the set can be regenerated without hunting
for the original.

## Where it came from, and why it is not the original file

The original artwork is **1024 x 1031** — seven pixels taller than it is wide.
`tauri icon` needs a square source, and given a rectangular one it either
refuses or stretches the artwork to fit, which is a distortion nobody notices at
32 x 32 and everybody notices on a desktop.

So the source was padded to square rather than cropped or squashed:

```
pad the canvas to 1031 x 1031, centred, transparent   # loses no pixels
resize to 1024 x 1024 with LANCZOS                    # no aspect change
```

Padding UP to the larger dimension and then scaling down means no part of the
artwork is cut off and nothing is stretched. The artwork already sits on its own
opaque rounded-square badge, so the transparent padding is not visible.

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

`tauri.conf.json` names only five of the generated files. The rest are used by
the Windows Store packaging targets and are generated for completeness.
