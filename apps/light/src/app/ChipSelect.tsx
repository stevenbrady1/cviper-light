/**
 * A real drop-down (`<select>`) drawn as a chip, for a sentence of choices
 * such as "Check [Your CV] using [Ollama]" (L-442).
 *
 * Real, not a drawn menu (owner decision, 20 Nov 2026): the tests drive the
 * app's drop-downs by test id and `change` events, a phone opens its own
 * picker, and Windows High Contrast draws the list.
 *
 * Its name ("Your CV") is spoken, not shown: a hidden `<label>`. The chevron
 * is drawn, hidden from screen readers and lets a press through to the
 * drop-down under it.
 *
 * There is NO `className` prop, on purpose: the field-edge check in
 * `styles/contrast.contract.test.ts` must be able to read every class the
 * drop-down can wear, and it fails by name on one passed in from outside.
 */
import { SelectChevron } from './Chevrons';
import { FIELD_CHIP } from './fields';

export interface ChipSelectOption {
  readonly value: string;
  readonly label: string;
  /**
   * What the chip shows and says for this item when it is more than `label`:
   * Tailor's "CV.docx · 185 words" (L-445). Drawn as the `<option>`'s own
   * `label` attribute, so its text stays `label` and the item is still found
   * by its name alone.
   */
  readonly shown?: string | undefined;
}

export interface ChipSelectProps {
  readonly id: string;
  /** The spoken name: the hidden label's words. */
  readonly name: string;
  readonly testId?: string | undefined;
  readonly value: string;
  readonly options: readonly ChipSelectOption[];
  /** The words of a first option whose value is `""`, when there should be one. */
  readonly empty?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: string) => void;
}

export function ChipSelect({
  id,
  name,
  testId,
  value,
  options,
  empty,
  disabled,
  onChange,
}: ChipSelectProps) {
  return (
    <span className="relative inline-flex max-w-full min-w-0">
      <label htmlFor={id} className="sr-only">
        {name}
      </label>
      {/* `min-h-11` below `md`: a thumb target, like the buttons (app/buttons.ts). */}
      <select
        id={id}
        data-testid={testId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        className={`${FIELD_CHIP} min-h-11 max-w-full min-w-0 md:min-h-0`}
      >
        {empty === undefined ? null : <option value="">{empty}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} label={option.shown}>
            {option.label}
          </option>
        ))}
      </select>
      <SelectChevron />
    </span>
  );
}
