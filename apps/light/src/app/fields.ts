/**
 * The text box's look: an `<input>`, `<select>` or `<textarea>` (L-365).
 *
 * Plain strings, on purpose. No wrapper component and no function that builds
 * a class list: the field-edge check in `styles/contrast.contract.test.ts`
 * follows a constant into this file and judges every edge colour it can show,
 * but it cannot read a function's result, so a helper would turn it red.
 * Choose between the two at the call site, with a ternary over the constants:
 *
 *   className={`mt-1 w-full ${error === undefined ? FIELD : FIELD_INVALID}`}
 *
 * Layout (margin, width, flex) is NOT here. It belongs to the place a box sits,
 * so it stays at the call site, after the constant.
 *
 * `fields.contract.test.ts` pins both values class for class and fails on a
 * hand-made copy in a folder that has moved onto them.
 */

/** The standard text box: field-line edge (3:1 on every surface), card fill, ink text. */
export const FIELD = 'rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink';

/** The same box with its edge in the danger red, for a value that will not save. */
export const FIELD_INVALID = 'rounded-control border border-danger bg-card px-2.5 py-1.5 text-ink';
