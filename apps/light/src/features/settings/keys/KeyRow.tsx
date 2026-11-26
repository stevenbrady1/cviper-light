import { useId, useState, type ReactNode, type Ref } from 'react';

import { FoldMark } from '../../../app/Chevrons';
import { cardClasses } from '../../../ui';

/**
 * One key card as a short row that opens on click (L-390).
 *
 * The browser's own fold (`<details>`), like every other fold in the app: the
 * keyboard and "expanded/collapsed" for a screen reader come with it. The
 * open/closed mark is the app's drawn one (`FoldMark`, L-462). The title is one line: the name (still the card's heading), the
 * chosen model when there is one, and the status pill. Nothing in the title is
 * a button or a link — the whole title is the button.
 *
 * The title stays a line of text rather than a flex row, so the pill is pinned
 * right instead, with room kept for the widest pill ("Could not be read").
 */
export interface KeyRowProps {
  /** The card's test id, as before rows. */
  readonly cardTestId: string;
  /** The fold's own test id. */
  readonly rowTestId: string;
  readonly name: string;
  /** Said quietly after the name: the chosen model. */
  readonly model?: string | null | undefined;
  readonly modelTestId?: string | undefined;
  readonly pill: ReactNode;
  /** Read once, at first draw, so the row never snaps shut later (L-338). */
  readonly startOpen?: boolean | undefined;
  readonly cardRef?: Ref<HTMLElement> | undefined;
  readonly children: ReactNode;
}

export function KeyRow({
  cardTestId,
  rowTestId,
  name,
  model,
  modelTestId,
  pill,
  startOpen = false,
  cardRef,
  children,
}: KeyRowProps) {
  const headingId = useId();
  const [open] = useState(startOpen);

  return (
    <article
      ref={cardRef}
      data-testid={cardTestId}
      aria-labelledby={headingId}
      className={cardClasses({ padding: 'none' })}
    >
      <details data-testid={rowTestId} open={open}>
        {/*
          The browser's mark is off; the drawn one is one line high (`h-lh`), so
          with `py-2.5` every title is a whole 44px in WebKit and Chromium alike.
          Half a pixel more and the rows above Job boards leave that section on
          a half pixel, which a scroll cannot land on (L-364).
        */}
        <summary className="relative min-h-11 cursor-pointer list-none py-2.5 pr-36 pl-4 [&::-webkit-details-marker]:hidden">
          <FoldMark />
          <h3 id={headingId} className="inline font-medium text-ink">
            {name}
          </h3>
          {model ? (
            // Wraps whole, under the name, when the line is too narrow (a phone).
            <span
              data-testid={modelTestId}
              className="ml-2 inline-block max-w-full text-xs break-all text-ink-faint"
            >
              {model}
            </span>
          ) : null}
          <span className="absolute top-1/2 right-4 -translate-y-1/2">{pill}</span>
        </summary>
        <div className="px-4 pb-4">{children}</div>
      </details>
    </article>
  );
}
