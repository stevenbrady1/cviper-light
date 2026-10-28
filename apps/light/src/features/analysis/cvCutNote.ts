/**
 * The sentence shown by the AI picker when the chosen AI will not be sent the
 * whole CV (L-302). Shown BEFORE the run, so the user can choose differently
 * or move what matters higher, rather than finding out from a weak result.
 *
 * Used by the CV check and the tailor screen. The budgets themselves live in
 * `@cviper/ai-providers` (`prompt/budget.ts`), so this sentence and what is
 * actually sent cannot disagree.
 */
import { CLOUD_MAX_CV_CHARS, cvCutFor, isLocalProvider } from '@cviper/ai-providers';

import { type ProviderKind } from './providers';

const count = (n: number): string => n.toLocaleString('en-GB');

export function cvCutNote(cvText: string | null, kind: ProviderKind | null): string | null {
  // The basic match reads every word of the CV; it never cuts.
  if (cvText === null || cvText.trim() === '' || kind === null || kind === 'keyword') return null;
  const cut = cvCutFor(cvText, kind);
  if (cut === null) return null;

  const said =
    `Your CV is ${count(cut.total)} characters long. This AI is sent the first ` +
    `${count(cut.kept)}, so anything after that is not read.`;
  return isLocalProvider(kind)
    ? `${said} An AI company's model reads up to ${count(CLOUD_MAX_CV_CHARS)}; you can add one in Settings.`
    : `${said} If something important comes later, move it higher in your CV.`;
}
