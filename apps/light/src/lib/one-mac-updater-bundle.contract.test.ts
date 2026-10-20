/**
 * The macOS updater bundle is made ONCE, by tauri-action (L-260).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * release.yml carried a "Pack the macOS updater bundle" step whose comment
 * said the build no longer wrote an `.app.tar.gz` because
 * `createUpdaterArtifacts` is off. That is true of `tauri build`, and false of
 * tauri-action: GitHub cannot take a directory as a release asset, so the
 * action tars every `.app` it finds and uploads THAT — light-v0.10.5's log
 * reads "Packaging … CViper Light.app directory into … .app.tar.gz" followed
 * by "CViper Light_0.10.5_universal.app.tar.gz successfully uploaded", and the
 * sign job found it, signed it and wrote it into latest.json.
 *
 * Had the extra step's upload succeeded, the draft would have held TWO
 * `.app.tar.gz` files. The sign job downloads `*.app.tar.gz`, signs everything
 * it downloaded, and `assembleUpdaterManifest` refuses two bundles for one
 * platform — so the sign job would have gone red and no Mac would ever have
 * been offered the release. The step failed on a dropped connection instead,
 * which is the only reason 0.10.5's draft was usable. A step that can only
 * break the release when it works is not a step.
 *
 * So: exactly one thing in release.yml may produce or upload an
 * `.app.tar.gz`, and it is tauri-action. Nothing else runs `tar` into that
 * suffix, and nothing else `gh release upload`s one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const RELEASE = join(REPO_ROOT, '.github', 'workflows', 'release.yml');

function withoutComments(workflow: string): string {
  return workflow
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n');
}

export function macBundleOffences(workflow: string): string[] {
  const text = withoutComments(workflow);
  const offences: string[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (/\btar\b[^\n]*\.app\.tar\.gz/.test(line)) {
      offences.push(
        `line ${i + 1} packs an .app.tar.gz by hand; tauri-action already tars the .app it uploads, and a second bundle makes the sign job refuse the manifest.`,
      );
    }
    if (/gh release upload[^\n]*\.app\.tar\.gz/.test(line)) {
      offences.push(
        `line ${i + 1} uploads an .app.tar.gz; only tauri-action may put a Mac updater bundle on the draft.`,
      );
    }
  }
  return offences;
}

describe('release.yml makes the macOS updater bundle exactly once (L-260)', () => {
  it('the real workflow is clean', () => {
    expect(macBundleOffences(readFileSync(RELEASE, 'utf8'))).toEqual([]);
  });
});

describe('the guard itself', () => {
  const good = ['jobs:', '  bundle:', '    steps:', '      - uses: tauri-apps/tauri-action@abc'];

  it('happy: a workflow that leaves it to tauri-action passes', () => {
    expect(macBundleOffences(good.join('\n'))).toEqual([]);
  });

  it('negative: a hand-rolled tar into .app.tar.gz is an offence', () => {
    const bad = [...good, "      - run: tar -czf X.app.tar.gz -C dir 'X.app'"];
    expect(macBundleOffences(bad.join('\n')).join('\n')).toMatch(/packs an \.app\.tar\.gz/);
  });

  it('negative: a second upload of an .app.tar.gz is an offence', () => {
    const bad = [...good, '      - run: gh release upload "$TAG" X.app.tar.gz --clobber'];
    expect(macBundleOffences(bad.join('\n')).join('\n')).toMatch(/uploads an \.app\.tar\.gz/);
  });

  it('boundary: the same commands in a comment do not count', () => {
    const commented = [
      ...good,
      "      # tar -czf X.app.tar.gz -C dir 'X.app'",
      '      # gh release upload x X.app.tar.gz',
    ];
    expect(macBundleOffences(commented.join('\n'))).toEqual([]);
  });

  it('boundary: downloading .app.tar.gz (the sign job) is allowed', () => {
    const sign = [...good, '      - run: gh release download "$TAG" --pattern \'*.app.tar.gz\''];
    expect(macBundleOffences(sign.join('\n'))).toEqual([]);
  });
});
