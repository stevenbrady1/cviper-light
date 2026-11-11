/**
 * Load the mono faces as the app starts (L-364).
 *
 * A browser fetches a web font only when some text on screen first needs it.
 * Until it arrives, that text is laid out with a fallback face whose line box
 * is a different height, and when the real face lands the page below moves.
 *
 * On the narrow layout nothing draws IBM Plex Mono at startup, so Settings was
 * the first screen to need it (the `.json` in "Your data"), and it worked out
 * where to scroll for "Manage job boards" before the face had arrived. Job
 * boards then moved by the difference: 0.5px on Windows, about 2px on Linux.
 * The desktop layout was never affected, because the side menu's "Ctrl N"
 * labels draw Plex Mono 400 at startup; it draws 500 there too.
 *
 * So both faces the app uses are asked for here, once, when the shell mounts.
 * They are the app's own files, named by family in `styles/fonts.css`: this
 * names no file and no address, and makes no request the desktop layout does
 * not already make. `load` with no sample text loads the face whose range
 * holds a space, which is the `latin` file of each, about 15 KB apiece.
 *
 * This shortens the window, it does not close it: a screen drawn in the few
 * milliseconds before the faces land still lays out with the fallback. The
 * `.json` line in Settings also carries `leading-none`, so that line's height
 * does not depend on the font at all.
 */
import { useEffect } from 'react';

export const STARTUP_FONTS = ['400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'] as const;

/** The shell's half: ask once, when it mounts. A hook so `App.tsx` spends one line on it. */
export function useStartupFonts(): void {
  useEffect(() => {
    loadStartupFonts(document.fonts as FontFaceSet | undefined);
  }, []);
}

/**
 * Ask the font set for each startup face. Never throws: a font set that is
 * missing (jsdom, an old engine) or a face that fails to load leaves the
 * fallback in place, which is exactly what the page does without this.
 */
export function loadStartupFonts(fonts: Pick<FontFaceSet, 'load'> | undefined): void {
  if (fonts === undefined || typeof fonts.load !== 'function') return;
  for (const font of STARTUP_FONTS) {
    try {
      // A face that fails to load is not an error the user can act on: the
      // text is still drawn, in the fallback face, as it would be without this.
      fonts.load(font).catch(() => undefined);
    } catch {
      // A font set that refuses the request outright: the same, for this face.
    }
  }
}
