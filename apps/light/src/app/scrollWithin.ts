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
 */
export function scrollWithin(container: HTMLElement, anchor: HTMLElement): void {
  if (!container.contains(anchor)) return;
  const offset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const top = Math.max(0, container.scrollTop + offset);
  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top, behavior: 'smooth' });
  } else {
    container.scrollTop = top;
  }
}
