/**
 * The Microsoft Store's visual assets: what they are called, how big they are,
 * and which shape of the source icon each one is cut from.
 *
 * ============================================================================
 * WHY THIS IS A TABLE AND NOT A FOLDER SOMEBODY FILLED IN BY HAND
 * ============================================================================
 * `Package.appxmanifest` names SIX images. Windows then resolves each of those
 * names to one of many real files, using the display scale and the context it
 * is drawing in — `Square44x44Logo.png` in the manifest becomes
 * `Square44x44Logo.scale-200.png` on a 200% display and
 * `Square44x44Logo.targetsize-16_altform-unplated.png` in the system tray.
 *
 * The failure that produces is silent: a missing variant is not an error, it is
 * Windows quietly scaling a different file, and the icon simply looks wrong on
 * somebody else's machine. Nothing in a build catches it, and nobody counting
 * thirty-two files by eye catches it either.
 *
 * So the set is DATA, the images are GENERATED from it by
 * `generateMsixAssets.ts`, and `msixAssets.contract.test.ts` holds the files on
 * disk to it.
 *
 * ============================================================================
 * WHY SOME SCALES ARE DELIBERATELY ABSENT
 * ============================================================================
 * The source artwork is 1024x1024. The 400% variants of the two large tiles
 * would be 1240px, which is bigger than the source — so producing them means
 * ENLARGING the icon, and an enlarged icon is worse than an absent one: Windows
 * already handles a missing large asset by scaling the next size down, and it
 * does so from a sharp original rather than from a blurred intermediate.
 *
 * `downscale()` refuses to enlarge for that reason, so this is not a rule
 * somebody has to remember. Adding those rows makes the generator throw.
 *
 * Microsoft's stated minimum — 100%, 200% and 400% for `Square44x44Logo` and
 * `Square150x150Logo`, plus the target-size variants — is met in full.
 */

/** Where the generated files live, relative to the repository root. */
export const MSIX_ASSET_DIRECTORY = 'apps/light/src-tauri/icons/msix';

/** The square artwork every asset is cut from, relative to the repository root. */
export const MSIX_ASSET_SOURCE = 'apps/light/branding/cviper-icon-1024.png';

/** The folder name the manifest addresses assets through, inside the package. */
export const MANIFEST_ASSET_FOLDER = 'Assets';

export interface MsixAsset {
  /** File name, exactly as it must appear on disk and in the package. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** `wide` assets letterbox the square artwork; `square` assets fill it. */
  readonly shape: 'square' | 'wide';
  /** What Windows draws this one in. One line, for the generator's output. */
  readonly why: string;
}

interface LogoSpec {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly scales: readonly number[];
  readonly why: string;
}

/**
 * The six images the manifest names, and the scale factors generated for each.
 *
 * `StoreLogo` is 50x50 rather than a round number because that is the size the
 * Store's own listing uses; it is not derived from its name like the others.
 */
const LOGOS: readonly LogoSpec[] = [
  {
    name: 'Square44x44Logo',
    width: 44,
    height: 44,
    scales: [100, 200, 400],
    why: 'the app-list icon: taskbar, Start, search results',
  },
  {
    name: 'Square71x71Logo',
    width: 71,
    height: 71,
    scales: [100, 200, 400],
    why: 'the small Start tile',
  },
  {
    name: 'Square150x150Logo',
    width: 150,
    height: 150,
    scales: [100, 200, 400],
    why: 'the medium Start tile, required to publish',
  },
  {
    name: 'StoreLogo',
    width: 50,
    height: 50,
    scales: [100, 200, 400],
    why: 'the Store listing, required to publish',
  },
  {
    // 400% would be 620px: still under the 1024px source, so it is generated.
    name: 'Square310x310Logo',
    width: 310,
    height: 310,
    scales: [100, 200],
    why: 'the large Start tile (400% omitted: 1240px exceeds the source)',
  },
  {
    name: 'Wide310x150Logo',
    width: 310,
    height: 150,
    scales: [100, 200],
    why: 'the wide Start tile (400% omitted: 1240px exceeds the source)',
  },
];

/**
 * Exact pixel sizes Windows asks the app-list icon for by name rather than by
 * scale factor — the tray, context menus, the taskbar, Alt-Tab.
 *
 * Microsoft's documented bare minimum is 16, 24, 32, 48 and 256.
 */
const TARGET_SIZES: readonly number[] = [16, 24, 32, 48, 256];

/** The app-list icon, which is the one that gets target-size variants. */
const APP_LIST_LOGO = 'Square44x44Logo';

function scaled(value: number, scale: number): number {
  return Math.round((value * scale) / 100);
}

