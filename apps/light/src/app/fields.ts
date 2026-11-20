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
 * `fields.contract.test.ts` pins every value class for class and fails on a
 * hand-made copy in a folder that has moved onto them.
 */

/** The standard text box: field-line edge (3:1 on every surface), card fill, ink text. */
export const FIELD = 'rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink';

/** The same box with its edge in the danger red, for a value that will not save. */
export const FIELD_INVALID = 'rounded-control border border-danger bg-card px-2.5 py-1.5 text-ink';

/**
 * The smaller box (L-376): a picker that sits on one line beside its label or
 * button: Tailor's application picker. (The tracked-job pickers on Tailor and
 * Analysis are chips since L-445 and L-446.) Same edge, fill and text as FIELD;
 * only the vertical padding is smaller (`py-1`, not `py-1.5`). Never put
 * `py-1` after FIELD to get this: two padding classes on one box leave the
 * winner to the stylesheet.
 */
export const FIELD_COMPACT =
  'rounded-control border border-field-line bg-card px-2.5 py-1 text-ink';

/**
 * A real drop-down drawn as a chip, inside a sentence of choices (L-442):
 * "Check [Your CV] using [Ollama]". `app/ChipSelect.tsx` wears it. The browser's
 * own look is switched off (`appearance-none`), so the chip is the grey fill,
 * the field edge (3:1, L-212) and a drawn chevron, which needs the room on the
 * right. `field-sizing-content` makes it as wide as the chosen item, not the
 * longest one, where the browser supports it. Disabled is greyed, never hidden.
 */
export const FIELD_CHIP =
  'appearance-none field-sizing-content rounded-control border border-field-line bg-sunken py-1.5 pr-8 pl-3 text-ink disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-faint';

/**
 * The big text box of the composer (L-442): the top half of one box whose
 * bottom half is COMPOSER_BAR. The field edge on top, left and right, round top
 * corners, and roomy padding. The screen writes the `<textarea>` itself, so
 * the field-edge check can read its className.
 */
export const COMPOSER_EDITOR =
  'rounded-t-card border-x border-t border-field-line bg-card px-3.5 py-3 text-ink';

/**
 * The bar under the composer's text box (L-442), holding the main button: the
 * field edge on left, right and bottom, round bottom corners, and a hairline
 * in the divider colour between it and the text box above.
 */
export const COMPOSER_BAR =
  'rounded-b-card border border-field-line border-t-line bg-card px-3 py-2.5';
