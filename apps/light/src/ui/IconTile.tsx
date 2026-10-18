import { type ComponentType } from 'react';

import { Icon, type IconName } from './Icon';
import { type NavIconProps } from './NavIcons';

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
 *
 * A tile that stands for one of the six VIEWS takes that view's duotone
 * navigation drawing as `glyph` instead of an `Icon` name (L-254), so a view
 * looks the same in its header and on the welcome page as it does in the rail.
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
  sm: { box: 'size-8', icon: 16, glyph: 'size-5' },
  md: { box: 'size-10', icon: 20, glyph: 'size-6' },
} as const;

interface IconTileBase {
  readonly tone?: IconTileTone;
  readonly size?: keyof typeof SIZE;
}

export type IconTileProps = IconTileBase &
  (
    | { readonly icon: IconName; readonly glyph?: never }
    | { readonly glyph: ComponentType<NavIconProps>; readonly icon?: never }
  );

export function IconTile({ icon, glyph: Glyph, tone = 'navy', size = 'md' }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-control ${SIZE[size].box} ${TONE[tone] ?? TONE.navy}`}
    >
      {Glyph !== undefined ? (
        <Glyph className={SIZE[size].glyph} />
      ) : icon !== undefined ? (
        /* A danger tile is one colour: no teal accent inside it (L-256). */
        <Icon name={icon} size={SIZE[size].icon} monochrome={tone === 'danger'} />
      ) : null}
    </span>
  );
}
