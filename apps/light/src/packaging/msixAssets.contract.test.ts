/**
 * The MSIX asset contract (L-93): every image `Package.appxmanifest` names
 * exists, at exactly the size it is declared to be.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * A missing or wrongly-sized Store asset does not fail a build. It fails the
 * Windows App Certification Kit's manifest-resources check at SUBMISSION time,
 * days later, or — worse — passes and simply looks wrong on somebody else's
 * display scale, which nothing anywhere will ever tell us about.
 *
 * There are thirty-two files and six manifest references. Counting them by eye
 * is not a check.
 *
 * ============================================================================
 * WHAT IT ADJUDICATES, AND WHAT IT CANNOT
 * ============================================================================
 * It reads the IHDR of every file, so it knows the real pixel dimensions rather
 * than trusting the name. It does NOT and cannot know whether the picture is
 * right: a 44x44 PNG of the wrong artwork passes here. That gap is closed one
 * level down, in `png.test.ts`, which refuses every image format the decoder
 * would otherwise mis-read — the only way a generated asset could be the right
 * size and the wrong picture.
 *
 * ============================================================================
 * IT CANNOT GO QUIETLY INERT
 * ============================================================================
 * Three floors, asserted before anything is adjudicated: the manifest names at
 * least six assets, the table holds at least thirty, and the directory on disk
 * is not empty. A scan that found nothing would otherwise report "no missing
 * assets" while inspecting an empty set, which is this repository's
 * most-repeated failure.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MSIX_ASSETS,
  MSIX_ASSET_DIRECTORY,
  assetsNamedIn,
  sizeClaimedByName,
} from './msixAssets.ts';
import { readPngHeader } from './png.ts';

/** The monorepo root: `apps/light/src/packaging` → four levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const MANIFEST_PATH = 'apps/light/src-tauri/msix/Package.appxmanifest';
const MANIFEST = readFileSync(join(REPO_ROOT, MANIFEST_PATH), 'utf8');

const ASSET_DIRECTORY = join(REPO_ROOT, MSIX_ASSET_DIRECTORY);
const ON_DISK = readdirSync(ASSET_DIRECTORY).filter((name) => name.endsWith('.png'));

/**
 * Microsoft's stated minimum, quoted: "At minimum, provide assets at 100%, 200%
 * and 400% scale for the `Square44x44Logo` and `Square150x150Logo` entries,
 * plus the target-size variants."
 */
const REQUIRED_SCALES: readonly string[] = [
  'Square44x44Logo.scale-100.png',
  'Square44x44Logo.scale-200.png',
  'Square44x44Logo.scale-400.png',
  'Square150x150Logo.scale-100.png',
  'Square150x150Logo.scale-200.png',
  'Square150x150Logo.scale-400.png',
];

/**
 * The variants without which Windows draws a plate behind the icon.
 *
 * Microsoft: "If you do not include the targetsize-*-altform-unplated assets
 * above your icon will scale to a smaller size and will get an undesirable
 * backplate behind the icon on Taskbar and Start."
 */
const REQUIRED_UNPLATED: readonly string[] = [16, 24, 32, 48, 256].map(
  (size) => `Square44x44Logo.targetsize-${size}_altform-unplated.png`,
);

function headerOf(file: string): { width: number; height: number } {
  const header = readPngHeader(readFileSync(join(ASSET_DIRECTORY, file)));
  return { width: header.width, height: header.height };
}

// ── The premise ─────────────────────────────────────────────────────────────

describe('the premise: there is something here to adjudicate', () => {
  it('the manifest names at least the six logos MSIX asks for', () => {
    const named = assetsNamedIn(MANIFEST);
    expect(
      named.length,
      `${MANIFEST_PATH} named ${named.length} assets. A manifest this guard cannot read is a ` +
        'guard that passes by having nothing to check.',
    ).toBeGreaterThanOrEqual(6);
  });

  it('the table is populated', () => {
    expect(MSIX_ASSETS.length).toBeGreaterThanOrEqual(30);
  });

  it('the asset directory is not empty', () => {
    expect(
      ON_DISK.length,
      `No PNGs were read from ${MSIX_ASSET_DIRECTORY}. Run \`pnpm assets:msix\`.`,
    ).toBeGreaterThanOrEqual(30);
  });
});

// ── The contract ────────────────────────────────────────────────────────────

