/**
 * Refuse to pack an MSIX whose staged manifest version disagrees with the app
 * version (L-169), or is not above every version already uploaded to the
 * Store (L-170).
 *
 * Run by `msix.yml` immediately before `winapp pack`, against the STAGED
 * manifest (the copy with `Executable=` rewritten), not the source file: the
 * question is "what is about to be packed", and only the staged copy answers
 * it. Exits non-zero on any problem, prints every problem it found, and
 * prints the two versions it compared on success so a green run is auditable.
 *
 *   usage: node apps/light/src/packaging/checkAppxManifestVersion.ts
 *            [--manifest <Package.appxmanifest>]   default: the source manifest
 *            [--config <tauri.conf.json>]
 *            [--store-config <tauri.microsoft-store.conf.json>]
 *            [--submissions <store-submissions.json>]
 *
 * The rules live in `appxManifestVersion.ts` and `storeSubmissions.ts`,
 * shared with the commit-time contract tests. This file only reads files and sets the exit
 * code — see that module for why one rule serves two moments.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkForPacking } from './storeSubmissions.ts';

interface Arguments {
  readonly manifestPath: string;
  readonly configPath: string;
  readonly storeConfigPath: string;
  readonly submissionsPath: string;
}

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

const DEFAULTS: Arguments = {
  manifestPath: here('../../src-tauri/msix/Package.appxmanifest'),
  configPath: here('../../src-tauri/tauri.conf.json'),
  storeConfigPath: here('../../src-tauri/tauri.microsoft-store.conf.json'),
  submissionsPath: here('../../src-tauri/msix/store-submissions.json'),
};

function usage(message: string): never {
  console.error(`check-msix-manifest: ${message}`);
  console.error(
    'usage: node apps/light/src/packaging/checkAppxManifestVersion.ts ' +
      '[--manifest <Package.appxmanifest>] [--config <tauri.conf.json>] ' +
      '[--store-config <tauri.microsoft-store.conf.json>] ' +
      '[--submissions <store-submissions.json>]',
  );
  process.exit(1);
}

export function parseArguments(argv: readonly string[]): Arguments {
  let { manifestPath, configPath, storeConfigPath, submissionsPath } = DEFAULTS;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--manifest') {
      index += 1;
      manifestPath = argv[index] ?? usage('--manifest needs a path');
    } else if (argument === '--config') {
      index += 1;
      configPath = argv[index] ?? usage('--config needs a path');
    } else if (argument === '--store-config') {
      index += 1;
      storeConfigPath = argv[index] ?? usage('--store-config needs a path');
    } else if (argument === '--submissions') {
      index += 1;
      submissionsPath = argv[index] ?? usage('--submissions needs a path');
    } else {
      usage(`unknown argument "${argument}"`);
    }
  }
  return { manifestPath, configPath, storeConfigPath, submissionsPath };
}

function read(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    console.error(
      `check-msix-manifest: ${what} could not be read at ${path}: ` +
        (cause instanceof Error ? cause.message : String(cause)),
    );
    process.exit(1);
  }
}

function main(): void {
  const { manifestPath, configPath, storeConfigPath, submissionsPath } = parseArguments(
    process.argv.slice(2),
  );

  const verdict = checkForPacking({
    manifestXml: read(manifestPath, 'the manifest'),
    tauriConfJson: read(configPath, 'tauri.conf.json'),
    storeConfJson: read(storeConfigPath, 'the Store config fragment'),
    submissionsJson: read(submissionsPath, 'the Store submissions record'),
  });

  if (!verdict.ok) {
    console.error(`check-msix-manifest: REFUSING to pack ${manifestPath}`);
    for (const problem of verdict.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(
    `check-msix-manifest: OK — ${manifestPath} Identity/@Version ${verdict.manifestVersion} ` +
      `matches app version ${verdict.appVersion}; the Store config fragment carries no version; ` +
      (verdict.lastSubmitted === null
        ? 'no Store upload is recorded yet.'
        : `it is above the last Store upload, ${verdict.lastSubmitted}.`),
  );
}

main();
