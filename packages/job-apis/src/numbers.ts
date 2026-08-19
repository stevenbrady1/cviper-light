/**
 * Reading numbers out of a third-party feed.
 *
 * Adzuna and Reed are JSON APIs that change without notice, so every numeric
 * field arrives as `unknown` as far as this package is concerned: a number, a
 * numeric string, `null`, or something nobody predicted. One shared reader
 * means every call site treats "cannot read that" the same way.
 */

/**
 * `float(x)` with Python's `except (TypeError, ValueError)` folded in: a finite
 * number, or `null`.
 *
 * `null` rather than `NaN` deliberately. A `NaN` propagates silently through
 * every comparison answering `false`, so a salary that could not be read would
 * quietly become "not a day rate" — the exact failure this package exists to
 * prevent. A `null` is a value the type system makes the caller handle.
 */
export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
