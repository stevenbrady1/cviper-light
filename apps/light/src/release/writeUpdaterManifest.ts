/**
 * Write `latest.json` next to the bundles the `sign` job just signed (L-223).
 *
 * Usage, from the repository root:
 *
 *     node apps/light/src/release/writeUpdaterManifest.ts <directory> \
 *       --tag <light-vX.Y.Z> --repo <owner/name>
 *
 * Every `<bundle>.sig` in the directory becomes a platform entry for
 * `<bundle>`, which must sit beside it. The manifest is written to
 * `<directory>/latest.json`. The judgement is in `assembleUpdaterManifest.ts`;
 * this only reads files and sets an exit code. The job runs
 * `verify:updater-manifest` on the result before anything is uploaded.
 *
 * It reads `.sig` files and never the key: it runs in a step that does not
 * have one.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assembleUpdaterManifest } from './assembleUpdaterManifest.ts';

/** What tauri-action wrote as the release notes, so nothing a user sees changes. */
const NOTES = 'See the assets below to download and install this version.';

function fail(message: string): never {
  console.error(`write-updater-manifest: ${message}`);
  process.exit(1);
}

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.startsWith('--')) fail(`${name} is required`);
  return value;
}

function main(): void {
  const argv = process.argv.slice(2);
  const directory = argv[0];
  if (directory === undefined || directory.startsWith('--')) {
    fail('usage: writeUpdaterManifest.ts <directory> --tag <light-vX.Y.Z> --repo <owner/name>');
  }
  const tag = option(argv, '--tag');
  const repository = option(argv, '--repo');

  const bundles = readdirSync(directory)
    .filter((name) => name.endsWith('.sig'))
    .sort()
    .map((sigName) => {
      const assetName = sigName.slice(0, -'.sig'.length);
      if (!existsSync(join(directory, assetName))) {
        fail(`${sigName} has no ${assetName} beside it, so there is nothing it is a signature of.`);
      }
      return { assetName, signature: readFileSync(join(directory, sigName), 'utf8') };
    });

  let manifest;
  try {
    manifest = assembleUpdaterManifest({
      tag,
      repository,
      notes: NOTES,
      pubDate: new Date().toISOString(),
      bundles,
    });
  } catch (thrown) {
    fail(thrown instanceof Error ? thrown.message : String(thrown));
  }

  const out = join(directory, 'latest.json');
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`write-updater-manifest: wrote ${out}`);
  console.log(`  version:   ${manifest.version}`);
  console.log(`  platforms: ${Object.keys(manifest.platforms).sort().join(', ')}`);
}

main();
