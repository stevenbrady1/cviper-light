/**
 * The release gate: fail the run rather than publish a manifest nobody checked.
 *
 * Usage, from the repository root:
 *
 *     node apps/light/src/release/verifyUpdaterManifest.ts <latest.json> \
 *       [--bundle-dir <directory>] [--config <tauri.conf.json>]
 *
 * Run in `release.yml` as `pnpm verify:updater-manifest`. The judgement lives
 * in `updaterManifest.ts`, which is pure and unit-tested offline; this file is
 * the shell that reads the files and sets an exit code.
 *
 * ============================================================================
 * IT FAILS LOUDLY, AND IT NEVER FAILS QUIET
 * ============================================================================
 * A missing manifest, an unreadable one and a manifest signed by the wrong key
 * all exit 1. There is deliberately no `|| true`, no "warn and continue", and
 * no path on which an error is swallowed into a green run — the whole point is
 * that this cannot be mistaken for a healthy release. `--bundle-dir` naming a
 * directory with nothing in it is a FAILURE, not a skip, for the same reason.
 *
 * A successful run prints what it actually verified — the key id, the
 * platforms, and whether bundle bytes were checked — so a green log says which
 * check passed rather than merely that something did.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { checkUpdaterManifest, decodeMinisignPublicKey } from './updaterManifest.ts';

interface Arguments {
  readonly manifestPath: string;
  readonly bundleDirectory: string | null;
  readonly configPath: string;
}

/** `apps/light/src-tauri/tauri.conf.json`, relative to this file. */
const DEFAULT_CONFIG = fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url));

function usage(message: string): never {
  console.error(`verify-updater-manifest: ${message}`);
  console.error(
    'usage: node apps/light/src/release/verifyUpdaterManifest.ts <latest.json> ' +
      '[--bundle-dir <directory>] [--config <tauri.conf.json>]',
  );
  process.exit(1);
}

function parseArguments(argv: readonly string[]): Arguments {
  let manifestPath: string | null = null;
  let bundleDirectory: string | null = null;
  let configPath: string = DEFAULT_CONFIG;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--bundle-dir') {
      index += 1;
      bundleDirectory = argv[index] ?? usage('--bundle-dir needs a directory');
    } else if (argument === '--config') {
      index += 1;
      configPath = argv[index] ?? usage('--config needs a path');
    } else if (argument.startsWith('--')) {
      usage(`unknown option ${argument}`);
    } else if (manifestPath === null) {
      manifestPath = argument;
    } else {
      usage(`unexpected extra argument ${argument}`);
    }
  }

  if (manifestPath === null) usage('the path to latest.json is required');
  return { manifestPath, bundleDirectory, configPath };
}

/** The manifest's text, or `null` when the file is not there at all. */
function readManifest(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (thrown) {
    const code = (thrown as { code?: string }).code;
    // ENOENT is the case this gate exists for and is handled as a PROBLEM
    // rather than a crash, so the reason printed is the useful one. Anything
    // else - a permission error, a directory - is a genuine surprise and is
    // rethrown rather than being reported as "missing".
    if (code === 'ENOENT') return null;
    throw thrown;
  }
}

function main(): void {
  const { manifestPath, bundleDirectory, configPath } = parseArguments(process.argv.slice(2));

  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    plugins?: { updater?: { pubkey?: string } };
  };
  const pubkeyBase64 = config.plugins?.updater?.pubkey;
  if (typeof pubkeyBase64 !== 'string' || pubkeyBase64.trim() === '') {
    console.error(`verify-updater-manifest: ${configPath} has no plugins.updater.pubkey.`);
    process.exit(1);
  }

  const manifestText = readManifest(manifestPath);
  const missing: string[] = [];

  const problems = checkUpdaterManifest({
    manifestText,
    pubkeyBase64,
    ...(bundleDirectory === null
      ? {}
      : {
          bundleFor: (fileName: string): Uint8Array | null => {
            try {
              return readFileSync(join(bundleDirectory, fileName));
            } catch {
              missing.push(fileName);
              return null;
            }
          },
        }),
  });

  if (problems.length > 0) {
    console.error('');
    console.error('verify-updater-manifest: this release must NOT be published.');
    console.error('');
    for (const problem of problems) {
      console.error(`  ${problem.where}`);
      console.error(`    found: ${problem.found}`);
      console.error(`    why:   ${problem.why}`);
      console.error('');
    }
    process.exit(1);
  }

  const publicKey = decodeMinisignPublicKey(pubkeyBase64);
  const manifest = JSON.parse(String(manifestText)) as {
    version?: string;
    platforms?: Record<string, unknown>;
  };
  const targets = Object.keys(manifest.platforms ?? {}).sort();

  console.log(`verify-updater-manifest: ${manifestPath} is good.`);
  console.log(`  version:   ${manifest.version ?? '(none)'}`);
  console.log(`  key id:    ${publicKey.keyIdHex}`);
  console.log(`  platforms: ${targets.join(', ')}`);
  console.log(
    bundleDirectory === null
      ? '  bundles:   NOT checked - every signature was made by the right key, but no bundle ' +
          'bytes were supplied to check them against. Pass --bundle-dir for the full check.'
      : `  bundles:   verified against the files in ${bundleDirectory}`,
  );
  if (missing.length > 0) {
    // Unreachable: a missing bundle is already a problem above. Belt and braces
    // so a future refactor cannot turn it into a silent skip.
    console.error(`verify-updater-manifest: assets were missing: ${missing.join(', ')}`);
    process.exit(1);
  }
}

main();
