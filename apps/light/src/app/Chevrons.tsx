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

/**
 * A fold's drawn mark (L-462), first drawn on "Where to look" (L-437): points
 * right when closed and turns down when its OWN fold is open. The fold's title
 * switches the browser's mark off (`list-none [&::-webkit-details-marker]:hidden`)
 * and puts this first. Not `group-open:`: Settings nests folds, and that would
 * turn a closed row's mark whenever the fold around it is open.
 */
export function FoldMark({ testId }: { readonly testId?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className="mr-2 inline-flex h-lh items-center align-top text-ink-muted [details[open]>summary>&]:rotate-90"
    >
      <Icon name="chevron" size={16} />
    </span>
  );
}
