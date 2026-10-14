import { type HTMLAttributes, type ReactNode } from 'react';

/**
 * The one card. Every box that holds content sits in one of these.
 *
 * Card radius, a `line` border, the `raised` elevation, white on the canvas.
 *
 * `featured` is the single card a screen wants the user to start with: the
 * border takes the ACTION colour, because "start here" is a call to act. Like
 * the primary button it is a one-per-view thing — two featured cards and
 * neither is.
 *
 * `interactive` adds the only hover this app allows a card: the border
 * strengthens a little. No lift, no shadow change, no scale — the motion
 * budget in `theme.css` is spent elsewhere.
 */

const PADDING = {
  default: 'p-4',
  roomy: 'p-5',
  none: '',
} as const;

type CardElement = 'div' | 'section' | 'article' | 'aside' | 'li';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly as?: CardElement;
  readonly featured?: boolean;
  readonly interactive?: boolean;
  readonly padding?: keyof typeof PADDING;
  readonly children?: ReactNode;
  readonly 'data-testid'?: string;
}

/** The class string alone, for the few places a card is drawn by an element this cannot wrap. */
export function cardClasses({
  featured = false,
  interactive = false,
  padding = 'default',
}: Pick<CardProps, 'featured' | 'interactive' | 'padding'> = {}): string {
  const edge = featured
    ? 'border-blue'
    : `border-line${interactive ? ' hover:border-navy/30' : ''}`;
  return ['rounded-card border bg-card shadow-raised', edge, PADDING[padding]]
    .filter((part) => part !== '')
    .join(' ');
}

export function Card({
  as: Element = 'div',
  featured = false,
  interactive = false,
  padding = 'default',
  className,
  children,
  ...rest
}: CardProps) {
  const classes = cardClasses({ featured, interactive, padding });
  return (
    <Element
      {...rest}
      {...(featured ? { 'data-featured': 'true' } : {})}
      className={className === undefined ? classes : `${classes} ${className}`}
    >
      {children}
    </Element>
  );
}
