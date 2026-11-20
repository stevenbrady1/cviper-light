/**
 * The layout Analysis and Tailor share (L-442): a sentence of chips above one
 * big box, and quiet notes under it. Layout only; every word comes from the
 * screen.
 *
 * In order:
 *   * `sentence`  the chip row ("Check [Your CV] using [Ollama]");
 *   * `notices`   messages about the CV or the job;
 *   * `editor`    the text box, written by the screen with COMPOSER_EDITOR so
 *                 the field-edge check can read its className;
 *   * the bar     inside the box, under the text box: `barStart` on the left,
 *                 `barEnd` (the reason and the main button) on the right. It
 *                 wraps on a phone;
 *   * `footnotes` everything under the box.
 *
 * An empty slot draws nothing. `barEnd` is required: the bar closes the box,
 * and the main button is always there (disabled, never hidden).
 */
import { type ReactNode } from 'react';

import { COMPOSER_BAR } from './fields';

export interface ComposerProps {
  readonly sentence?: ReactNode;
  readonly notices?: ReactNode;
  readonly editor: ReactNode;
  readonly barStart?: ReactNode;
  readonly barEnd: ReactNode;
  readonly footnotes?: ReactNode;
  readonly testId?: string | undefined;
}

/** `null`, `undefined`, `false` and `''` draw nothing in React, so they leave no box either. */
function filled(slot: ReactNode): boolean {
  return slot !== null && slot !== undefined && slot !== false && slot !== '';
}

export function Composer({
  sentence,
  notices,
  editor,
  barStart,
  barEnd,
  footnotes,
  testId,
}: ComposerProps) {
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {filled(sentence) ? (
        <div data-slot="sentence" className="flex flex-wrap items-center gap-2">
          {sentence}
        </div>
      ) : null}
      {filled(notices) ? <div data-slot="notices">{notices}</div> : null}
      <div data-slot="box" className="flex flex-col">
        {editor}
        <div
          data-testid="composer-bar"
          className={`${COMPOSER_BAR} flex flex-wrap items-center justify-between gap-3`}
        >
          {filled(barStart) ? (
            <div data-slot="bar-start" className="max-w-full min-w-0">
              {barStart}
            </div>
          ) : null}
          <div data-slot="bar-end" className="ml-auto flex flex-wrap items-center gap-3">
            {barEnd}
          </div>
        </div>
      </div>
      {filled(footnotes) ? <div data-slot="footnotes">{footnotes}</div> : null}
    </div>
  );
}
