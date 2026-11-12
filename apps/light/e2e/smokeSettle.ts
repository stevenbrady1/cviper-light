/**
 * A smoke picture is taken only when the screen has stopped changing (L-375).
 *
 * ============================================================================
 * WHY A FIXED PAUSE WAS NOT ENOUGH
 * ============================================================================
 * The pictures are compared byte for byte to prove a change left the screens
 * alone, so the same code must give the same picture every time. Before this,
 * each picture waited a fixed 600ms and hoped, and the same commit gave
 * different pictures. What differed was NOT a fade caught half-way — a
 * diagnostic run found every picture already steady for 2.4 seconds after it
 * was taken — but two states that depended on timing and then stayed:
 *
 *   * the real Windows cursor, parked by the runner in the middle of the
 *     screen, hovering whatever was there (`moveOsPointerArgs` below);
 *   * a handful of anti-aliased pixels on curved edges, drawn differently
 *     depending on which parts of the screen had been redrawn on the way
 *     (`smoke.spec.ts` paints the whole page afresh before each picture).
 *
 * So waiting is only one of three things done before a picture, and the
 * stillness check below is the last line, not the fix on its own.
 *
 * ============================================================================
 * WHAT "STILL" MEANS HERE
 * ============================================================================
 *   1. nothing is animating: no CSS animation or transition is running or about
 *      to start (`document.getAnimations()`);
 *   2. the fonts have finished loading (`document.fonts.status`);
 *   3. two frames in a row are the same picture, byte for byte, AND no element
 *      with a test id moved or resized between them.
 * The picture returned is the second of those two frames — a frame that has
 * been seen twice, not one taken a moment after a check.
 *
 * A screen that never gets there FAILS, with a sentence naming what kept
 * changing. It never returns a picture to save.
 */

/** What the page says about itself at one moment. */
export interface StillProbe {
  /** Every animation or transition running now, as `<kind> <name> on <element>`. */
  readonly running: readonly string[];
  /** `document.fonts.status`: `'loaded'` or `'loading'`. */
  readonly fonts: string;
  /** Every element with a test id, as `<id> <left>,<top>,<width>,<height>`. */
  readonly layout: readonly string[];
}

/**
 * The in-page half: run by WebDriver, returns a `StillProbe`.
 *
 * Plain JavaScript in a string, like the checks in `smokePictures.ts`, because
 * it runs inside the web view. `smoke-settle.test.ts` runs this exact string.
 */
export const SETTLE_PROBE = String.raw`
function describe(element) {
  if (!element || !element.tagName) return '(no element)';
  const id = element.getAttribute('data-testid');
  return element.tagName.toLowerCase() + (id ? '[' + id + ']' : '');
}
function round(n) {
  return Math.round(n * 100) / 100;
}
const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
const running = [];
for (const animation of animations) {
  if (animation.playState !== 'running' && !animation.pending) continue;
  const kind = animation.transitionProperty !== undefined
    ? 'transition ' + animation.transitionProperty
    : 'animation ' + (animation.animationName || animation.id || '(unnamed)');
  running.push(kind + ' on ' + describe(animation.effect ? animation.effect.target : null));
}
const layout = Array.prototype.map.call(document.querySelectorAll('[data-testid]'), function (element) {
  const box = element.getBoundingClientRect();
  return element.getAttribute('data-testid') + ' ' + round(box.left) + ',' + round(box.top) + ',' +
    round(box.width) + ',' + round(box.height);
});
return {
  running: running,
  fonts: document.fonts ? document.fonts.status : 'loaded',
  layout: layout,
};
`;

export interface StillOptions {
  /** Ask the page what it is doing (`SETTLE_PROBE` through WebDriver). */
  readonly probe: () => Promise<StillProbe>;
  /** Take one frame: the screenshot, as WebDriver returns it (base64 PNG). */
  readonly frame: () => Promise<string>;
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Called with each frame taken, for logging. */
  readonly onFrame?: (png: string) => void;
}

export interface StillResult {
  /** The picture to save: the second of two identical frames. */
  readonly png: string;
  /** How many frames were taken. */
  readonly frames: number;
  /** How long it took, from the first probe to the returned frame. */
  readonly waitedMs: number;
}

