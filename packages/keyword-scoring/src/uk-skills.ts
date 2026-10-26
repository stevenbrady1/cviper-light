/**
 * L-282 — the hand-made UK skills list, and the scan that uses it.
 *
 * ============================================================================
 * WHY THIS EXISTS, AND WHY IT IS A SEPARATE LAYER.
 * ============================================================================
 * The upstream vocabulary (`vocabulary.ts`) is 92 mostly-tech skills plus 14
 * small sector lexicons. A care, haulage or school advert written in its own
 * words barely registers: on the L-281 eval set the care, HGV and teaching
 * assistant adverts produced NO requirements at all, so their scores were
 * noise. UK qualifications, licences and checks (NVQ, DBS, C+E, Driver CPC,
 * SIA) are most of what those adverts ask for.
 *
 * This is the second deliberate divergence from the mothballed web app, after
 * L-275, and it is kept apart so the upstream data stays byte-identical:
 *   - the data is `lexicons-light/uk.json`, not a file under `lexicons/`;
 *   - nothing here touches `lexicon`, `getSimilarTerms` or `SKILL_VOCABULARY`;
 *   - `profile.ts` APPENDS what this finds, after the upstream scan.
 *
 * ============================================================================
 * HOW A TERM IS FOUND.
 * ============================================================================
 * A term is found when its label OR any alias appears, by `termInFoldedText`
 * (whole token, L-275 punctuation, UK/US spelling, plurals) — and it is always
 * reported under its LABEL. So an advert's "NVQ Level 2" and a CV's "Level 2
 * Diploma in Health and Social Care" become the same requirement, met. The
 * upstream synonym table cannot do this for a CV: it only expands terms the
 * scan has already found, and a CV's alias is never scanned.
 *
 * Not used by the ATS sub-score (`ats.ts`). That asks whether the advert's
 * EXACT words are on the CV, and folding aliases into a label would answer a
 * different question.
 */
import data from './lexicons-light/uk.json';
import { foldSpelling } from './spelling';
import { termInFoldedText } from './term';

export interface UkTerm {
  /** What the user sees, in display case: "DBS check", "C+E licence". */
  readonly label: string;
  /** Other ways a UK advert or CV writes the same thing. */
  readonly aliases: readonly string[];
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read the list defensively. Bundled JSON cannot fail to parse, but it can be
 * the wrong shape after a bad hand-edit, and a throw at module load would take
 * the app down before the user has clicked anything. Bad rows are dropped;
 * `uk-skills.test.ts` fails if the real list loses any.
 */
export function readUkTerms(raw: unknown): UkTerm[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const rows = (raw as Record<string, unknown>)['terms'];
  if (!Array.isArray(rows)) return [];

  const terms: UkTerm[] = [];
  for (const row of rows as unknown[]) {
    if (typeof row !== 'object' || row === null) continue;
    const record = row as Record<string, unknown>;
    const label = cleanString(record['label']);
    const rawAliases = record['aliases'];
    if (label === null || !Array.isArray(rawAliases)) continue;
    const aliases = (rawAliases as unknown[])
      .map(cleanString)
      .filter((alias): alias is string => alias !== null);
    terms.push({ label, aliases });
  }
  return terms;
}

export const UK_TERMS: readonly UkTerm[] = readUkTerms(data);

/**
 * Labels of every UK term the text names, in list order, each once.
 *
 * Does not bound the text: its only callers, the two builders in `profile.ts`,
 * have already cut it to `MAX_TEXT_LENGTH`.
 */
export function extractUkSkills(text: string): string[] {
  if (!(text || '').trim()) return [];
  const folded = foldSpelling(text.toLowerCase());
  return UK_TERMS.filter((term) =>
    [term.label, ...term.aliases].some((phrase) => termInFoldedText(phrase, folded)),
  ).map((term) => term.label);
}
