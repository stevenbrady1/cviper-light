/**
 * A small "…" button that shows and hides a short list of buttons (L-392).
 *
 * ============================================================================
 * A DISCLOSURE, NOT A POP-UP WINDOW
 * ============================================================================
 * It follows the WAI-ARIA disclosure pattern: one button with `aria-expanded`,
 * and the buttons it shows. So no dialog markers (`ui/Dialog.tsx` is the one
 * pop-up window, and `lib/one-dialog.contract.test.ts` forbids them anywhere
 * else), no focus trap and no arrow keys. The keyboard rules:
 *   * opening it puts focus on the first item that can be pressed;
 *   * Escape closes it and puts focus back on the trigger;
 *   * Tab past the last item closes it, and focus goes on as usual;
 *   * choosing an item closes it, puts focus back on the trigger, then runs it;
 *   * a press anywhere else closes it — so opening a second menu closes the first.
 * An item that cannot be used now is shown disabled, never left out.
 *
 * The trigger is the drawn "…" icon named by `label` for a screen reader, or,
 * with `showLabel`, the words of `label` themselves ("More formats").
 *
 * ============================================================================
 * WHY `z-10`
 * ============================================================================
 * The list hangs below its row and must paint over whatever comes next (the
 * next result card and its own "…"). The app's other stacking values are the
 * phone detail pane (`z-40`) and hints and the dialog (`z-50`); both must stay
 * above an open list, so it takes the lowest step on Tailwind's scale.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

import { Icon } from '../ui/Icon';

import { QUIET_BUTTON } from './buttons';

export interface MoreMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean | undefined;
  readonly testId?: string | undefined;
}

export interface MoreMenuProps {
  /** The trigger's name: spoken for the "…" icon, or shown with `showLabel`. */
  readonly label: string;
  readonly items: readonly MoreMenuItem[];
  /** Show `label` as the trigger's words instead of the "…" icon. */
  readonly showLabel?: boolean | undefined;
  readonly testId?: string | undefined;
}

export function MoreMenu({ label, items, showLabel = false, testId }: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[data-more-item]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    // `pointerdown`, not `click`: iPhone Safari sends no click for a tap on plain text or blank page.
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const closeToTrigger = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  // Only a move to somewhere known: in WebKit a pressed button does not take
  // focus, so a click on an item blurs to nothing and must not close the list
  // before its own click arrives.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    closeToTrigger();
  };

  return (
    <div ref={root} className="relative" onBlur={onBlur} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        data-testid={testId}
        aria-expanded={open}
        aria-label={showLabel ? undefined : label}
        onClick={() => setOpen((was) => !was)}
        className={QUIET_BUTTON}
      >
        {showLabel ? label : <Icon name="more" size={16} />}
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-10 mt-1 flex w-max min-w-40 flex-col gap-0.5 rounded-card border border-line bg-card p-1 shadow-overlay">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              data-more-item=""
              data-testid={item.testId}
              disabled={item.disabled}
              onClick={() => {
                closeToTrigger();
                item.onSelect();
              }}
              className={`${QUIET_BUTTON} justify-start`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
