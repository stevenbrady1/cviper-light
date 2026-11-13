import { useId, useState, type ReactNode, type Ref } from 'react';

import { cardClasses } from '../../../ui';

/**
 * One key card as a short row that opens on click (L-390).
 *
 * The browser's own fold (`<details>`), like every other fold in the app: the
 * keyboard, the open/closed mark and "expanded/collapsed" for a screen reader
 * come with it. The title is one line: the name (still the card's heading), the
 * chosen model when there is one, and the status pill. Nothing in the title is
 * a button or a link — the whole title is the button.
 *
 * The title stays `display: list-item`, so the browser draws its own mark. A
 * flex title would lose it, so the pill is pinned right instead, with room kept
 * for the widest pill ("Could not be read").
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
          `marker:text-sm`: at 16px WebKit's fold mark makes the line half a
          pixel taller (44.5px), and seven rows above Job boards leave that
          section on a half pixel, which a scroll cannot land on (L-364). At
          14px every title is a whole 44px in WebKit and Chromium alike; the
          metric prompts fold already draws its mark at this size.
        */}
        <summary className="relative min-h-11 cursor-pointer py-2.5 pr-36 pl-4 marker:text-sm">
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