describe('every asset the manifest names exists at its declared size', () => {
  it('the manifest names nothing the table does not describe', () => {
    const described = new Set(MSIX_ASSETS.map((asset) => asset.file));
    const orphans = assetsNamedIn(MANIFEST).filter((file) => !described.has(file));

    expect(
      orphans,
      `${MANIFEST_PATH} points at ${orphans.join(', ')}, which \`msixAssets.ts\` does not ` +
        'generate. A dangling asset reference fails the certification kit at submission time, ' +
        'not here.',
    ).toEqual([]);
  });

  it('every file in the table is on disk', () => {
    const present = new Set(ON_DISK);
    const missing = MSIX_ASSETS.map((asset) => asset.file).filter((file) => !present.has(file));

    expect(
      missing,
      `Missing from ${MSIX_ASSET_DIRECTORY}: ${missing.join(', ')}. Run \`pnpm assets:msix\`.`,
    ).toEqual([]);
  });

  it('every file on disk is the exact size the table declares', () => {
    const wrong = MSIX_ASSETS.filter((asset) => ON_DISK.includes(asset.file))
      .map((asset) => ({ asset, actual: headerOf(asset.file) }))
      .filter(({ asset, actual }) => actual.width !== asset.width || actual.height !== asset.height)
      .map(
        ({ asset, actual }) =>
          `${asset.file}: declared ${asset.width}x${asset.height}, file is ${actual.width}x${actual.height}`,
      );

    expect(
      wrong,
      'A Store asset of the wrong size is not a build failure. Windows scales it, or the ' +
        'certification kit rejects the package at submission. Regenerate with `pnpm assets:msix`.',
    ).toEqual([]);
  });

  it('the table agrees with what each file name claims', () => {
    // A second opinion on the table, derived from the naming convention alone.
    // A typed-in row that contradicts its own file name is caught here rather
    // than shipping an asset Windows will ask for at a different size.
    const contradictions = MSIX_ASSETS.map((asset) => ({
      asset,
      claimed: sizeClaimedByName(asset.file),
    }))
      .filter(
        ({ asset, claimed }) =>
          claimed === null || claimed.width !== asset.width || claimed.height !== asset.height,
      )
      .map(({ asset, claimed }) =>
        claimed === null
          ? `${asset.file}: the name follows no MSIX convention this guard recognises`
          : `${asset.file}: name says ${claimed.width}x${claimed.height}, table says ${asset.width}x${asset.height}`,
      );

    expect(contradictions).toEqual([]);
  });

  it('leaves no file in the directory that nothing generates', () => {
    // The reverse direction. A stray PNG is dead weight in the package and, if
    // it happens to be a qualified variant name, a picture Windows may pick.
    const described = new Set(MSIX_ASSETS.map((asset) => asset.file));
    expect(ON_DISK.filter((file) => !described.has(file))).toEqual([]);
  });
});

describe('the scales Microsoft actually requires', () => {
  const files = new Set(MSIX_ASSETS.map((asset) => asset.file));

  it('has 100%, 200% and 400% for the app-list icon and the medium tile', () => {
    expect(REQUIRED_SCALES.filter((file) => !files.has(file))).toEqual([]);
  });

  it('has every unplated target-size variant, or Windows draws a plate', () => {
    expect(REQUIRED_UNPLATED.filter((file) => !files.has(file))).toEqual([]);
  });

  it('the unplated variants are on disk at their exact pixel sizes', () => {
    for (const file of REQUIRED_UNPLATED) {
      const size = Number(/targetsize-(\d+)/.exec(file)?.[1]);
      expect(headerOf(file), file).toEqual({ width: size, height: size });
    }
  });
});

// ── Proof the detectors can actually fail ───────────────────────────────────

describe('the detectors bite, and let the honest shapes through', () => {
  it('reads an asset reference out of manifest XML, in either slash', () => {
    expect(assetsNamedIn('Square44x44Logo="Assets\\Square44x44Logo.png"')).toEqual([
      'Square44x44Logo.png',
    ]);
    expect(assetsNamedIn('<Logo>Assets/StoreLogo.png</Logo>')).toEqual(['StoreLogo.png']);
  });

  it('negative: does not invent a reference from an unrelated path', () => {
    expect(assetsNamedIn('<Application Executable="CViper Light.exe" />')).toEqual([]);
    expect(assetsNamedIn('see icons/msix/Square44x44Logo.png for the source')).toEqual([]);
  });

  it('works out the size a name claims, including the overrides', () => {
    expect(sizeClaimedByName('Square44x44Logo.png')).toEqual({ width: 44, height: 44 });
    expect(sizeClaimedByName('Square44x44Logo.scale-200.png')).toEqual({ width: 88, height: 88 });
    expect(sizeClaimedByName('Square150x150Logo.scale-400.png')).toEqual({
      width: 600,
      height: 600,
    });
    expect(sizeClaimedByName('Wide310x150Logo.scale-200.png')).toEqual({ width: 620, height: 300 });
    expect(sizeClaimedByName('StoreLogo.scale-100.png')).toEqual({ width: 50, height: 50 });
    // targetsize overrides the base size rather than multiplying it.
    expect(sizeClaimedByName('Square44x44Logo.targetsize-256.png')).toEqual({
      width: 256,
      height: 256,
    });
    expect(sizeClaimedByName('Square44x44Logo.targetsize-16_altform-unplated.png')).toEqual({
      width: 16,
      height: 16,
    });
  });

  it('negative: says so rather than guessing at a name it does not know', () => {
    expect(sizeClaimedByName('SplashScreen.png')).toBeNull();
    expect(sizeClaimedByName('whatever.png')).toBeNull();
  });
});
