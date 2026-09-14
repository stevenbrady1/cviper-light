/**
 * A line diff: which lines of the original CV survived into the tailored one,
 * which were added, which were dropped.
 *
 * The longest common subsequence over LINES, not characters or words. The
 * user is checking that every role and every fact came through — a rewritten
 * bullet is "one line out, one line in", which is exactly the grain a person
 * reviews at. A word diff would light up every reworded sentence and hide the
 * one line that matters: a role that vanished.
 *
 * Whitespace is trimmed and blank lines are dropped before comparing, so a
 * re-flowed paragraph is not reported as a change. Order is preserved: the
 * output reads top to bottom as the tailored CV does, with removed lines
 * placed where they used to be.
 */

export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffLine {
  readonly kind: DiffKind;
  readonly text: string;
}

/**
 * Past this many cells the DP table is a noticeable pause on a laptop. A CV
 * is a few hundred lines at most; anything bigger is not a CV, and is shown
 * as "everything out, everything in" rather than computed.
 */
const MAX_CELLS = 4_000_000;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function lineDiff(original: string, revised: string): DiffLine[] {
  const before = lines(original);
  const after = lines(revised);

  if (before.length * after.length > MAX_CELLS) {
    return [
      ...before.map((text): DiffLine => ({ kind: 'removed', text })),
      ...after.map((text): DiffLine => ({ kind: 'added', text })),
    ];
  }

  // lcs[i][j] = length of the LCS of before[i..] and after[j..].
  const rows = before.length + 1;
  const cols = after.length + 1;
  const lcs = new Uint32Array(rows * cols);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const here = i * cols + j;
      lcs[here] =
        before[i] === after[j]
          ? (lcs[(i + 1) * cols + (j + 1)] ?? 0) + 1
          : Math.max(lcs[(i + 1) * cols + j] ?? 0, lcs[i * cols + (j + 1)] ?? 0);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    const b = before[i] ?? '';
    const a = after[j] ?? '';
    if (b === a) {
      out.push({ kind: 'same', text: b });
      i += 1;
      j += 1;
    } else if ((lcs[(i + 1) * cols + j] ?? 0) >= (lcs[i * cols + (j + 1)] ?? 0)) {
      out.push({ kind: 'removed', text: b });
      i += 1;
    } else {
      out.push({ kind: 'added', text: a });
      j += 1;
    }
  }
  while (i < before.length) {
    out.push({ kind: 'removed', text: before[i] ?? '' });
    i += 1;
  }
  while (j < after.length) {
    out.push({ kind: 'added', text: after[j] ?? '' });
    j += 1;
  }
  return out;
}
