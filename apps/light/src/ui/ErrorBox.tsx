import { type ReactNode } from 'react';

/**
 * The one error box (L-368). An error message the user must not miss.
 *
 * About twenty were built by hand, in two shapes, and copies drift: Profile's
 * strip had a grey bottom line where every other strip had a red-tinted one.
 *
 * ============================================================================
 * TWO SHAPES, ONE PART
 * ============================================================================
 *   strip   full width, straight under a screen's header, a red-tinted line
 *           along the bottom. `layout="row"` lays it out as a row, for a strip
 *           with a control (Retry) at the end of the line: Tracker's two.
 *   box     a rounded red-tinted box inside a panel. `gapAbove` is the space
 *           above it that the hand-built boxes carry. `as="div"` draws it as
 *           a `div`, for a box that holds paragraphs or a list (L-377).
 *
 * One component with a `variant`, not two exports: the alert role, and later
 * the check that forbids hand-built copies, have one name to point at.
 *
 * ============================================================================
 * ALWAYS AN ALERT
 * ============================================================================
 * `role="alert"` is not a prop. The props are a closed list and nothing is
 * spread onto the element, so a caller cannot change the role, remove it, or
 * restyle the box. A message that only LOOKS like an error but must not
 * interrupt (the update check's "could not check") is not an ErrorBox.
 *
 * The classes are exactly what the hand-built ones carried, class for class,
 * so moving a screen onto this part changes nothing it draws — plus one.
 *
 * ============================================================================
 * A WORD TOO LONG FOR ITS LINE BREAKS (L-374)
 * ============================================================================
 * An error often carries a file path or a web address: a "word" with no spaces.
 * Without a rule it ran past the edge of the strip in a narrow window, cut off
 * where nobody could read it, and pushed Tracker's Retry off screen. Every
 * shape carries `break-words` (`overflow-wrap: break-word`). It only acts on a
 * word that cannot fit on a line of its own, so a sentence wraps at exactly the
 * same words as before. Not `break-all`, which would split ordinary words.
 */

/** Under a screen's header (Analysis, Tailor, Tracker, Profile). */
const STRIP = 'border-b border-danger/30 bg-danger/5 px-4 py-2 break-words text-danger md:px-6';
/** Inside a panel (settings, CV upload, search, …). */
const BOX = 'rounded-control bg-danger/5 px-3 py-2 break-words text-danger';

interface Common {
  readonly testId: string;
  /** The message. A row strip also holds its control, e.g. a Retry button. */
  readonly children: ReactNode;
}

export interface ErrorStripProps extends Common {
  readonly variant: 'strip';
  /**
   * `row`: the message and a control side by side (Tracker). The children are
   * drawn as given, so the caller wraps the message in its own `<span>`, and
   * gives it `className="min-w-0"`. A flex item is never narrower than its
   * longest word unless told, so without it a long path pushes the control
   * off screen however the words are allowed to break (L-374).
   */
  readonly layout?: 'text' | 'row';
}

export interface ErrorPanelBoxProps extends Common {
  readonly variant: 'box';
  readonly gapAbove?: 'mt-2' | 'mt-3';
  /**
   * `div`: a box that holds blocks, not just words (L-377). A `<p>` cannot hold
   * a `<ul>` or another `<p>`, and Settings' notice (two paragraphs) and Erase
   * everything's failure (a paragraph and a list) are two of the boxes. Only
   * the element changes: the classes, the role and the test id are the same.
   * Chosen by the caller, not guessed from the children: a component child that
   * draws a `<p>` cannot be seen from here, and a wrong guess is invalid HTML.
   */
  readonly as?: 'p' | 'div';
}

export type ErrorBoxProps = ErrorStripProps | ErrorPanelBoxProps;

export function ErrorBox(props: ErrorBoxProps) {
  const { testId, children } = props;

  if (props.variant === 'strip' && props.layout === 'row') {
    return (
      <div
        role="alert"
        data-testid={testId}
        className={`flex items-center justify-between gap-3 ${STRIP}`}
      >
        {children}
      </div>
    );
  }

  const className =
    props.variant === 'strip'
      ? STRIP
      : props.gapAbove === undefined
        ? BOX
        : `${props.gapAbove} ${BOX}`;

  if (props.variant === 'box' && props.as === 'div') {
    return (
      <div role="alert" data-testid={testId} className={className}>
        {children}
      </div>
    );
  }

  return (
    <p role="alert" data-testid={testId} className={className}>
      {children}
    </p>
  );
}
