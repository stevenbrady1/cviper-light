/**
 * L-289 — split an advert into what it calls desirable and everything else.
 *
 * Used only to decide which recognised skills are REQUIRED (`profile.ts`). A
 * skill found only in the desirable half is still recognised, still matched
 * when the CV has it, but no longer counted as a requirement the candidate
 * misses. Everything outside the desirable half stays exactly as before, so an
 * advert with no marker at all is scored as it always was.
 *
 * Two shapes are read, and nothing else:
 *   - a desirable HEADING ("Desirable:", "Nice to have", "It would be great if
 *     you have:", "Bonus points for:", "Ideally you will have:"). Every line
 *     after it is desirable until the next heading of any kind.
 *   - an inline MARKER on one line: "(desirable)", "(nice to have)",
 *     "would be an advantage", "is a plus".
 *
 * Deliberately not markers: a bare "preferred" ("Preferred start date") and a
 * bare "advantageous" ("an advantageous pension scheme"). Missing a real
 * desirable costs the user a few points; mistaking an essential for one tells
 * them a gap does not matter. When in doubt, a line stays required.
 */

const DESIRABLE_HEADING =
  /^\s*(?:desirable|nice[\s-]to[\s-]have|bonus (?:points|if)|it would be (?:great|nice|good|an advantage)|ideally)\b/i;

const INLINE_MARKER =
  /\((?:desirable|nice[\s-]to[\s-]have|optional)\)|\b(?:would be|is|are) (?:an? )?(?:advantage|plus|bonus)\b|\b(?:would be|is) advantageous\b|\bnice[\s-]to[\s-]have\b/i;

/** A line that opens a new section: short, not a bullet, ending in a colon. */
const ANY_HEADING = /^\s*[^-*•\s][^:]{0,60}:\s*$/;

/**
 * The advert's desirable lines, and the rest. With no desirable line at all,
 * `rest` is the text exactly as it came in.
 */
export function splitDesirable(text: string): { desirable: string; rest: string } {
  const desirable: string[] = [];
  const rest: string[] = [];
  let inDesirable = false;

  for (const line of (text || '').split('\n')) {
    if (DESIRABLE_HEADING.test(line)) {
      inDesirable = true;
      // "Desirable: Tableau, Python" — the heading line can carry the list.
      const colon = line.indexOf(':');
      if (colon >= 0) desirable.push(line.slice(colon + 1));
      continue;
    }
    if (ANY_HEADING.test(line) || /^\s*(?:essential|required|requirements)\b/i.test(line)) {
      inDesirable = false;
      rest.push(line);
      continue;
    }
    (inDesirable || INLINE_MARKER.test(line) ? desirable : rest).push(line);
  }

  if (desirable.length === 0) return { desirable: '', rest: text };
  return { desirable: desirable.join('\n'), rest: rest.join('\n') };
}