interface Seen {
  readonly png: string;
  readonly layout: readonly string[];
}

/** Which test ids are not in the same place in `after` as in `before`. */
function moved(before: readonly string[], after: readonly string[]): string[] {
  const was = new Set(before);
  const is = new Set(after);
  const names = new Set<string>();
  for (const entry of [...before.filter((e) => !is.has(e)), ...after.filter((e) => !was.has(e))]) {
    names.add(entry.split(' ')[0] ?? entry);
  }
  return [...names];
}

export async function waitForStill(options: StillOptions): Promise<StillResult> {
  const { probe, frame, timeoutMs, intervalMs, onFrame } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  if (timeoutMs < intervalMs) {
    throw new Error(
      `waitForStill: a timeout of ${String(timeoutMs)}ms is shorter than one interval ` +
        `(${String(intervalMs)}ms), so two frames could never be compared.`,
    );
  }

  const started = now();
  const deadline = started + timeoutMs;
  let previous: Seen | undefined;
  let frames = 0;
  let why: string;

  for (;;) {
    const page = await probe();
    if (page.running.length > 0) {
      why = `still animating: ${page.running.join('; ')}`;
      previous = undefined;
    } else if (page.fonts !== 'loaded') {
      why = `the fonts are still loading (document.fonts.status is '${page.fonts}')`;
      previous = undefined;
    } else {
      const png = await frame();
      frames += 1;
      onFrame?.(png);
      if (previous !== undefined) {
        const shifted = moved(previous.layout, page.layout);
        if (shifted.length === 0 && previous.png === png) {
          return { png, frames, waitedMs: now() - started };
        }
        why =
          shifted.length > 0
            ? `these elements kept moving or resizing: ${shifted.join(', ')}`
            : 'the picture kept changing with no animation, font load or layout move ' +
              `to explain it (${String(frames)} frames)`;
      } else {
        why = 'only one frame was taken';
      }
      previous = { png, layout: page.layout };
    }
    if (now() + intervalMs > deadline) {
      throw new Error(`The screen never stood still within ${String(timeoutMs)}ms: ${why}.`);
    }
    await sleep(intervalMs);
  }
}

/**
 * In the page: `''` when the cursor hovers nothing that draws a hover, or the
 * innermost such thing it does hover — a button, link, field, anything with a
 * tab stop or a hint (`aria-describedby`), or anything with `cursor-help`.
 * Nothing hovered at all is fine: it looks the same as the empty rail.
 */
export const HOVERED_INTERACTIVE = String.raw`
const hovered = document.querySelectorAll(':hover');
const deepest = hovered.length > 0 ? hovered[hovered.length - 1] : null;
if (deepest === null) return '';
const target = deepest.closest('button, a, input, select, textarea, summary, label, [tabindex], [aria-describedby], [role="button"], .cursor-help');
if (target === null) return '';
const id = target.getAttribute('data-testid');
return target.tagName.toLowerCase() + (id ? '[' + id + ']' : '');
`;

/**
 * Where the Windows cursor is parked before each picture, in SCREEN pixels: on
 * the navigation rail's empty navy space, below the last view and above
 * Settings, which nothing on the rail draws a hover for. See `smoke.spec.ts`.
 */
export const POINTER_PARK = { x: 120, y: 500 } as const;

/**
 * The PowerShell arguments that move the real Windows cursor to (x, y).
 *
 * WebDriver cannot do this: the app's embedded server sends pointer actions as
 * JavaScript `MouseEvent`s, and a synthetic event never changes CSS `:hover`.
 * Only the real cursor does, and on the CI runner it sits wherever Windows
 * left it.
 *
 * It goes one pixel to the right first and then to (x, y), so the web view
 * sees a real move even when the cursor was already there. Prints where the
 * cursor ended up.
 */
export function moveOsPointerArgs(x: number, y: number): string[] {
  for (const value of [x, y]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `moveOsPointerArgs: the pointer must go to a whole, non-negative pixel, not ${String(value)}`,
      );
    }
  }
  return [
    '-NoProfile',
    '-Command',
    'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; ' +
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x + 1)}, ${String(y)}); ` +
      'Start-Sleep -Milliseconds 50; ' +
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)}); ` +
      '$p = [System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"',
  ];
}
