/**
 * Assembling `latest.json` from bundles signed in a step of their own (L-223).
 *
 * tauri-action used to sign the updater bundles AND write `latest.json`, which
 * meant the signing key sat in the environment of the whole build — readable
 * by `beforeBuildCommand` and every crate's `build.rs`. The build now runs
 * without the key, a separate job signs the bundles, and this writes the
 * manifest tauri-action used to write.
 *
 * The shape is the one tauri-action produced for every release so far, read
 * out of the live `latest.json` (light-v0.5.0) rather than assumed:
 *
 *   windows-x86_64       -> the MSI (tauri-action prefers it unless told not to)
 *   windows-x86_64-msi   -> the MSI
 *   windows-x86_64-nsis  -> the NSIS `-setup.exe`
 *   url                  -> releases/download/<tag>/<the asset's name>
 *   signature            -> the `.sig` file's base64, verbatim
 *
 * The strongest test here hands the result to the SAME verifier the promote
 * job runs, with the bundle bytes — so "the manifest this writes is one the
 * release gate accepts" is proven, not described.
 */
import { describe, expect, it } from 'vitest';

import {
  assembleUpdaterManifest,
  updaterPlatformsFor,
  type SignedBundle,
} from './assembleUpdaterManifest.ts';
import { throwawayMinisignKeypair } from './throwawayMinisign.testkit.ts';
import { checkUpdaterManifest } from './updaterManifest.ts';

const TAG = 'light-v0.9.0';
const REPO = 'stevenbrady1/cviper-light';
const MSI = 'CViper.Light_0.9.0_x64_en-US.msi';
const NSIS = 'CViper.Light_0.9.0_x64-setup.exe';
const MAC = 'CViper.Light_universal.app.tar.gz';
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

const signed = (assetName: string, signature = `sig-of-${assetName}`): SignedBundle => ({
  assetName,
  signature,
});

const assemble = (bundles: readonly SignedBundle[], tag = TAG, repository = REPO) =>
  assembleUpdaterManifest({
    tag,
    repository,
    notes: 'See the assets below to download and install this version.',
    pubDate: '2026-10-11T00:00:00.000Z',
    bundles,
  });

describe('the manifest tauri-action used to write', () => {
  it('names the version from the tag, and both Windows installers', () => {
    const manifest = assemble([signed(MSI), signed(NSIS)]);
    expect(manifest.version).toBe('0.9.0');
    expect(manifest.notes).toBe('See the assets below to download and install this version.');
    expect(manifest.pub_date).toBe('2026-10-11T00:00:00.000Z');
    expect(manifest.platforms).toEqual({
      'windows-x86_64': { signature: `sig-of-${MSI}`, url: `${BASE}/${MSI}` },
      'windows-x86_64-msi': { signature: `sig-of-${MSI}`, url: `${BASE}/${MSI}` },
      'windows-x86_64-nsis': { signature: `sig-of-${NSIS}`, url: `${BASE}/${NSIS}` },
    });
  });

  it('prefers the MSI for the bare Windows key whatever order the bundles arrive in', () => {
    const manifest = assemble([signed(NSIS), signed(MSI)]);
    expect(manifest.platforms['windows-x86_64']?.url).toBe(`${BASE}/${MSI}`);
  });

  it('falls back to NSIS for the bare key when there is no MSI', () => {
    const manifest = assemble([signed(NSIS)]);
    expect(manifest.platforms['windows-x86_64']?.url).toBe(`${BASE}/${NSIS}`);
  });

  it('points both Mac architectures at one universal bundle', () => {
    expect(updaterPlatformsFor(MAC)).toEqual([
      'darwin-aarch64',
      'darwin-aarch64-app',
      'darwin-x86_64',
      'darwin-x86_64-app',
    ]);
  });

  it('copies each signature verbatim, trimmed of the trailing newline a .sig file carries', () => {
    const manifest = assemble([signed(NSIS, 'c2lnbmF0dXJl\n')]);
    expect(manifest.platforms['windows-x86_64-nsis']?.signature).toBe('c2lnbmF0dXJl');
  });
});

describe('what it writes passes the release gate', () => {
  it('is accepted by the verifier the promote job runs, checked against the bundle bytes', () => {
    const key = throwawayMinisignKeypair();
    const bytes: Record<string, Buffer> = {
      [MSI]: Buffer.from('pretend msi'),
      [NSIS]: Buffer.from('pretend nsis'),
    };
    const manifest = assemble(
      Object.entries(bytes).map(([name, data]) => signed(name, key.signatureFor(data, name))),
    );

    const problems = checkUpdaterManifest({
      manifestText: JSON.stringify(manifest),
      pubkeyBase64: key.pubkeyBase64,
      expectedTag: TAG,
      bundleFor: (fileName) => bytes[fileName] ?? null,
    });
    expect(problems).toEqual([]);
  });
});

describe('it refuses rather than guesses', () => {
  it('refuses an empty set of bundles', () => {
    expect(() => assemble([])).toThrow(/no signed bundles/);
  });

  it('refuses a file it does not know how to offer as an update', () => {
    expect(() => assemble([signed('CViper.Light_0.9.0_universal.dmg')])).toThrow(
      /not an updater bundle/,
    );
  });

  it('refuses an architecture this project does not build, rather than mislabelling it', () => {
    expect(() => updaterPlatformsFor('CViper.Light_0.9.0_arm64-setup.exe')).toThrow(/x64/);
  });

  it('refuses a name GitHub would rename on upload, because its URL would 404', () => {
    expect(() => assemble([signed('CViper Light_0.9.0_x64-setup.exe')])).toThrow(/rename/);
  });

  it('refuses two bundles that claim the same platform', () => {
    expect(() => assemble([signed(NSIS), signed('Other_0.9.0_x64-setup.exe')])).toThrow(
      /windows-x86_64-nsis/,
    );
  });

  it('refuses a blank signature', () => {
    expect(() => assemble([signed(NSIS, '  \n')])).toThrow(/signature/);
  });

  it('refuses a tag that is not a release tag', () => {
    expect(() => assemble([signed(NSIS)], 'v0.9.0')).toThrow(/light-v/);
  });

  it('boundary: refuses the bare prefix, which names no version', () => {
    expect(() => assemble([signed(NSIS)], 'light-v')).toThrow(/light-v/);
  });

  it('refuses a repository that is not owner/name', () => {
    expect(() => assemble([signed(NSIS)], TAG, 'cviper-light')).toThrow(/owner\/name/);
  });
});
