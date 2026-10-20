/**
 * The marketing copy inside the two store listing documents, and only that.
 *
 * Both `docs/STORE-SUBMISSION.md` and `docs/app-store/LISTING.md` mix the
 * copy that gets pasted into a store (fenced with `<!-- generic-copy:start -->`
 * / `<!-- generic-copy:end -->`) with certification and reviewer notes that
 * legitimately say other things. Guards that police the PASTED copy read it
 * through here, so they all agree on where the copy starts and stops.
 *
 * Moved here unchanged from `no-provider-brand-in-store-listings.contract
 * .test.ts` when a second guard needed it — importing one test file from
 * another would register its tests twice.
 */
import { join } from 'node:path';

import { REPO_ROOT } from './repo-scan.ts';

const FENCE_START = '<!-- generic-copy:start';
const FENCE_END = '<!-- generic-copy:end';

/** The listing documents whose fenced copy is pasted into a store. */
export const STORE_LISTING_DOCS: readonly { readonly path: string; readonly file: string }[] = [
  { path: 'docs/STORE-SUBMISSION.md', file: join(REPO_ROOT, 'docs/STORE-SUBMISSION.md') },
  {
    path: 'docs/app-store/LISTING.md',
    file: join(REPO_ROOT, 'docs/app-store/LISTING.md'),
  },
];

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
