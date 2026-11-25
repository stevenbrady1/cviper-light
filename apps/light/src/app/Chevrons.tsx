/**
 * The drop-down's drawn arrow (L-461): one source for every real `<select>`
 * that switches the browser's own arrow off (`appearance-none`): the chips
 * (`ChipSelect.tsx`) and Search's Country and Contract type. It sits over the
 * drop-down's right-hand padding, so the parent must be `relative`.
 *
 * Hidden from screen readers, and a press goes through to the `<select>`. It
 * is `currentColor`, so Windows High Contrast still draws it.
 */
import { Icon } from '../ui/Icon';

export function SelectChevron() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-2.5 inline-flex -translate-y-1/2 rotate-90 text-ink-muted"
    >
      <Icon name="chevron" size={16} />
    </span>
  );
}
