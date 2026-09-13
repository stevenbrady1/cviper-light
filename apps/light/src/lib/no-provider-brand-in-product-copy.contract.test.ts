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
 * SCANNED, AND WHY EXACTLY THESE FOUR FILES
 * ============================================================================
 * Every file here is one where the entire shipped, non-comment text is meant
 * to describe the product generically, so a whole-file scan (comments
 * stripped, the same way `outbound-hosts.contract.test.ts` reads source) has
 * nothing legitimate to trip over:
 *
 *   - `PrivacyNotice.tsx`   — the Settings → Privacy summary paragraph
 *   - `policyDocument.ts`   — the generated policy's own prose
 *   - `onboarding/cards.ts` — the welcome screen's cost line
 *   - `README.md`           — the repo's own front page
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
 *   - `onboarding/Welcome.tsx`'s "where do I get a key" link, which still
 *     opens one specific provider's signup page and says so on screen —
 *     offering a choice of provider from that link is L-150's job (a generic
 *     OpenAI-compatible card), not this one's;
 *   - `docs/STORE-SUBMISSION.md`, `docs/app-store/LISTING.md` and
 *     `PRIVACY-LABEL.md` — Apple's and Microsoft's own review process is told
 *     which providers exist TODAY so a reviewer can actually test the claim,
 *     in wording the owner supplies verbatim to the store ("paste this as
 *     written"). Each mixes that guidance with product marketing copy in the
 *     SAME file, so a section-level split here would be a fragile markdown
 *     parser guarding a document nobody but a human reads before submission;
 *     the marketing copy surrounding those notes was corrected by hand in the
 *     same change that added this guard.
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
  it('reads at least four real, non-empty surfaces', () => {
    // Anti-inert: fewer than this, or an empty file, and the sweep below could
    // pass by finding nothing to read — the failure mode this repo's own
    // guards keep naming as the reason a forbid-list gets deleted quietly.
    expect(SURFACES.length).toBeGreaterThanOrEqual(4);
    for (const surface of SURFACES) {
      expect(readFileSync(surface.file, 'utf8').length, surface.path).toBeGreaterThan(50);
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
