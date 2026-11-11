/**
 * Scroll one scroll area to bring an anchor to its top — and nothing else (L-216).
 *
 * ============================================================================
 * WHY NOT `scrollIntoView`
 * ============================================================================
 * `scrollIntoView` scrolls EVERY box between the anchor and the window until
 * the anchor is where it was asked to be — including boxes that hide their
 * overflow, like the page itself (`body { overflow: hidden }`) and the app
 * shell. When a step sits near the end of Tailor's content, the screen's own
 * scroll area runs out of room first, so the browser carried on and scrolled
 * the shell: the whole window slid up, the rail cut off at the top and the
 * bottom half left blank.
 *
 * Here the caller names the one area that may move. If the anchor is not
 * inside it, nothing moves.
 *
 * Measured from where the area's content STARTS, below its own top padding
 * (L-353). From the outer edge, an anchor at the very start of a padded area
 * read as 20px away, so Tailor opened 20px down; and an anchor further down
 * landed flush against the edge. Now the first anchor leaves the area at the
 * top, and every other one lands with the same padding gap above it.
 */
export function scrollWithin(container: HTMLElement, anchor: HTMLElement): void {
  if (!container.contains(anchor)) return;
  const padding = parseFloat(getComputedStyle(container).paddingTop) || 0;
  const offset =
    anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - padding;
  const top = Math.max(0, container.scrollTop + offset);
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, behavior: 'smooth' });
  } else {
    container.scrollTop = top;
  }
}
