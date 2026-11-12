import { type ComponentType, type ReactNode } from 'react';

import { type IconName } from './Icon';
import { IconTile } from './IconTile';
import { type NavIconProps } from './NavIcons';

/**
 * The top of a screen: what it is, one muted line on what it is for, and —
 * optionally — the screen's actions.
 *
 * `actions` is where a view's SINGLE blue primary button goes (`app/buttons.ts`).
 *
 * Two shapes, one grammar:
 *
 *   bar   the header strip across the top of every view in the shell. Card
 *         white with a line under it, so it reads as the frame of the screen.
 *   hero  the welcome page, which owns the whole window and has no frame to
 *         sit in. Bigger title, no strip.
 */

/*
 * The title ladder (L-382): the display serif at regular weight, 24px page
 * titles, 20px section titles, 30px (36px from md) on the welcome page.
 * Newsreader ships one weight, 400, so `font-normal` is said outright: a bold
 * parent would otherwise make the browser fake a bold serif. `lining-nums`
 * because its default figures wobble on the baseline.
 * `heading-ladder.contract.test.ts` holds all of this.
 */
export const PAGE_TITLE = 'font-display text-2xl font-normal text-ink lining-nums';
export const SECTION_TITLE = 'font-display text-xl font-normal text-ink lining-nums';
export const HERO_TITLE = 'font-display text-3xl font-normal text-ink lining-nums md:text-4xl';

export interface PageHeaderProps {
  readonly title: string;
  readonly subtitle: ReactNode;
  readonly actions?: ReactNode;
  readonly icon?: IconName | undefined;
  /** A view's duotone navigation drawing, used in place of `icon` (L-254). */
  readonly glyph?: ComponentType<NavIconProps> | undefined;
  readonly variant?: 'bar' | 'hero';
  /** Above the title in `hero`: the brand row. */
  readonly eyebrow?: ReactNode;
  /** `bar`: caps and centres the title row, to line up with the content below (L-326). */
  readonly column?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions = null,
  icon,
  glyph,
  variant = 'bar',
  eyebrow = null,
  column = '',
}: PageHeaderProps) {
  const actionsBox =
    actions === null ? null : (
      <div data-slot="actions" className="shrink-0">
        {actions}
      </div>
    );

  if (variant === 'hero') {
    return (
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {eyebrow}
          <h1 className={`mt-3 ${HERO_TITLE}`}>{title}</h1>
          <p className="mt-1 text-base text-ink-muted">{subtitle}</p>
        </div>
        {actionsBox}
      </header>
    );
  }

  return (
    <header className="border-b border-line bg-card px-4 py-2.5 md:px-6 md:py-3.5">
      <div
        className={`flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4 ${column}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {glyph !== undefined ? (
            <IconTile glyph={glyph} />
          ) : icon !== undefined ? (
            <IconTile icon={icon} />
          ) : null}
          <div className="min-w-0">
            <h1 className={PAGE_TITLE}>{title}</h1>
            <p className="text-ink-muted">{subtitle}</p>
          </div>
        </div>
        {actionsBox}
      </div>
    </header>
  );
}

export interface SectionHeadingProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: IconName | undefined;
  readonly tone?: 'navy' | 'danger';
  readonly level?: 2 | 3;
  /** Right-hand side of the heading row: a pill, a count, a quiet control. */
  readonly aside?: ReactNode;
  readonly id?: string;
}

/**
 * The head of a section inside a screen: an icon tile, the heading, and one
 * muted line under it. The in-page counterpart of `PageHeader`.
 */
export function SectionHeading({
  title,
  description,
  icon,
  tone = 'navy',
  level = 2,
  aside = null,
  id,
}: SectionHeadingProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex items-start gap-3">
      {icon === undefined ? null : <IconTile icon={icon} tone={tone} size="sm" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Heading id={id} className={SECTION_TITLE}>
            {title}
          </Heading>
          {aside}
        </div>
        {description === undefined ? null : <p className="mt-0.5 text-ink-muted">{description}</p>}
      </div>
    </div>
  );
}
