/**
 * L-286 — six tech skills that are also everyday English words.
 *
 * `termInText` is case-insensitive, by design: "Python", "python" and "PYTHON"
 * are one skill. For these six words that design reads ordinary sentences as
 * skills. Found on the L-281 eval CVs:
 *
 *   "the rest of the round still gets done"   -> REST
 *   "I go to de-escalation first"              -> Go
 *   "themed window displays"                   -> Windows (plural folding)
 *
 * and in an advert "the rest of the team" made REST a requirement every
 * applicant then missed.
 *
 * The rule: such a word counts only when the text writes it like the skill —
 * with a capital ("Go", "REST", "Windows Server") — or puts it on a line with
 * another tech skill ("languages: python, go, rust"). A lower-case "rest" in a
 * sentence about a care round is dropped.
 *
 * Applied to both sides (`profile.ts`), because the false requirement on the
 * advert side costs every applicant, not just one. NOT applied to the ATS
 * sub-score, which reports the advert's literal words.
 *
 * Deliberately left off the list, because hiding a real skill is worse than
 * the bug: `excel` (non-tech CVs often write it lower-case), `testing`,
 * `cloud`, `agile`, `risk`. Each is a judgement call; add one only with a
 * near-miss test that shows the real skill still matching.
 */
import { termInText } from './term';
import { DEFAULT_SKILLS } from './vocabulary';

export const AMBIGUOUS_SKILL_WORDS = ['go', 'rest', 'react', 'windows', 'swift', 'rust'] as const;

const AMBIGUOUS: ReadonlySet<string> = new Set(AMBIGUOUS_SKILL_WORDS);

/**
 * Tech skills that vouch for an ambiguous word on the same line. The upstream
 * tech list, minus the ambiguous words themselves and the generic words that
 * turn up in any sentence.
 */
const VOUCHERS: readonly string[] = DEFAULT_SKILLS.filter(
  (skill) => !AMBIGUOUS.has(skill) && !['testing', 'cloud', 'agile'].includes(skill),
);

/** The line with every word that starts lower-case blanked out. */
function capitalisedWordsOnly(line: string): string {
  return line.replace(/(?<![\p{L}\p{N}_#+.])\p{Ll}\S*/gu, ' | ');
}

function writtenAsTheSkill(word: string, text: string): boolean {
  for (const line of text.split('\n')) {
    if (!termInText(word, line)) continue;
    if (termInText(word, capitalisedWordsOnly(line))) return true;
    if (VOUCHERS.some((voucher) => termInText(voucher, line))) return true;
  }
  return false;
}

/**
 * `skills` without any ambiguous word the text only uses as English. Every
 * other skill is returned untouched, in order.
 */
export function dropEnglishWordSkills(skills: readonly string[], text: string): string[] {
  return skills.filter(
    (skill) => !AMBIGUOUS.has(skill.toLowerCase()) || writtenAsTheSkill(skill, text),
  );
}
