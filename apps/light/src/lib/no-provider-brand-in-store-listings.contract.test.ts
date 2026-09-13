/**
 * No specific AI provider's brand name inside the FENCED marketing-copy
 * blocks of the two store listing documents (W7, coordinator review of PR
 * #96, following up on L-148 / issue #92).
 *
 * ============================================================================
 * WHY THIS IS A SEPARATE GUARD FROM `no-provider-brand-in-product-copy`
 * ============================================================================
 * Issue #92 named `docs/STORE-SUBMISSION.md` and `docs/app-store/LISTING.md`
 * explicitly as surfaces the product-level genericisation applies to. Neither
 * is in that guard's `SURFACES` list, because — unlike `PrivacyNotice.tsx`,
 * `policyDocument.ts`, `onboarding/cards.ts` and `README.md` — a whole-file
 * scan of either document is wrong: both mix the actual listing copy (what
 * gets pasted into App Store Connect / Partner Center, and must stay
 * provider-generic) with App Review / certification notes in the SAME file
 * that legitimately name providers so a reviewer can test the claim.
 *
 * `<!-- generic-copy:start -->` / `<!-- generic-copy:end -->` HTML comments,
 * added around the marketing-copy blocks in both files in this same change,
 * mark the boundary a markdown parser would otherwise have to guess at. This
 * guard scans ONLY the text between a matched pair; the certification /
 * reviewer notes outside the fences are untouched, exactly like the
 * allow-listed guidance sections `no-provider-brand-in-product-copy`
 * documents.
 *
 * ============================================================================
 * A FORBID-LIST, NOT AN ALLOW-LIST (LESSON-033)
 * ============================================================================
 * This never asserts the generic wording IS present inside a fence — only
 * that a brand name is ABSENT. Rewording the marketing copy is free.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

/** Brand tokens forbidden inside a `generic-copy` fence. Case-insensitive. */
const BRAND_TOKENS = /\b(OpenAI|Anthropic|Claude|ChatGPT|GPT-|Gemini|Google AI|Mistral)\b/gi;

const FENCE_START = '<!-- generic-copy:start';
const FENCE_END = '<!-- generic-copy:end';

const DOCS: readonly { readonly path: string; readonly file: string }[] = [
  { path: 'docs/STORE-SUBMISSION.md', file: join(REPO_ROOT, 'docs/STORE-SUBMISSION.md') },
  {
    path: 'docs/app-store/LISTING.md',
    file: join(REPO_ROOT, 'docs/app-store/LISTING.md'),
  },
];

interface Finding {
  readonly doc: string;
  readonly token: string;
}

/**
 * Every `generic-copy:start` … `:end` span in `text`, as the text BETWEEN the
 * markers (fence lines themselves excluded, so the marker comment's own
 * prose — which names this guard, in a code comment — is never scanned).
 *
 * Pure: takes the document text as an argument, so it can be proved against a
 * planted string rather than only against the real files.
 */
export function fencedSpans(text: string): string[] {
  const spans: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(FENCE_START, cursor);
    if (start === -1) break;
    const afterStartMarker = text.indexOf('-->', start);
    if (afterStartMarker === -1) break;
    const end = text.indexOf(FENCE_END, afterStartMarker);
    if (end === -1) break;
    spans.push(text.slice(afterStartMarker + '-->'.length, end));
    cursor = end + FENCE_END.length;
  }
  return spans;
}

/** Every brand-token hit inside `doc`'s fenced spans. */
export function findBrandMentionsInFences(
  docs: readonly { readonly path: string; readonly file: string }[],
  readFile: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): Finding[] {
  return docs.flatMap(({ path, file }) => {
    const spans = fencedSpans(readFile(file));
    return spans.flatMap((span) =>
      [...span.matchAll(BRAND_TOKENS)].map((match) => ({ doc: path, token: match[0] })),
    );
  });
}

describe('the fence reader itself', () => {
  it('extracts exactly the text between a start/end pair, not the markers', () => {
    const text = 'before <!-- generic-copy:start --> middle <!-- generic-copy:end --> after';
    expect(fencedSpans(text)).toEqual([' middle ']);
  });

  it('handles more than one fenced span in the same document', () => {
    const text =
      '<!-- generic-copy:start -->one<!-- generic-copy:end -->' +
      'skip' +
      '<!-- generic-copy:start -->two<!-- generic-copy:end -->';
    expect(fencedSpans(text)).toEqual(['one', 'two']);
  });

  it('anti-inert: both real documents actually have a fenced span to scan', () => {
    for (const doc of DOCS) {
      const spans = fencedSpans(readFileSync(doc.file, 'utf8'));
      expect(spans.length, doc.path).toBeGreaterThan(0);
      expect(spans.join('').length, doc.path).toBeGreaterThan(100);
    }
  });

  it('would catch a brand name planted inside a fence', () => {
    const planted = [{ path: 'planted.md', file: 'unused' }];
    expect(
      findBrandMentionsInFences(
        planted,
        () => '<!-- generic-copy:start -->Bring your own OpenAI key.<!-- generic-copy:end -->',
      ),
    ).toEqual([{ doc: 'planted.md', token: 'OpenAI' }]);
  });

  it('lets a brand name OUTSIDE the fence through — that is the reviewer notes’ job', () => {
    const planted = [{ path: 'planted.md', file: 'unused' }];
    expect(
      findBrandMentionsInFences(
        planted,
        () =>
          'Notes for the reviewer: today OpenAI or Anthropic.\n' +
          '<!-- generic-copy:start -->Bring your own AI provider key.<!-- generic-copy:end -->',
      ),
    ).toEqual([]);
  });
});

describe('no fenced marketing-copy block names an AI provider', () => {
  it('finds none', () => {
    expect(
      findBrandMentionsInFences(DOCS),
      'A specific AI provider brand name appeared inside a `generic-copy` fence in a store ' +
        'listing document (L-148 / issue #92). The certification and reviewer notes OUTSIDE the ' +
        'fences may still name providers; the marketing copy inside them may not.',
    ).toEqual([]);
  });
});
