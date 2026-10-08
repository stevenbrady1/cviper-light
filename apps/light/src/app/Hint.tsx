/**
 * A short explanation for a symbol, badge or abbreviation (L-215).
 *
 * ============================================================================
 * WHY EVERY SYMBOL GETS ONE
 * ============================================================================
 * The app says a lot with a few marks — ✓ ⚠ ▲ ▼ on the ATS score, ● ○ ⊘ on
 * the step bar, coloured dots in the rail — and a mark only helps someone who
 * already knows what it means. A hint says it in words, where the mark is,
 * without sending anybody to a help page.
 *
 * ============================================================================
 * THREE WAYS IN, AND ONE THAT IS ALWAYS THERE
 * ============================================================================
 *   * hover with a mouse;
 *   * keyboard focus — a plain mark is made focusable for this, so Tab finds
 *     it — and Escape closes it;
 *   * a tap on a touch screen, which toggles it.
 * And a screen reader gets the same words at all times through
 * `aria-describedby`: the tip stays in the page while it is hidden, so the
 * description never depends on anything having been hovered.
 *
 * A mark that is already a button (a step on the step bar, a rail item) uses
 * the render-function form: the button keeps its own click and takes the
 * hint's handlers and description, rather than being wrapped in a second
 * focus stop.
 *
 * The tip is drawn in a portal with fixed positioning, below the mark (above
 * it when there is no room), and kept 8px inside the window at both sides —
 * so a hint on the last column of a table on a 375px phone does not run off
 * the screen.
 */
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** What a trigger needs to carry the hint. Spread it onto the element. */
export interface HintTriggerProps {
  readonly ref: (element: HTMLElement | null) => void;
  readonly 'aria-describedby': string;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: (event: FocusEvent<HTMLElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export interface HintProps {
  /** The explanation, in a sentence or two of plain words. */
  readonly text: string;
  /** The mark itself, or a render function for a trigger that is already interactive. */
  readonly children: ReactNode | ((trigger: HintTriggerProps) => ReactNode);
  /** Extra classes for the mark's own wrapper (its colour, its spacing). */
  readonly className?: string | undefined;
  /**
   * A name for the mark when its content is hidden from screen readers (a row
   * of dots): without one, Tab would land on something with nothing to say.
   */
  readonly label?: string | undefined;
  /**
   * `false` keeps the mark out of the Tab order: hover and tap only. For a
   * mark repeated many times whose meaning is already spoken another way —
   * a tracker card's dots carry "3 of 5 steps done" as screen-reader text —
   * where a Tab stop on every card would only slow a keyboard user down.
   */
  readonly focusable?: boolean | undefined;
}

/** Space kept between the tip and the edge of the window, and the mark. */
const EDGE = 8;
const GAP = 6;

export function Hint({ text, children, className, label, focusable = true }: HintProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    if (!open || trigger.current === null || tip.current === null) return;
    const mark = trigger.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const centred = mark.left + mark.width / 2 - box.width / 2;
    const left = Math.max(EDGE, Math.min(centred, width - box.width - EDGE));
    const below = mark.bottom + GAP;
    const top = below + box.height > height - EDGE ? mark.top - box.height - GAP : below;
    setPlace({ top: Math.max(EDGE, top), left });
  }, [open]);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const props: HintTriggerProps = {
    ref: (element) => {
      trigger.current = element;
    },
    'aria-describedby': id,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onKeyDown: (event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        hide();
      }
    },
  };

  const tooltip = createPortal(
    <span
      ref={tip}
      id={id}
      role="tooltip"
      hidden={!open}
      data-testid="hint"
      style={{ top: place.top, left: place.left }}
      className="pointer-events-none fixed z-50 w-max max-w-64 rounded-control bg-navy px-2.5 py-1.5 text-left font-sans text-xs leading-snug font-normal tracking-normal text-ink-inverse normal-case shadow-overlay"
    >
      {text}
    </span>,
    document.body,
  );

  if (typeof children === 'function') {
    return (
      <>
        {children(props)}
        {tooltip}
      </>
    );
  }

  return (
    <>
      <span
        {...props}
        tabIndex={focusable ? 0 : undefined}
        aria-label={label}
        onClick={() => setOpen((was) => !was)}
        className={`cursor-help underline decoration-dotted decoration-1 underline-offset-2 ${className ?? ''}`}
      >
        {children}
      </span>
      {tooltip}
    </>
  );
}
