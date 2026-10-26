/**
 * L-283 — hide the parts of a CV that say what the candidate does NOT have.
 *
 * ============================================================================
 * THE BUG.
 * ============================================================================
 * The skill scan asks only "do these words appear". So "No CPC or tachograph
 * card yet" credited a digital tachograph, "ADR not held" would credit ADR, and
 * "I do not have a driving licence" a driving licence. The scorer then told a
 * candidate they met a requirement their own CV says they do not.
 *
 * ============================================================================
 * THE RULE — NARROW ON PURPOSE.
 * ============================================================================
 * Two shapes are masked, and nothing else:
 *
 *   - A cue, then the skill: "no", "not", "without", "lack(ing)", "do not
 *     have/hold", "don't have/hold", "yet to gain/get/obtain/complete". The
 *     mask runs from the cue to the end of its clause, and never more than
 *     SIX words — so "Not afraid to roll up my sleeves running payroll in Sage"
 *     keeps Sage.
 *   - The skill, then a cue: "not held", "not yet held", "not obtained",
 *     "expired", "lapsed". The mask runs back to the start of the clause, at
 *     most six words.
 *
 * Deliberately NOT negations, each with a test:
 *   - "not only / not just / no less than / no more than / no longer" —
 *     emphasis, not absence.
 *   - "never" — "never failed a DBS check" is a candidate who has one.
 *   - "non-" — "non-technical stakeholders".
 *   - "working towards", "in progress", "pending" — ambiguous; many adverts
 *     accept them, so they stay a match. Recorded on #376; changing it is a
 *     product decision, not a bug fix.
 *
 * A false negation is worse than the bug it fixes: it hides a skill the
 * candidate holds and tells them to go and get it. When in doubt, this file
 * leaves the text alone.
 *
 * ============================================================================
 * WHERE IT APPLIES.
 * ============================================================================
 * The CV's skill scan only (`profile.ts::buildCvProfile`). Not the advert —
 * "No experience needed" is an advert being friendly — and not the ATS
 * sub-score, which asks whether the advert's exact words are on the page, and
 * on the page they are.
 *
 * A masked span becomes " | ", not a space: `|` is not a token character and
 * multi-word terms match across whitespace only, so the words either side of a
 * mask can never join into a phrase neither half of the CV wrote.
 */

/** At most this many words are masked either side of a cue. */
export const NEGATION_WINDOW_WORDS = 6;

const MASK = ' | ';

/** "no", "not" and the rest — then the masked words follow. */
const FORWARD_CUE =
  /\b(?:(?:do|does|did)\s+not\s+(?:have|hold)|(?:don|doesn|didn)['’]?t\s+(?:have|hold)|yet\s+to\s+(?:gain|get|obtain|complete|achieve)|lack(?:s|ing)?|without|not|no)\b(?!\s+(?:only|just|limited|least|less|more|fewer|longer)\b)/giu;

/** "not held", "expired" — the masked words come BEFORE. */
const BACKWARD_CUE =
  /\b(?:not\s+(?:yet\s+|currently\s+)?(?:held|obtained|achieved)|expired|lapsed)\b/giu;

/** Words that start a new clause going forward: the negation stops there. */
const CLAUSE_WORDS = new Set(['but', 'however', 'although', 'though', 'whereas', 'except']);

/**
 * Where a word stops a forward mask, and how much of it to keep inside.
 * Returns the cut index within the word, or -1 if the word does not stop it.
 *
 * A `.` ends a clause only when nothing token-like follows, so "node.js" and
 * ".net" are one word, not a sentence end.
 */
function forwardCut(word: string): number {
  for (let i = 0; i < word.length; i += 1) {
    const char = word[i] ?? '';
    if (';:!?,()'.includes(char)) return i;
    if (char === '.' && !/[\p{L}\p{N}]/u.test(word[i + 1] ?? '')) return i;
  }
  return -1;
}

type Range = readonly [start: number, end: number];

function forwardRange(text: string, cueStart: number, cueEnd: number): Range {
  const words = /\S+/gu;
  words.lastIndex = cueEnd;
  let end = cueEnd;
  for (let count = 0; count < NEGATION_WINDOW_WORDS; count += 1) {
    const match = words.exec(text);
    if (match === null) break;
    if (text.slice(end, match.index).includes('\n')) break;
    const word = match[0];
    const bare = word.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (CLAUSE_WORDS.has(bare) || /^[-–—]+$/u.test(word)) break;
    const cut = forwardCut(word);
    if (cut === 0) break;
    if (cut > 0) {
      end = match.index + cut;
      break;
    }
    end = match.index + word.length;
  }
  return [cueStart, end];
}

function backwardRange(text: string, cueStart: number, cueEnd: number): Range {
  let start = cueStart;
  let words = 0;
  let i = cueStart - 1;
  while (i >= 0 && words < NEGATION_WINDOW_WORDS) {
    const char = text[i] ?? '';
    if ('\n;!?,'.includes(char) || (char === '.' && /\s/u.test(text[i + 1] ?? ''))) break;
    if (/\S/u.test(char) && (i === 0 || /\s/u.test(text[i - 1] ?? ''))) {
      words += 1;
      start = i;
    }
    i -= 1;
  }
  return [start, cueEnd];
}

/**
 * The CV text with every negated span replaced by " | ". Text with no cue is
 * returned unchanged, character for character.
 */
export function maskNegated(text: string): string {
  if (!text) return '';
  const ranges: Range[] = [];
  for (const cue of text.matchAll(FORWARD_CUE)) {
    ranges.push(forwardRange(text, cue.index, cue.index + cue[0].length));
  }
  for (const cue of text.matchAll(BACKWARD_CUE)) {
    ranges.push(backwardRange(text, cue.index, cue.index + cue[0].length));
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    out += text.slice(cursor, Math.max(start, cursor)) + MASK;
    cursor = end;
  }
  return out + text.slice(cursor);
}
