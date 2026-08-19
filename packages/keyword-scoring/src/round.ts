/**
 * Python's rounding, because the scoring maths was written in Python.
 *
 * `Math.round` rounds half AWAY FROM ZERO; Python 3's `round` rounds half to
 * EVEN. The ported formulas round four times — the raw score, the missing
 * penalty, the coverage percentage and the ATS percentage — and coverage
 * values that land the penalty exactly on `.5` are not rare (a coverage of 0.5
 * puts it on 7.5). Using `Math.round` would make CViper Light disagree with
 * CViper by a point on some CVs and not others, which is far harder to notice,
 * and to explain, than a consistent difference.
 */
export function pythonRound(value: number): number {
  if (!Number.isFinite(value)) return value;
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // Exactly halfway: pick the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}
