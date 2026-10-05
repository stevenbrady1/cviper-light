/**
 * folded-text.ts — detect on a FOLDED view of the text, edit the ORIGINAL.
 *
 * Shared by `sanitizeForPrompt` (multi-line adverts and CVs) and by
 * `cleanOneLine` in @cviper/ai-providers (single-line values, L-205). ai-providers
 * already depends on this package, so the helper lives here.
 *
 * Each stored character carries a `fold`: what it looks like to a pattern. An
 * injection phrase is matched against the folds, so a fullwidth `ＳＹＳＴＥＭ：`
 * is seen as `SYSTEM:`. What is KEPT is the `shown` text, the user's own: `10²`,
 * `½` and `™` are never rewritten, because a sanitiser that turns `10²` into
 * `102` changes a number the user typed.
 */

/** One character of stored text and what it looks like once folded. */
export interface Unit {
  readonly shown: string;
  readonly fold: string;
  /** A control or format character: invisible, and no part of what a person reads. */
  readonly invisible?: boolean;
}

/** A half-open `[start, end)` span of the FOLDED text. */
export type FoldedRange = readonly [start: number, end: number];

/** The folded text of `units`. */
export function foldedText(units: readonly Unit[]): string {
  return units.map((unit) => unit.fold).join('');
}

/**
 * Remove every stored character the given folded-text ranges touch; `replacement`
 * (if any) goes where each range began. Returns the SAME array when `ranges` is
 * empty or touches nothing.
 */
export function removeRanges(
  units: Unit[],
  ranges: readonly FoldedRange[],
  replacement: string,
): Unit[] {
  const owner: number[] = [];
  units.forEach((unit, index) => {
    for (let i = 0; i < unit.fold.length; i += 1) owner.push(index);
  });

  const doomed = new Set<number>();
  const firstOfSpan = new Set<number>();
  for (const [start, end] of ranges) {
    let first = true;
    for (let i = start; i < end; i += 1) {
      const index = owner[i];
      if (index === undefined) continue;
      if (first) {
        firstOfSpan.add(index);
        first = false;
      }
      doomed.add(index);
    }
  }
  if (doomed.size === 0) return units;

  const out: Unit[] = [];
  units.forEach((unit, index) => {
    if (firstOfSpan.has(index) && replacement !== '') {
      out.push({ shown: replacement, fold: replacement });
    }
    if (!doomed.has(index)) out.push(unit);
  });
  return out;
}

/**
 * Remove every span `pattern` finds in the folded text; units touched go, and
 * `replacement` (if any) is put where the span began.
 */
export function removeMatches(units: Unit[], pattern: RegExp, replacement: string): Unit[] {
  const ranges: FoldedRange[] = [];
  for (const match of foldedText(units).matchAll(new RegExp(pattern.source, pattern.flags))) {
    if (match[0] !== '') ranges.push([match.index, match.index + match[0].length]);
  }
  return removeRanges(units, ranges, replacement);
}
