import { type BrowserPort } from '../../platform/browser';

import { CVIPER_PRIVACY_URL, CVIPER_URL } from './links';

/**
 * A signpost: one line of plain text that opens the browser when tapped.
 *
 * ============================================================================
 * THE GATEWAY IS DATA, NOT LOCKS (L-87)
 * ============================================================================
 * Light is the free front door for the full CViper. There are exactly three
 * places it says so, each in one sentence, each opening the browser only when
 * tapped. No badge, no modal, no count, no timer, no state: the same text
 * every time, so a signpost can never turn into a nag. Two tests hold that —
 * `Signpost.test.tsx` for the behaviour and
 * `signposts.stateless.contract.test.ts` for the source.
 *
 * The result of `browser.open` is deliberately not shown. Showing it would
 * need state, and the worst case — a machine with no default browser — is a
 * tap that does nothing, on a line that was never in the user's way.
 */

export type SignpostId = 'analysis' | 'tracker' | 'privacy';

export interface SignpostCopy {
  /** The one sentence. Never changes at runtime. */
  readonly text: string;
  /** Handed to the browser byte-for-byte. */
  readonly url: string;
}

export const SIGNPOSTS: Readonly<Record<SignpostId, SignpostCopy>> = {
  analysis: {
    text: 'cviper.ai keeps this rule set live and runs it across every job you save.',
    url: CVIPER_URL,
  },
  tracker: {
    text: 'cviper.ai syncs this to your phone and sends reminders.',
    url: CVIPER_URL,
  },
  privacy: {
    text: 'Light never talks to us. The full CViper does, and here is exactly what it keeps.',
    url: CVIPER_PRIVACY_URL,
  },
};

export interface SignpostProps {
  readonly id: SignpostId;
  readonly browser: BrowserPort;
}

export function Signpost({ id, browser }: SignpostProps) {
  const { text, url } = SIGNPOSTS[id];
  return (
    <p data-testid={`signpost-${id}`} className="text-xs text-ink-faint">
      {/* 44px tall on a phone (L-81), its natural height above `md`. */}
      <button
        type="button"
        data-testid={`signpost-${id}-open`}
        onClick={() => void browser.open(url)}
        className="min-h-11 text-left text-ink-faint underline-offset-2 hover:text-ink hover:underline md:min-h-0"
      >
        {text}
      </button>
      <span className="ml-2">Opens in your browser.</span>
    </p>
  );
}
