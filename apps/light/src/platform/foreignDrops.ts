/**
 * Refusing files and links dropped onto the window (L-186).
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 * Tracker cards move between columns by HTML5 drag-and-drop. On Windows that
 * only works with Tauri's native drag-and-drop handler OFF (`dragDropEnabled:
 * false` in `tauri.conf.json`): left on, wry replaces WebView2's drop target
 * with one that only understands dropped files, and no in-page drag ever lands
 * (issue #152). See `lib/html5-drag-and-drop.contract.test.ts`.
 *
 * Turning it off hands file drops back to WebView2, which does what Chromium
 * does with a file or a link dropped on a page that did not claim it: it
 * NAVIGATES there. Drop a CV PDF anywhere in the app and the app is gone,
 * replaced by a PDF viewer with no back button. Every `<a>` is draggable too, so
 * the advert link in the detail pane dropped back onto the page would load the
 * job site inside this window — the in-app browser `browser.ts` promises there
 * is not. The native handler used to refuse both by accident; this refuses them
 * on purpose.
 *
 * ============================================================================
 * WHAT IT LEAVES ALONE
 * ============================================================================
 * - A drag something in the app already claimed. It listens on the window, in
 *   the bubble phase, so a tracker column's own `preventDefault` has run first.
 *   Overwriting that column's `dropEffect` would switch the board off again.
 * - Plain text. Dragging a selection into a field is a normal thing to do, and
 *   a dropped string does not navigate anywhere.
 */

/** Drag payload types that make the web view navigate when dropped. */
const NAVIGATING_TYPES: readonly string[] = ['Files', 'text/uri-list'];

function carriesNavigatingPayload(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  if (types === undefined || types === null) return false;
  // `types` is a frozen array in Chromium and a DOMStringList in older
  // engines; `Array.from` reads both.
  return Array.from(types).some((type) => NAVIGATING_TYPES.includes(type));
}

/**
 * Install the refusal on `target` (the window). Returns the uninstaller, for
 * tests.
 */
export function refuseForeignDrops(target: Window): () => void {
  const onDragOver = (event: DragEvent): void => {
    if (event.defaultPrevented || !carriesNavigatingPayload(event)) return;
    // Cancelling dragover with `none` shows the "no drop" cursor AND tells the
    // engine the drop is refused, so it neither fires `drop` nor navigates.
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'none';
  };

  const onDrop = (event: DragEvent): void => {
    // Belt and braces for an engine that fires `drop` anyway.
    if (event.defaultPrevented || !carriesNavigatingPayload(event)) return;
    event.preventDefault();
  };

  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
