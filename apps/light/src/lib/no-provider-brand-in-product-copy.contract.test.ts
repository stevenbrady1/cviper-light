/**
 * No specific AI provider's brand name appears on a PRODUCT-LEVEL surface
 * (L-148).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * The owner's decision, 13 September 2026 (L-148): "the product must not read
 * as tied to one AI provider. The user chooses a provider and brings its key;
 * provider names belong only in the 'how to get a key' guidance, never in the
 * product's description of itself." Before this, the welcome screen's cost
 * line, the privacy summary, the generated policy's own prose and the README
 * all named OpenAI specifically — true the day OpenAI was the only provider a
 * card could set up, and false the moment Anthropic (L-149) or any future
 * provider joined it. `configurableAi.contract.test.ts` used to fail the build
 * the OTHER way — a configurable provider absent from the copy — and its own
 * docblock explains why that guard was retired rather than kept alongside
 * this one: the two policies are opposites, and a paragraph cannot obey both.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This never asserts the generic wording IS present — rewording "the provider
 * you choose" is free. It asserts a brand name is ABSENT from the surfaces
 * below, so only a name reappearing can turn it red.
 *
 * ============================================================================
 * SCANNED, AND WHY EXACTLY THESE FIVE FILES
 * ============================================================================
 * Every file here is one where the entire shipped, non-comment text is meant
 * to describe the product generically, so a whole-file scan (comments
 * stripped, the same way `outbound-hosts.contract.test.ts` reads source) has
 * nothing legitimate to trip over:
 *
 *   - `PrivacyNotice.tsx`   — the Settings → Privacy summary paragraph
 *   - `policyDocument.ts`   — the generated policy's own prose
 *   - `onboarding/cards.ts` — the welcome screen's cost line
 *   - `onboarding/Welcome.tsx` — the welcome screen's own JSX and copy
 *   - `README.md`           — the repo's own front page
 *
 * `Welcome.tsx` joined this list under coordinator review (C1, PR #96): its
 * "where do I get a key?" button used to call `browserPort.open(
 * OPENAI_KEY_PROVIDER.signupUrl)` directly, sending the reader to one named
 * provider's signup page while the cost line two lines above it said "the
 * provider you choose" — a real violation this guard's original file list
 * would never have found, because it was not looking. The button now routes
 * to Settings instead, and `Welcome.tsx` no longer accepts a `BrowserPort` at
 * all, so it earns its place on the scanned list rather than the allow-list.
 *
 * ============================================================================
 * WHY NOT MORE FILES — WHERE A BRAND NAME STAYS ALLOWED, AND STAYS RIGHT
 * ============================================================================
 * A brand name is still correct, and expected, in:
 *
 *   - the key-card module (`keys/aiKeyModel.ts`) and its guidance — naming
 *     OpenAI or Anthropic IS the point of a card that sets one up;
 *   - `analysis/providers.ts`'s option labels and notes — "Anthropic ·
 *     <model>" tells the user which cloud the option they are about to press
 *     actually reaches;
 *   - `lib/outbound-hosts.ts`'s per-host registry — the whole point of that
 *     list is naming exactly what the code can reach, which is a different
 *     promise from what this paragraph makes (REACH, not CHOICE — see
 *     `configurableAi.contract.test.ts`'s surviving test for that split);
 *   - `analysis/ConsentGate.tsx`, the per-provider consent dialog — Apple
 *     5.1.2(i) requires the dialog to name the provider, not say "a provider";
 *   - the per-provider key cards' own "where do I get a key?" links in
 *     Settings, which correctly still open one specific provider's signup
 *     page and say so — that is the "how to get a key" guidance the owner's
 *     decision explicitly carves out, now that `Welcome.tsx` no longer does
 *     the same thing at the product level;
 *   - `docs/STORE-SUBMISSION.md` and `docs/app-store/LISTING.md`'s reviewer /
 *     certification notes, and `PRIVACY-LABEL.md` — Apple's and Microsoft's
 *     own review process is told which providers exist TODAY so a reviewer
 *     can actually test the claim, in wording the owner supplies verbatim to
 *     the store ("paste this as written"). The first two mix that guidance
 *     with product marketing copy in the SAME file; W7 (PR #96 review) fences
 *     the marketing blocks with `<!-- generic-copy:start/end -->` markers so
 *     THIS guard can scan exactly those blocks — see
 *     `no-provider-brand-in-store-listings.contract.test.ts` — while the
 *     reviewer notes outside the fences keep naming providers.
 *     `PRIVACY-LABEL.md` is smaller and entirely App-Review guidance with no
 *     separable marketing block, so it stays manually reviewed.
 *
 * ============================================================================
 * `CLAUDE.md` IS A FILENAME, NOT THE MODEL
 * ============================================================================
 * `\bClaude\b` also matches the "Claude" in "CLAUDE.md" — a word boundary sits
 * on either side of a `.` — and README.md links to that file twice. Stripping
 * the literal filename before scanning is a narrow, named exception for one
 * well-understood false positive, not a general allow-list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, stripComments } from './repo-scan.ts';

/** Brand tokens forbidden on a product-level surface. Case-insensitive. */
const BRAND_TOKENS = /\b(OpenAI|Anthropic|Claude|ChatGPT|GPT-|Gemini|Google AI|Mistral)\b/gi;

