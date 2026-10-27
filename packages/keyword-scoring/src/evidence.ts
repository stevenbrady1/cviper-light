/**
 * L-290 — the line of a CV that shows a matched skill.
 *
 * The result screen puts it beside each matched skill, so a user can check a
 * match instead of taking it on trust (audit #14). It is computed where the
 * result is shown, from the CV text the screen already has, so nothing new is
 * stored and an older saved result gets proof too.
 *
 * It follows the SCORE's rules, so the proof never contradicts the score:
 *   - the same matcher (`termInText`), with UK alternative wordings (L-282),
 *     the labels that imply this one (L-285) and the lexicon's synonyms;
 *   - a line that says the candidate LACKS the skill is skipped (L-283);
 *   - an everyday-English use of go/rest/react/... is skipped (L-286).
 *
 * When no line qualifies it returns null, and the screen shows nothing for
 * that skill. An AI-path skill phrased as a sentence ("Stakeholder management
 * experience") usually has no literal line; showing a guessed one would be
 * worse than showing none.
 */
import { dropEnglishWordSkills } from './english-words';
import { maskNegated } from './negation';
import { getSimilarTerms } from './similar';
import { termInText } from './term';
import { UK_TERMS } from './uk-skills';

/** The longest quote shown, before the ellipses a cut adds. */
export const EVIDENCE_MAX_CHARS = 120;

/** Every way the CV could have written `key` for the score to credit it. */
function phrasesFor(key: string): string[] {
  const uk = UK_TERMS.find((term) => term.label.toLowerCase() === key);
  const implying = uk
    ? UK_TERMS.filter((term) => term.implies.includes(uk.label)).flatMap((term) => [
        term.label,
        ...term.aliases,
      ])
    : [];
  return [key, ...(uk?.aliases ?? []), ...implying, ...getSimilarTerms(key)];
}

/** A window of the line around the match, marked with ellipses where cut. */
function clip(line: string, phrase: string): string {
  if (line.length <= EVIDENCE_MAX_CHARS) return line;
  const at = Math.max(0, line.toLowerCase().indexOf(phrase.toLowerCase()));
  const start = Math.max(
    0,
    Math.min(
      at - Math.floor((EVIDENCE_MAX_CHARS - phrase.length) / 2),
      line.length - EVIDENCE_MAX_CHARS,
    ),
  );
  const end = start + EVIDENCE_MAX_CHARS;
  return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`;
}

/**
 * The first CV line the score would credit `skill` from, trimmed of its
 * bullet; null when there is none.
 */
export function evidenceLine(skill: string, cvText: string): string | null {
  const key = (skill || '').trim().toLowerCase();
  if (!key || !cvText) return null;
  const phrases = phrasesFor(key);

  for (const raw of cvText.split('\n')) {
    const line = raw.trim().replace(/^[-*•·]\s*/u, '');
    if (!line) continue;
    if (dropEnglishWordSkills([key], line).length === 0) continue;
    const credited = maskNegated(line);
    const hit = phrases.find((phrase) => termInText(phrase, credited));
    if (hit !== undefined) return clip(line, hit);
  }
  return null;
}
