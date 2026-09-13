/**
 * No user-facing surface claims an absolute this app cannot keep: "only
 * when you press a button", full stop.
 *
 * ============================================================================
 * WHY THIS EXISTS (coordinator review, PR #89, finding C1)
 * ============================================================================
 * That claim was already false the moment `launchCheck.ts` defaulted the
 * startup update check to ON (L-92): `App.tsx`'s mount effect reads GitHub
 * releases with no button pressed, unless the user switched it off. The
 * Ollama probe (L-134b, this PR) made it false a second way. The repo has
 * fixed this exact class of over-claim once already, in the Settings
 * screen's telemetry note — `privacyCopy.test.tsx` pins "ones you start or
 * switched on" and explains why "the ones you START" stopped being true.
 * This PR's own first draft of `policyDocument.ts`'s short version repeated
 * the mistake in a different sentence, and `docs/app-store/LISTING.md` /
 * `docs/STORE-SUBMISSION.md` — copy actually submitted to app stores — had
 * an even older instance of it ("It never contacts a service you did not
 * press a button for."). Three sightings of the same defect is a class, and
 * a class gets a forbid-list guard rather than a fourth spot-fix.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This never asserts that the honest, qualified phrasing IS present — that
 * would go stale the day someone found a better way to say the same true
 * thing. It asserts that the UNQUALIFIED absolute is absent: "press a
 * button" with no "or switched" anywhere near it, "never contacts a service
 * you did not press" in any form, "ones you start" with no "or switched on"
 * following. Rewording the honest sentence is free; dropping its qualifier
 * is what fails the build.
 *
 * The one deliberate exception is the section heading "Only when you press
 * a button, with no key" (`PrivacyNotice.tsx`'s `GROUPS`, rendered into both
 * the live screen and the generated policy). That is a category LABEL for
 * one bucket of hosts, not a claim about the whole app, and it is the only
 * place in this tree that shape of text is honest without a qualifier — so
 * the detector excludes exactly that continuation, by name, rather than
 * gaining a general allow-list.
 *
 * ============================================================================
 * CONDITIONAL ON THE PREMISE THAT MAKES IT TRUE
 * ============================================================================
 * The claim is false only because `updateCheckOnLaunchEnabled()` can return
 * `true` with nothing stored — read here from `launchCheck.ts`'s own
 * comment-stripped source, not asserted as a constant, so the day that
 * function's default changes this guard's premise changes with it instead
 * of quietly protecting a claim that has become true. `the verdict follows
 * the premise` below proves the flip is a property of the guard rather than
 * something a future reader has to take on trust — the same shape
 * `unconfigurableKeyClaims.contract.test.tsx` uses for its own key-card
 * flip.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, stripComments, walk } from './repo-scan.ts';

/** The one legitimate use of "press a button" with no qualifier: a heading. */
const HEADING_EXCEPTION = 'press a button, with no key';

/** Up to 60 chars from `start`, lower-cased, for a cheap substring check. */
function windowFrom(text: string, start: number): string {
  return text.slice(start, start + 60).toLowerCase();
}

/**
 * Every unqualified absolute this text makes, as a short human-readable
 * label per finding — never the whole matched text, so a failure message
 * names the shape of the problem instead of dumping a paragraph.
 */
export function findUnqualifiedAbsolutes(text: string): string[] {
  const findings: string[] = [];

  // "only when you press a button" (or "the ones you press a button for" —
  // covered by the LISTING.md-shaped check below) without "or switched"
  // within the same clause, and not the heading.
  const pressAButton = /only when you press a button(?![^.]*or switched)/gi;
  for (const match of text.matchAll(pressAButton)) {
    if (windowFrom(text, match.index).includes(HEADING_EXCEPTION)) continue;
    findings.push('"only when you press a button" with no "or switched" qualifier nearby');
  }

  // The LISTING.md/STORE-SUBMISSION.md shape: "never contacts a service you
  // did not press [a button]". This phrasing has no honest form at all — it
  // is always a defect — so it is forbidden outright, no qualifier check.
  if (/never contacts a service you did not press/i.test(text)) {
    findings.push('"never contacts a service you did not press ..."');
  }

  // "the only requests it (ever) makes are ones you start" without "or
  // switched on" following.
  const onesYouStart =
    /only requests? it (?:ever )?makes? are ones you start(?![^.:]*or switched)/gi;
  if (onesYouStart.test(text)) {
    findings.push('"...are ones you start" with no "or switched on" following');
  }

  return findings;
}

/**
 * Is the premise that makes the absolute false still true? Read from
 * `launchCheck.ts`'s own code, comment-stripped, rather than hard-coded —
 * see `the verdict follows the premise` below for why this cannot be a
 * constant.
 */
function updateCheckDefaultsOn(): boolean {
  const source = shippedText(
    join(REPO_ROOT, 'apps/light/src/features/settings/updates/launchCheck.ts'),
  );
  // The exact shape `updateCheckOnLaunchEnabled` uses today: no stored
  // answer resolves to on, not to off. `stripComments` already ran inside
  // `shippedText`, so a doc comment describing the OPPOSITE intent could
  // never make this pass by accident.
  return /if\s*\(\s*store\s*===\s*null\s*\)\s*return\s+true\s*;/.test(source);
}

