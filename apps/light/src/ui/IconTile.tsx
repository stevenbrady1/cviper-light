import { Icon, type IconName } from './Icon';

/**
 * An icon in a tinted square: the mark at the head of a card or a section.
 *
 * The tint is the meaning, so the tones are the colour grammar and nothing
 * else (see `styles/theme.css`):
 *
 *   navy    structure — the default; a section that is simply a section
 *   blue    action — the ONE featured thing on a screen ("Start here")
 *   teal    present / ready
 *   gold    attention
 *   danger  destructive — the erase section, and nowhere else
 *
 * The square uses the CONTROL radius, not the card radius: it is a small
 * object sitting inside a card, and a 12px corner on a 36px square reads as a
 * circle that gave up.
 */

export type IconTileTone = 'navy' | 'blue' | 'teal' | 'gold' | 'danger';

const TONE: Record<IconTileTone, string> = {
  navy: 'bg-navy/10 text-navy',
  blue: 'bg-blue/10 text-blue',
  teal: 'bg-teal/10 text-teal-ink',
  gold: 'bg-gold/10 text-gold-ink',
  danger: 'bg-danger/10 text-danger',
};

const SIZE = {
  sm: { box: 'size-8', icon: 16 },
  md: { box: 'size-10', icon: 20 },
} as const;

export interface IconTileProps {
  readonly icon: IconName;
  readonly tone?: IconTileTone;
  readonly size?: keyof typeof SIZE;
}

export function IconTile({ icon, tone = 'navy', size = 'md' }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-control ${SIZE[size].box} ${TONE[tone] ?? TONE.navy}`}
    >
      <Icon name={icon} size={SIZE[size].icon} />
    </span>
  );
}
