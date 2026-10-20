/**
 * No store listing promises an update check the store build does not have.
 *
 * ============================================================================
 * WHY THIS EXISTS (Store Submission 2, 20 Oct 2026)
 * ============================================================================
 * The Microsoft Store and App Store builds have no updater: the plugin is not
 * compiled into either (`msix-store-build.contract.test.ts`, the iOS
 * `cfg(desktop)` gate), and the store delivers updates instead. L-181 fixed
 * Settings → Privacy, which had told Store and phone users the app "checks for
 * updates at startup" — but the copy actually PASTED into Partner Center and
 * App Store Connect said the same thing ("like the update check on startup,
 * which you can switch off any time") and nothing scanned it. Submission 1 to
 * the Microsoft Store went out with that sentence on 20 Oct 2026 and needed a
 * listing-only resubmission to take it back.
 *
 * Same claim, second surface: a class, so a guard rather than a spot-fix.
 *
 * ============================================================================
 * FENCED COPY ONLY, AND A FORBID-LIST (LESSON-033)
 * ============================================================================
 * Only the `generic-copy` fences are scanned. The certification and reviewer
 * notes outside them legitimately say "the updater is not compiled in" — that
 * is the honest version of this fact, and it belongs there.
 *
 * Inside the fences, nothing says an update check, an updater, or checking for
 * updates exists. This never asserts any particular wording IS present.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { STORE_LISTING_DOCS, fencedSpans } from './store-listing-fences.ts';

/** Any phrasing that tells a store user the app updates itself. */
const UPDATER_CLAIM = /\b(update check|updater|checks? for updates|auto-?updates?)\b/gi;

interface Finding {
  readonly doc: string;
  readonly phrase: string;
}

/** Every updater claim inside `docs`' fenced spans. Pure over `readFile`. */
export function findUpdaterClaimsInFences(
  docs: readonly { readonly path: string; readonly file: string }[],
  readFile: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): Finding[] {
  return docs.flatMap(({ path, file }) =>
    fencedSpans(readFile(file)).flatMap((span) =>
      [...span.matchAll(UPDATER_CLAIM)].map((match) => ({ doc: path, phrase: match[0] })),
    ),
  );
}

const PLANTED = [{ path: 'planted.md', file: 'unused' }];
const fence = (copy: string) => `<!-- generic-copy:start -->${copy}<!-- generic-copy:end -->`;

describe('the detector', () => {
  it('catches the sentence that shipped in Submission 1', () => {
    expect(
      findUpdaterClaimsInFences(PLANTED, () =>
        fence(
          'The only requests it ever makes are ones you start, or switched on yourself — ' +
            'like the update check on startup, which you can switch off any time.',
        ),
      ),
    ).toEqual([{ doc: 'planted.md', phrase: 'update check' }]);
  });

  it('catches the other ways of saying it, in any case', () => {
    const found = findUpdaterClaimsInFences(PLANTED, () =>
      fence('It Checks for updates. A built-in updater. Auto-update included.'),
    ).map((f) => f.phrase.toLowerCase());
    expect(found).toEqual(['checks for updates', 'updater', 'auto-update']);
  });

  it('lets the fixed sentence through', () => {
    expect(
      findUpdaterClaimsInFences(PLANTED, () =>
        fence(
          'The only requests it ever makes are ones you start, or switched on yourself. ' +
            'Settings → Privacy lists every address the app is allowed to name.',
        ),
      ),
    ).toEqual([]);
  });

  it('lets the honest reviewer note OUTSIDE the fence through', () => {
    expect(
      findUpdaterClaimsInFences(
        PLANTED,
        () =>
          'Notes: the updater is not compiled into this build.\n' +
          fence('Track every application.'),
      ),
    ).toEqual([]);
  });

  it('does not fire on "updates" with no claim attached (boundary)', () => {
    expect(findUpdaterClaimsInFences(PLANTED, () => fence('The store delivers updates.'))).toEqual(
      [],
    );
  });
});

describe('no store listing promises an update check', () => {
  it('anti-inert: scans both listing documents', () => {
    expect(STORE_LISTING_DOCS.map((d) => d.path)).toEqual([
      'docs/STORE-SUBMISSION.md',
      'docs/app-store/LISTING.md',
    ]);
  });

  it('finds none', () => {
    expect(
      findUpdaterClaimsInFences(STORE_LISTING_DOCS),
      'Store listing copy (inside a `generic-copy` fence) mentions an update check. The Store ' +
        'and App Store builds have no updater — the store updates the app. Say it in the ' +
        'reviewer/certification notes outside the fence if it needs saying at all.',
    ).toEqual([]);
  });
});
