/**
 * The no-paywall contract: nothing in this app is gated on payment, a licence,
 * a tier or a trial — in code or in copy.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * CViper Light is free. Not "free tier", not "free for now": free, for
 * anyone, with no account (README, ADR 012 in the hosted repository). The
 * hosted product has tiers, usage caps and Stripe; twelve of its modules were
 * ported here, and the next port could carry a `tier` check across without
 * anyone deciding that Light should have one.
 *
 * The guard is added while there is nothing to forbid. That is the right
 * moment: a guard written after the first paywall ships is a guard that
 * argues with a feature.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * Two shapes are forbidden: a FILE whose name says it gates something, and a
 * SENTENCE in shipped copy that asks the user to pay or upgrade. Both are
 * lexical, so a regular expression is the right tool.
 *
 * The word list is narrow on purpose. This codebase legitimately says
 * "unlock" (the OS credential store), "entitled" (in prose about what a
 * request may do) and "licence" (a spelling table). None of those is a
 * paywall, and a guard that fired on them would be deleted within a week.
 * What is forbidden is the COMMERCIAL phrase: "upgrade to Pro", "premium
 * feature", "free trial", "subscribe", "buy now".
 */
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, shippedText, walk } from './repo-scan.ts';

/** A module whose NAME says it gates access. */
const FORBIDDEN_FILE_NAMES =
  /(paywall|entitlement|licen[cs]e[-_]?(check|gate|key)|subscription|billing|pricing|upgrade[-_]?modal|pro[-_]?tier|tier[-_]?gate)/i;

/** A SENTENCE in shipped copy that asks for money or an upgrade. */
export const FORBIDDEN_PHRASES: readonly RegExp[] = [
  /\bupgrade to (pro|premium|plus|paid)\b/i,
  /\b(pro|premium|paid|plus) (plan|tier|feature|version|edition)\b/i,
  /\bfree trial\b/i,
  /\bstart (your|a) trial\b/i,
  /\b(buy|purchase) (now|cviper|a licen[cs]e)\b/i,
  /\bsubscri(be|ption)\b/i,
  /\bunlock (all|premium|pro|paid) \b/i,
  /\bpaywall\b/i,
  /\bactivation (key|code)\b/i,
  /\benter your licen[cs]e\b/i,
];

export function paywallPhrasesIn(text: string): string[] {
  return FORBIDDEN_PHRASES.flatMap((pattern) =>
    [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))].map((match) => match[0]),
  );
}

const SOURCE_ROOTS = [join(REPO_ROOT, 'apps/light/src'), join(REPO_ROOT, 'packages')];
const FILES = SOURCE_ROOTS.flatMap((root) => walk(root, { extensions: ['.ts', '.tsx'] }));

describe('the paywall detector', () => {
  it('catches the commercial phrase and lets the honest word through', () => {
    expect(paywallPhrasesIn('Upgrade to Pro to unlock all templates.')).toEqual([
      'Upgrade to Pro',
      'unlock all ',
    ]);
    expect(paywallPhrasesIn('Start your free trial today')).toContain('free trial');
    // The sentences this codebase actually contains, which MUST walk through.
    expect(paywallPhrasesIn('Unlock the store and test again.')).toEqual([]);
    expect(paywallPhrasesIn('a request the user was entitled to make')).toEqual([]);
    expect(paywallPhrasesIn('licence file nobody opens')).toEqual([]);
  });
});

describe('nothing in Light is gated on payment', () => {
  it('scans the real tree', () => {
    // Anti-inert.
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some((file) => file.endsWith('App.tsx'))).toBe(true);
  });

  it('has no module whose name says it gates access', () => {
    const offenders = FILES.map(displayPath).filter((path) =>
      FORBIDDEN_FILE_NAMES.test(path.split('/').at(-1) ?? ''),
    );
    expect(offenders).toEqual([]);
  });

  it('has no shipped copy that asks the user to pay or upgrade', () => {
    const offenders = FILES.flatMap((file) =>
      paywallPhrasesIn(shippedText(file)).map((phrase) => `${displayPath(file)}: "${phrase}"`),
    );
    expect(
      offenders,
      'Light is free. If this is a link to the hosted product, phrase it as a ' +
        'description of what the hosted product does, not as an upgrade.',
    ).toEqual([]);
  });
});
