/**
 * Write `latest.json` from bundles that were signed in a job of their own
 * (L-223).
 *
 * tauri-action used to sign the updater bundles and write this file in the
 * same step that BUILT them, so the signing key sat in the environment of
 * `beforeBuildCommand` and every crate's `build.rs`. The build now runs without
 * the key; `release.yml`'s `sign` job signs the bundles it downloads from the
 * draft, and this writes the manifest tauri-action used to write — the same
 * shape, read out of the live light-v0.5.0 `latest.json`.
 *
 * Pure: it is handed asset names and signatures and returns an object, or
 * throws. The shell that reads the `.sig` files is `writeUpdaterManifest.ts`.
 * Every refusal is a throw, never a skipped entry: a manifest quietly missing
 * a platform is an update somebody never receives.
 */

export interface SignedBundle {
  /** The asset's name ON THE RELEASE, which is the last part of its URL. */
  readonly assetName: string;
  /** The `.sig` file's contents: base64 of a minisign document. */
  readonly signature: string;
}

export interface AssembleInput {
  readonly tag: string;
  /** `owner/name`, as `GITHUB_REPOSITORY` gives it. */
  readonly repository: string;
  readonly notes: string;
  readonly pubDate: string;
  readonly bundles: readonly SignedBundle[];
}

export interface UpdaterManifest {
  readonly version: string;
  readonly notes: string;
  readonly pub_date: string;
  readonly platforms: Record<string, { readonly signature: string; readonly url: string }>;
}

const RELEASE_TAG_PREFIX = 'light-v';

/**
 * GitHub renames an uploaded asset whose name holds anything else — a space
 * becomes a dot — so a URL built from the local name would 404.
 */
const SAFE_ASSET_NAME = /^[A-Za-z0-9._-]+$/;

/** The one Windows architecture this project builds. */
const WINDOWS_ARCH = '_x64';

/**
 * The manifest keys a bundle answers for, the way tauri-action names them.
 *
 * The updater asks for `<os>-<arch>-<installer>` first and falls back to
 * `<os>-<arch>`, so both are written.
 */
export function updaterPlatformsFor(assetName: string): string[] {
  const isMsi = assetName.endsWith('.msi');
  const isNsis = assetName.endsWith('-setup.exe');

  if (isMsi || isNsis) {
    if (!assetName.includes(WINDOWS_ARCH)) {
      throw new Error(
        `${assetName} is a Windows installer for an architecture this project does not build. ` +
          `Only x64 is built, and labelling anything else windows-x86_64 would offer it to ` +
          'machines it cannot run on.',
      );
    }
    return [isMsi ? 'windows-x86_64-msi' : 'windows-x86_64-nsis'];
  }

  // `--target universal-apple-darwin` is one bundle that runs on both.
  if (assetName.endsWith('.app.tar.gz')) {
    return ['darwin-aarch64', 'darwin-aarch64-app', 'darwin-x86_64', 'darwin-x86_64-app'];
  }

  throw new Error(
    `${assetName} is not an updater bundle. The updater installs an MSI, an NSIS -setup.exe ` +
      'or a macOS .app.tar.gz, and nothing else should have been signed.',
  );
}

function versionOf(tag: string): string {
  if (!tag.startsWith(RELEASE_TAG_PREFIX) || tag.length === RELEASE_TAG_PREFIX.length) {
    throw new Error(
      `${JSON.stringify(tag)} is not a release tag. Every release is tagged ` +
        `${RELEASE_TAG_PREFIX}<version>, and the manifest's version is read from it.`,
    );
  }
  return tag.slice(RELEASE_TAG_PREFIX.length);
}

export function assembleUpdaterManifest(input: AssembleInput): UpdaterManifest {
  const { tag, repository, notes, pubDate, bundles } = input;
  const version = versionOf(tag);

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`${JSON.stringify(repository)} is not a repository in owner/name form.`);
  }
  if (bundles.length === 0) {
    throw new Error(
      'There are no signed bundles, so the manifest would offer nothing to anyone. The signing ' +
        'step found no updater bundle on the draft release.',
    );
  }

  const platforms: Record<string, { signature: string; url: string }> = {};
  const base = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}`;

  for (const { assetName, signature } of bundles) {
    if (!SAFE_ASSET_NAME.test(assetName)) {
      throw new Error(
        `${JSON.stringify(assetName)} holds a character GitHub would rename on upload, so a ` +
          'URL built from it would 404. Name assets as they appear on the release.',
      );
    }
    const trimmed = signature.trim();
    if (trimmed === '') {
      throw new Error(`${assetName} has a blank signature, so nobody could ever verify it.`);
    }

    const entry = { signature: trimmed, url: `${base}/${assetName}` };
    for (const platform of updaterPlatformsFor(assetName)) {
      if (platforms[platform] !== undefined) {
        throw new Error(
          `Two bundles claim ${platform}: ${assetName} and the one at ` +
            `${platforms[platform].url}. Only one can be what that platform installs.`,
        );
      }
      platforms[platform] = entry;
    }
  }

  // The bare key is what an older updater, or one that cannot tell how the
  // app was installed, falls back to. tauri-action gives it the MSI unless
  // told otherwise, and every release so far has shipped that way.
  const bare = platforms['windows-x86_64-msi'] ?? platforms['windows-x86_64-nsis'];
  if (bare !== undefined) platforms['windows-x86_64'] = bare;

  return { version, notes, pub_date: pubDate, platforms };
}
