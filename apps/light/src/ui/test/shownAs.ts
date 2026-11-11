/**
 * Test helper for L-369: what a control SHOWS, in order — each drawn `Icon` as
 * `[name]`, and every text node exactly.
 *
 * The control-icon version of L-362's `asShown`: a typed "↑" and a drawn
 * "[arrowUp]" are pinned the same way — which drawing, where, how many, and
 * nothing else beside it. An icon is recognised by its DRAWING (the paths
 * inside its `<svg>`), not by a class or attribute, so a button that drew the
 * wrong arrow, or a copy of the arrow by hand, would read differently.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ICON_NAMES, Icon, type IconName } from '../Icon';

/** The markup inside an icon's `<svg>`: what tells one drawing from another. */
function drawingOf(name: IconName): string {
  const holder = document.createElement('div');
  holder.innerHTML = renderToStaticMarkup(createElement(Icon, { name }));
  return holder.querySelector('svg')?.innerHTML ?? '';
}

/** `[name]` for a drawn icon, `[unknown svg]` for any other drawing. */
function nameOf(svg: Element): string {
  const drawing = svg.innerHTML;
  const name = ICON_NAMES.find((candidate) => drawingOf(candidate) === drawing);
  return name === undefined ? '[unknown svg]' : `[${name}]`;
}

export function shownAs(node: Node): string {
  if (node instanceof Element && node.tagName.toLowerCase() === 'svg') return nameOf(node);
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  return [...node.childNodes].map(shownAs).join('');
}

/** Every `<svg>` inside `element` is hidden from assistive tech and never takes focus. */
export function drawingsAreDecoration(element: Element): boolean {
  const drawings = [...element.querySelectorAll('svg')];
  return (
    drawings.length > 0 &&
    drawings.every(
      (svg) =>
        svg.getAttribute('aria-hidden') === 'true' && svg.getAttribute('focusable') === 'false',
    )
  );
}