function buildAssets(): MsixAsset[] {
  const assets: MsixAsset[] = [];

  for (const logo of LOGOS) {
    const shape = logo.width === logo.height ? 'square' : 'wide';

    // ----------------------------------------------------------------------
    // THE UNQUALIFIED NAME IS GENERATED TOO, AND IT IS NOT REDUNDANT.
    // ----------------------------------------------------------------------
    // It is the name the manifest actually contains. With a `resources.pri` in
    // the package, Windows resolves that name to whichever qualified variant
    // fits — but if PRI generation is ever skipped, or a tool packs the folder
    // without indexing it, the literal file is what gets drawn. Shipping only
    // `.scale-100` would make that case a dangling reference, which fails the
    // certification kit's manifest-resources check rather than falling back.
    assets.push({
      file: `${logo.name}.png`,
      width: logo.width,
      height: logo.height,
      shape,
      why: `${logo.why} - the unqualified name the manifest carries`,
    });

    for (const scale of logo.scales) {
      assets.push({
        file: `${logo.name}.scale-${scale}.png`,
        width: scaled(logo.width, scale),
        height: scaled(logo.height, scale),
        shape,
        why: `${logo.why}, at ${scale}% display scale`,
      });
    }
  }

  for (const size of TARGET_SIZES) {
    assets.push({
      file: `${APP_LIST_LOGO}.targetsize-${size}.png`,
      width: size,
      height: size,
      shape: 'square',
      why: `the app-list icon at exactly ${size}px, on a system backplate`,
    });

    // ----------------------------------------------------------------------
    // THE UNPLATED COPY IS THE SAME PIXELS AND A DIFFERENT PROMISE.
    // ----------------------------------------------------------------------
    // Microsoft: "If you do not include the targetsize-*-altform-unplated
    // assets your icon will scale to a smaller size and will get an undesirable
    // backplate behind the icon on Taskbar and Start."
    //
    // The artwork already sits on its own opaque badge (see
    // `branding/README.md`), so a second plate behind it is pure disfigurement.
    // The file contents are identical to the plated variant by design: what the
    // `_altform-unplated` name buys is Windows agreeing not to draw the plate,
    // not a different picture.
    assets.push({
      file: `${APP_LIST_LOGO}.targetsize-${size}_altform-unplated.png`,
      width: size,
      height: size,
      shape: 'square',
      why: `the app-list icon at exactly ${size}px, with no system backplate`,
    });
  }

  return assets;
}

/** Every file `generateMsixAssets.ts` writes and the contract test checks. */
export const MSIX_ASSETS: readonly MsixAsset[] = buildAssets();

/**
 * Every `Assets\Something.png` the manifest names, as bare file names.
 *
 * Deliberately lexical, matching the house style of the repository's other
 * guards: the shape being read is an attribute value, and an XML parser would
 * buy nothing but a dependency. Backslash is the separator MSIX manifests use;
 * a forward slash is accepted too so a hand-edit cannot silently stop matching.
 */
export function assetsNamedIn(manifestXml: string): string[] {
  const found = [
    ...manifestXml.matchAll(
      new RegExp(String.raw`${MANIFEST_ASSET_FOLDER}[\\/]([A-Za-z0-9._-]+\.png)`, 'g'),
    ),
  ].map((match) => match[1] ?? '');

  return [...new Set(found)].sort();
}

/**
 * The size a file name CLAIMS, worked out from the name alone.
 *
 * A second opinion, independent of the table above: `Square150x150Logo` says
 * 150, `.scale-200` doubles it, `.targetsize-32` overrides it outright. The
 * contract test compares this against the table so a typed-in row that
 * disagrees with its own file name cannot pass unnoticed.
 *
 * Returns `null` for a name this convention does not cover, which the caller
 * treats as "unrecognised" rather than "fine".
 */
export function sizeClaimedByName(file: string): { width: number; height: number } | null {
  const base = file.replace(/\.png$/i, '');
  const [logo = '', ...qualifiers] = base.split('.');

  const targetSize = qualifiers
    .map((qualifier) => /^targetsize-(\d+)/.exec(qualifier)?.[1])
    .find((value) => value !== undefined);
  if (targetSize !== undefined) {
    const size = Number(targetSize);
    return { width: size, height: size };
  }

  const dimensions = /^(?:Square|Wide)(\d+)x(\d+)Logo$/.exec(logo);
  const baseWidth =
    dimensions === null ? (logo === 'StoreLogo' ? 50 : null) : Number(dimensions[1]);
  const baseHeight =
    dimensions === null ? (logo === 'StoreLogo' ? 50 : null) : Number(dimensions[2]);
  if (baseWidth === null || baseHeight === null) return null;

  const scale = qualifiers
    .map((qualifier) => /^scale-(\d+)$/.exec(qualifier)?.[1])
    .find((value) => value !== undefined);
  const factor = scale === undefined ? 100 : Number(scale);

  return { width: scaled(baseWidth, factor), height: scaled(baseHeight, factor) };
}