/** This repo's own conventions file, not the Claude model — see the docblock above. */
function stripClaudeDotMd(text: string): string {
  return text.replace(/CLAUDE\.md/gi, '');
}

interface Surface {
  /** Repo-relative path, for messages. */
  readonly path: string;
  /** Absolute path to read. */
  readonly file: string;
}

const SURFACES: readonly Surface[] = [
  {
    path: 'apps/light/src/features/settings/privacy/PrivacyNotice.tsx',
    file: join(REPO_ROOT, 'apps/light/src/features/settings/privacy/PrivacyNotice.tsx'),
  },
  {
    path: 'apps/light/src/features/settings/privacy/policyDocument.ts',
    file: join(REPO_ROOT, 'apps/light/src/features/settings/privacy/policyDocument.ts'),
  },
  {
    path: 'apps/light/src/features/onboarding/cards.ts',
    file: join(REPO_ROOT, 'apps/light/src/features/onboarding/cards.ts'),
  },
  {
    path: 'apps/light/src/features/onboarding/Welcome.tsx',
    file: join(REPO_ROOT, 'apps/light/src/features/onboarding/Welcome.tsx'),
  },
  {
    path: 'README.md',
    file: join(REPO_ROOT, 'README.md'),
  },
];

interface Finding {
  readonly surface: string;
  readonly token: string;
}

/**
 * Every brand-token hit across the given surfaces' shipped (comment-free)
 * text. Pure and takes its reader as an argument, so the detector can be
 * proved against a planted surface rather than only against the real tree —
 * the same shape `falseKeyClaims` in `unconfigurableKeyClaims.contract.test
 * .tsx` uses for the same reason.
 */
export function findBrandMentions(
  surfaces: readonly Surface[],
  readFile: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): Finding[] {
  return surfaces.flatMap(({ path, file }) => {
    const stripped = stripClaudeDotMd(stripComments(readFile(file)));
    return [...stripped.matchAll(BRAND_TOKENS)].map((match) => ({
      surface: path,
      token: match[0],
    }));
  });
}

describe('the scan itself', () => {
  it('reads at least five real, non-empty surfaces', () => {
    // Anti-inert: fewer than this, or a surface with nothing left after
    // stripping, and the sweep below could pass by finding nothing to read —
    // the failure mode this repo's own guards keep naming as the reason a
    // forbid-list gets deleted quietly. Measured on the STRIPPED text, not the
    // raw file (I2, PR #96 review): a file that was ALL comment — a real
    // possibility for a docblock-heavy module like this repo's — would pass a
    // raw-length floor while handing the scan below an empty string.
    expect(SURFACES.length).toBeGreaterThanOrEqual(5);
    for (const surface of SURFACES) {
      const stripped = stripClaudeDotMd(stripComments(readFileSync(surface.file, 'utf8')));
      expect(stripped.length, surface.path).toBeGreaterThan(50);
    }
  });

  it('would catch a brand name on a planted surface', () => {
    const planted: readonly Surface[] = [{ path: 'planted.ts', file: 'unused' }];
    expect(
      findBrandMentions(planted, () => 'Paid straight to OpenAI on your own account.'),
    ).toEqual([{ surface: 'planted.ts', token: 'OpenAI' }]);
  });

  it('catches every listed brand, however it is spelled', () => {
    const planted: readonly Surface[] = [{ path: 'planted.ts', file: 'unused' }];
    for (const brand of [
      'OpenAI',
      'Anthropic',
      'Claude',
      'ChatGPT',
      'GPT-4o',
      'Gemini',
      'Google AI',
      'Mistral',
    ]) {
      expect(
        findBrandMentions(planted, () => `Sent to ${brand} under your own account.`),
        brand,
      ).not.toEqual([]);
    }
  });

  it('lets an honest generic sentence through', () => {
    const planted: readonly Surface[] = [{ path: 'planted.ts', file: 'unused' }];
    expect(
      findBrandMentions(planted, () => 'Paid to the AI provider you choose on your own account.'),
    ).toEqual([]);
  });

  it('does not mistake this repo’s own CLAUDE.md for the Claude model', () => {
    const planted: readonly Surface[] = [{ path: 'planted.md', file: 'unused' }];
    expect(findBrandMentions(planted, () => 'Read [CLAUDE.md](CLAUDE.md) first.')).toEqual([]);
  });

  it('strips comments before scanning, so history in a docblock is not a violation', () => {
    const planted: readonly Surface[] = [{ path: 'planted.ts', file: 'unused' }];
    expect(
      findBrandMentions(
        planted,
        () => "// This used to say OpenAI here.\nexport const LINE = 'fine, generic wording';",
      ),
    ).toEqual([]);
  });
});

describe('no product-level surface names an AI provider', () => {
  it('finds none', () => {
    expect(
      findBrandMentions(SURFACES),
      'A specific AI provider brand name appeared on a surface meant to describe the product ' +
        'generically (L-148). Provider names belong only in the key-card module and its ' +
        'guidance, the analysis option labels, the per-host registry (lib/outbound-hosts.ts), ' +
        'and the per-provider consent dialog — see this file’s docblock for the full allow-list ' +
        'and why each one is there.',
    ).toEqual([]);
  });
});
