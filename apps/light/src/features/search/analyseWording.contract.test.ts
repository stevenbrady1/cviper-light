import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, stripComments } from '../../lib/repo-scan';

/**
 * L-411 renamed the TRACKER's button only. The same action on a search result
 * keeps "Analyse this job", because the privacy page quotes those exact words.
 * The owner decided (13 Nov 2026) that Search's button and the privacy
 * sentence change TOGETHER, later, as one item the owner words. Until then
 * this pins all three, so nobody "finishes the rename" on one of them alone.
 */
describe('Search and the privacy page still say "Analyse this job" (L-411)', () => {
  const shipped = (path: string) => stripComments(readFileSync(join(REPO_ROOT, path), 'utf8'));

  it('the search result’s button', () => {
    expect(shipped('apps/light/src/features/search/ResultCard.tsx')).toContain(
      "label: 'Analyse this job'",
    );
  });

  it('the reason shown for reading an advert page, and the published privacy page', () => {
    const quoted = 'Analyse this job on a search result';

    expect(shipped('apps/light/src/lib/outbound-hosts.ts')).toContain(quoted);
    // Markdown, so read as written: it has no comments to strip.
    expect(readFileSync(join(REPO_ROOT, 'docs/app-store/privacy-policy.md'), 'utf8')).toContain(
      quoted,
    );
  });

  it('the guard reads shipped words, not comments', () => {
    expect(stripComments("// label: 'Analyse this job'")).not.toContain('Analyse this job');
  });
});
