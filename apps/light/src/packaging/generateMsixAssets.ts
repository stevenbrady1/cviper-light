/**
 * Regenerate the Microsoft Store's visual assets from the one committed icon.
 *
 * Usage, from the repository root:
 *
 *     pnpm assets:msix
 *
 * It reads `apps/light/branding/cviper-icon-1024.png` — the same square source
 * `tauri icon` uses — and writes every entry in `MSIX_ASSETS` into
 * `apps/light/src-tauri/icons/msix/`.
 *
 * ============================================================================
 * THE FILES IT WRITES ARE COMMITTED, AND THAT IS DELIBERATE
 * ============================================================================
 * Generating them inside the packaging workflow instead would be tidier and
 * worse: the icons would then be invisible in review, and a change to this
 * script would silently change what a submitted package looks like with nothing
 * in the diff to see. Committed assets plus a committed generator means the
 * artwork is reviewable and reproducible at the same time.
 *
 * `msixAssets.contract.test.ts` is what keeps the two in step: it fails if a
 * file the table names is missing, or is not the size the table says.
 *
 * ============================================================================
 * IT OVERWRITES, AND IT SAYS WHAT IT DID
 * ============================================================================
 * Every run rewrites every file, prints one line per asset and the byte count,
 * and exits non-zero on the first refusal. There is no `try`/`continue`: a
 * generator that skipped the asset it could not make would leave a folder that
 * looks complete and is not, which is the failure this whole table exists to
 * prevent.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MSIX_ASSETS,
  MSIX_ASSET_BYTE_LIMIT,
  MSIX_ASSET_DIRECTORY,
  MSIX_ASSET_SOURCE,
} from './msixAssets.ts';
import { centreOnCanvas, decodePng, downscale, encodeUnderLimit } from './png.ts';

/** The monorepo root: `apps/light/src/packaging` → four levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function main(): void {
  const sourcePath = join(REPO_ROOT, MSIX_ASSET_SOURCE);
  const source = decodePng(readFileSync(sourcePath));

  console.log(`source: ${MSIX_ASSET_SOURCE} (${source.width}x${source.height})`);
  if (source.width !== source.height) {
    throw new Error(
      `the source icon is ${source.width}x${source.height}, not square. Every Store asset but ` +
        'the wide tile is square, and scaling a rectangle into one distorts the artwork. See ' +
        'apps/light/branding/README.md for how the square source was produced.',
    );
  }

  const outputDirectory = join(REPO_ROOT, MSIX_ASSET_DIRECTORY);
  mkdirSync(outputDirectory, { recursive: true });

  let bytes = 0;
  const reduced: string[] = [];
  for (const asset of MSIX_ASSETS) {
    const image =
      asset.shape === 'wide'
        ? centreOnCanvas(source, asset.width, asset.height)
        : downscale(source, asset.width, asset.height);

    // Lossless where it fits; colour precision given up only where the
    // certification kit's size limit forces it, and said out loud when it is.
    const result = encodeUnderLimit(image, MSIX_ASSET_BYTE_LIMIT);
    const encoded = result.bytes;
    writeFileSync(join(outputDirectory, asset.file), encoded);
    bytes += encoded.length;
    if (result.bitsPerChannel < 8) {
      reduced.push(`${asset.file} (${result.bitsPerChannel}-bit colour)`);
    }

    console.log(
      `  ${asset.file.padEnd(48)} ${String(asset.width).padStart(4)}x${String(asset.height).padEnd(4)} ` +
        `${String(encoded.length).padStart(8)} bytes   ${asset.why}`,
    );
  }

  console.log('');

  // Said out loud, every run. A generator that quietly degraded artwork to fit
  // a limit would be one nobody could review, and the reduction is the only
  // lossy thing this script does.
  if (reduced.length > 0) {
    console.log(
      `colour precision reduced on ${reduced.length} of ${MSIX_ASSETS.length} assets, to fit ` +
        `under the certification kit's ${MSIX_ASSET_BYTE_LIMIT}-byte limit:`,
    );
    for (const entry of reduced) console.log(`  ${entry}`);
    console.log('');
  }
  console.log(
    `wrote ${MSIX_ASSETS.length} assets (${bytes.toLocaleString('en-GB')} bytes) into ` +
      MSIX_ASSET_DIRECTORY,
  );
}

main();
