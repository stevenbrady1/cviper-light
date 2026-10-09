/**
 * The iOS export-compliance question is answered in the plist, honestly (L-173).
 *
 * ============================================================================
 * WHY
 * ============================================================================
 * Every build uploaded to App Store Connect stops at "Does your app use
 * encryption?" unless `ITSAppUsesNonExemptEncryption` answers it. This app's
 * only cryptography is the TLS that HTTPS needs — rustls with ring inside
 * reqwest, and Apple's own keychain for saved keys — which is exempt
 * (category 5A992.c self-classification). The database is not encrypted by the
 * app. So the honest answer is `false`, and it belongs in
 * `src-tauri/Info.ios.plist`, which `tauri ios build` merges into the
 * generated Info.plist.
 *
 * ============================================================================
 * TWO HALVES
 * ============================================================================
 *   1. The key is present, outside any comment, exactly once, and `false`.
 *      Comments are stripped first: a key sitting in a `<!-- -->` block would
 *      satisfy a plain substring search and answer nothing (the L-168 lesson,
 *      see `lib/appx-manifest.ts`).
 *   2. `false` stays TRUE. A forbid-list of encryption libraries that would
 *      make it a false declaration — a cipher crate, an encrypted SQLite, a
 *      JavaScript crypto library — must be absent from the manifests that
 *      ship. Adding one fails here, so the declaration is reconsidered rather
 *      than left quietly wrong.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripXmlComments } from '../lib/appx-manifest.ts';
import { REPO_ROOT } from '../lib/repo-scan.ts';

const read = (path: string): string => readFileSync(join(REPO_ROOT, path), 'utf8');

const PLIST = read('apps/light/src-tauri/Info.ios.plist');
const CARGO_TOML = read('apps/light/src-tauri/Cargo.toml');
const PACKAGE_JSONS = [
  'package.json',
  'apps/light/package.json',
  'packages/ai-providers/package.json',
  'packages/core-types/package.json',
  'packages/cv-parsing/package.json',
  'packages/job-apis/package.json',
  'packages/ats-checks/package.json',
  'packages/keyword-scoring/package.json',
  'packages/resume-schema/package.json',
  'packages/ui/package.json',
].map((path) => ({ path, text: read(path) }));
const LISTING = read('docs/app-store/LISTING.md');

/**
 * What the plist answers: `'false'`, `'true'`, `null` when absent, or
 * `'ambiguous'` when the key appears more than once or with no boolean after it.
 */
export function exportComplianceAnswer(plistXml: string): 'false' | 'true' | 'ambiguous' | null {
  const stripped = stripXmlComments(plistXml);
  const keys = [...stripped.matchAll(/<key>\s*ITSAppUsesNonExemptEncryption\s*<\/key>/g)];
  if (keys.length === 0) return null;
  if (keys.length > 1) return 'ambiguous';
  const after = stripped.slice((keys[0]?.index ?? 0) + (keys[0]?.[0].length ?? 0));
  const value = /^\s*<(true|false)\s*\/>/.exec(after);
  return value === null ? 'ambiguous' : (value[1] as 'true' | 'false');
}

/**
 * Dependencies that would make `ITSAppUsesNonExemptEncryption = false` untrue.
 * Not TLS: reqwest's rustls/ring is the exempt HTTPS this app relies on.
 */
const NON_EXEMPT_CRATES = [
  'aes',
  'aes-gcm',
  'chacha20',
  'chacha20poly1305',
  'sodiumoxide',
  'libsodium-sys',
  'orion',
  'age',
  'openssl',
  'sqlcipher',
  'rusqlite',
];
const NON_EXEMPT_PACKAGES = [
  'crypto-js',
  'tweetnacl',
  'libsodium-wrappers',
  'node-forge',
  'sjcl',
  '@journeyapps/sqlcipher',
];

/** `name = ` or `name.workspace`/`name = {` at the start of a Cargo dependency line. */
function cargoDeclares(toml: string, crate: string): boolean {
  const escaped = crate.replace(/[-]/g, '\\-');
  return new RegExp(`^\\s*${escaped}\\s*[=.]`, 'm').test(toml.replace(/#.*$/gm, ''));
}

function packageDeclares(json: string, name: string): boolean {
  const parsed = JSON.parse(json) as Record<string, Record<string, string> | undefined>;
  return ['dependencies', 'devDependencies', 'optionalDependencies'].some(
    (field) => parsed[field]?.[name] !== undefined,
  );
}

describe('export compliance is answered in the plist (L-173)', () => {
  it('declares ITSAppUsesNonExemptEncryption = false, once, outside any comment', () => {
    expect(exportComplianceAnswer(PLIST)).toBe('false');
  });

  it('the plist still carries the document types, so this is the real file', () => {
    // Anti-inert: the reader must be looking at the merged-in source.
    expect(stripXmlComments(PLIST)).toContain('CFBundleDocumentTypes');
  });

  it('the listing says the question is already answered', () => {
    expect(LISTING).toContain('ITSAppUsesNonExemptEncryption');
  });

  describe('the reader can actually fail', () => {
    const wrap = (inner: string): string => `<plist><dict>${inner}</dict></plist>`;

    it('negative: a key inside a comment answers nothing', () => {
      expect(
        exportComplianceAnswer(wrap('<!-- <key>ITSAppUsesNonExemptEncryption</key><false/> -->')),
      ).toBeNull();
    });

    it('negative: true is read as true, not as present', () => {
      expect(
        exportComplianceAnswer(wrap('<key>ITSAppUsesNonExemptEncryption</key>\n  <true/>')),
      ).toBe('true');
    });

    it('boundary: twice, or with no boolean after it, is ambiguous', () => {
      const once = '<key>ITSAppUsesNonExemptEncryption</key><false/>';
      expect(exportComplianceAnswer(wrap(once + once))).toBe('ambiguous');
      expect(
        exportComplianceAnswer(wrap('<key>ITSAppUsesNonExemptEncryption</key><string>NO</string>')),
      ).toBe('ambiguous');
    });

    it('absent is null', () => {
      expect(exportComplianceAnswer(wrap('<key>Other</key><false/>'))).toBeNull();
    });
  });
});

describe('the answer stays honest: no non-exempt encryption ships', () => {
  it('reads the real manifests', () => {
    expect(CARGO_TOML).toContain('[dependencies]');
    expect(cargoDeclares(CARGO_TOML, 'reqwest')).toBe(true);
    expect(PACKAGE_JSONS.every(({ text }) => text.includes('"name"'))).toBe(true);
  });

  it('the Rust side declares no cipher crate and no encrypted SQLite', () => {
    for (const crate of NON_EXEMPT_CRATES) {
      expect(cargoDeclares(CARGO_TOML, crate), `${crate} in Cargo.toml`).toBe(false);
    }
  });

  it('no package declares a JavaScript crypto library', () => {
    for (const { path, text } of PACKAGE_JSONS) {
      for (const name of NON_EXEMPT_PACKAGES) {
        expect(packageDeclares(text, name), `${name} in ${path}`).toBe(false);
      }
    }
  });

  it('the detectors catch a planted dependency', () => {
    expect(cargoDeclares('[dependencies]\naes-gcm = "0.10"\n', 'aes-gcm')).toBe(true);
    expect(cargoDeclares('[dependencies]\n# aes-gcm = "0.10"\n', 'aes-gcm')).toBe(false);
    expect(cargoDeclares('[dependencies]\naesthetic = "1"\n', 'aes')).toBe(false);
    expect(packageDeclares('{"dependencies":{"crypto-js":"4"}}', 'crypto-js')).toBe(true);
  });
});