const CODE_SURFACES = [
  join(REPO_ROOT, 'apps/light/src/lib/outbound-hosts.ts'),
  join(REPO_ROOT, 'apps/light/src/features/settings/privacy/policyDocument.ts'),
  join(REPO_ROOT, 'apps/light/src/features/settings/privacy/PrivacyNotice.tsx'),
  join(REPO_ROOT, 'apps/light/src/features/settings/Settings.tsx'),
];

const DOC_SURFACES = [
  join(REPO_ROOT, 'README.md'),
  join(REPO_ROOT, 'docs/STORE-SUBMISSION.md'),
  ...walk(join(REPO_ROOT, 'docs/app-store'), { extensions: ['.md'] }),
];

const SURFACES = [...CODE_SURFACES, ...DOC_SURFACES];

interface Finding {
  readonly file: string;
  readonly claim: string;
}

function scanSurfaces(): Finding[] {
  return SURFACES.flatMap((file) => {
    const text = file.endsWith('.md')
      ? stripComments(readFileSync(file, 'utf8'))
      : shippedText(file);
    return findUnqualifiedAbsolutes(text).map((claim) => ({ file: displayPath(file), claim }));
  });
}

describe('the detector', () => {
  it('catches every known shape of the bare absolute', () => {
    expect(
      findUnqualifiedAbsolutes(
        'The app contacts another service only when you press a button that says it will, and only the services listed on this page.',
      ),
    ).toEqual(['"only when you press a button" with no "or switched" qualifier nearby']);

    expect(
      findUnqualifiedAbsolutes(
        'It never contacts a service you did not press a button for. Settings → Privacy lists every address.',
      ),
    ).toEqual(['"never contacts a service you did not press ..."']);

    expect(findUnqualifiedAbsolutes('The only requests it ever makes are ones you start.')).toEqual(
      ['"...are ones you start" with no "or switched on" following'],
    );
  });

  it('lets the honest, qualified forms through', () => {
    expect(
      findUnqualifiedAbsolutes(
        'The app contacts another service only when you press a button that says it will, ' +
          'or switched it on — and only the services listed on this page.',
      ),
    ).toEqual([]);
    expect(
      findUnqualifiedAbsolutes(
        'The only requests it ever makes are ones you start or switched on: a job search...',
      ),
    ).toEqual([]);
    expect(
      findUnqualifiedAbsolutes(
        'The only requests it ever makes are ones you start, or switched on yourself.',
      ),
    ).toEqual([]);
  });

  it('does not fire on the section heading, which is a category label, not a claim', () => {
    expect(findUnqualifiedAbsolutes('Only when you press a button, with no key')).toEqual([]);
    // The heading in context, exactly as `PrivacyNotice.tsx` renders it.
    expect(
      findUnqualifiedAbsolutes(
        '<h4>Only when you press a button, with no key</h4><p>A plain request with nothing ' +
          'about you in it.</p>',
      ),
    ).toEqual([]);
  });
});

describe('the premise', () => {
  it('is read from real code, and is true today', () => {
    // Anti-inert: if this ever goes false, the enforcement test below stops
    // asserting anything, and `the verdict follows the premise` is what
    // keeps that from being silent.
    expect(updateCheckDefaultsOn()).toBe(true);
  });
});

/** The enforcement rule itself, pure: no findings survive an absent premise. */
function enforceWhilePremiseHolds<T>(findings: readonly T[], premiseHolds: boolean): readonly T[] {
  return premiseHolds ? findings : [];
}

describe('the verdict follows the premise, not the wording', () => {
  const PLANTED = [{ file: 'planted.md', claim: 'plant' }];

  it('a bare absolute is a defect while the launch check can default on', () => {
    expect(enforceWhilePremiseHolds(PLANTED, true)).toEqual(PLANTED);
  });

  it('the SAME finding would stop being enforced if the premise ever flipped', () => {
    // Nothing about the copy changed between these two calls — only whether
    // the premise that makes it false still holds — and that is the only
    // thing that should move the verdict. Proven on a planted array and a
    // planted boolean, exactly as `unconfigurableKeyClaims.contract.test.tsx`
    // proves its own key-card flip, so this guard cannot be deleted quietly
    // the day the real default changes.
    expect(enforceWhilePremiseHolds(PLANTED, false)).toEqual([]);
    expect(enforceWhilePremiseHolds(PLANTED, true)).toEqual(PLANTED);
  });
});

describe('no user-facing surface makes the bare absolute claim', () => {
  it('scans at least five real surfaces', () => {
    // Anti-inert: an empty or near-empty list would make the assertion below
    // vacuously true forever.
    expect(SURFACES.length).toBeGreaterThanOrEqual(5);
    expect(SURFACES.some((file) => file.endsWith('outbound-hosts.ts'))).toBe(true);
    expect(SURFACES.some((file) => file.endsWith('LISTING.md'))).toBe(true);
  });

  it('finds none, for as long as the launch update check can default on', () => {
    if (!updateCheckDefaultsOn()) return;

    expect(
      scanSurfaces(),
      'Each finding below is a surface that claims the app contacts another service only ' +
        'when a button is pressed, with no room for the launch update check or the Ollama ' +
        'probe — both of which run with no button pressed. Either qualify the sentence ' +
        '("...or switched on") or, if this is truly a NEW absolute claim, decide whether it ' +
        'is honest before silencing this.',
    ).toEqual([]);
  });
});
