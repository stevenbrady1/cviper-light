import { type ReactNode } from 'react';

/**
 * A small rounded label that says what state something is in.
 *
 * ============================================================================
 * FOUR TONES, AND EACH ONE IS A MEANING FROM THE COLOUR GRAMMAR
 * ============================================================================
 *   ready      teal   present, works now, fresh
 *   attention  gold   needs the user, going quiet
 *   neutral    —      a plain fact with no judgement in it
 *   danger     red    destructive or rejected. Nothing else.
 *
 * There is no blue pill and no navy pill. Blue is action and navy is
 * structure; a status is neither, and a pill wearing either would teach the
 * user that colour means nothing in particular.
 *
 * Words use the `-ink` text tokens (L-209): brand teal and gold are marks, and
 * on their own 10% tint they fall under 4.5:1 as text.
 *
 * An unknown tone — only reachable from untyped data, since `PillTone` is a
 * closed union — falls back to NEUTRAL. Falling back to a colour would put a
 * meaning on screen that nothing decided.
 */

export const PILL_TONES = ['ready', 'attention', 'neutral', 'danger'] as const;

export type PillTone = (typeof PILL_TONES)[number];

const TONE: Record<PillTone, string> = {
  ready: 'bg-teal/10 text-teal-ink',
  attention: 'bg-gold/10 text-gold-ink',
  neutral: 'bg-sunken text-ink-muted',
  danger: 'bg-danger/10 text-danger',
};

export interface StatusPillProps {
  readonly tone: PillTone;
  readonly children: ReactNode;
  readonly 'data-testid'?: string;
}

export function StatusPill({ tone, children, 'data-testid': testId }: StatusPillProps) {
  const safe: PillTone = PILL_TONES.includes(tone) ? tone : 'neutral';

  return (
    <span
      data-testid={testId}
      data-tone={safe}
      className={`inline-flex w-fit items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium ${TONE[safe]}`}
    >
      {children}
    </span>
  );
}
