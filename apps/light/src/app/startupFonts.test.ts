/**
 * The mono faces are loaded as the app starts (L-364).
 *
 * jsdom has no `document.fonts` and does no layout, so this checks the
 * request and the guards. Whether a screen still moves when a face lands is
 * measured on the real engine: `e2e/contrast-webkit.spec.ts`, "the mono font
 * cannot move Settings after a jump (L-364)".
 */
import { describe, expect, it, vi } from 'vitest';

import { loadStartupFonts, STARTUP_FONTS } from './startupFonts';

function fakeFonts(load: (font: string) => Promise<FontFace[]>) {
  return { load: vi.fn(load) };
}

describe('loadStartupFonts (L-364)', () => {
  it('asks for IBM Plex Mono at 400 and 500, the two faces the app draws', () => {
    const fonts = fakeFonts(() => Promise.resolve([]));
    loadStartupFonts(fonts);
    expect(fonts.load.mock.calls.map(([font]) => font)).toEqual([
      '400 1em "IBM Plex Mono"',
      '500 1em "IBM Plex Mono"',
    ]);
  });

  it('names only families the app ships, never a file or an address', () => {
    for (const font of STARTUP_FONTS) {
      expect(font).not.toMatch(/https?:|\/\/|\.woff/);
      expect(font).toMatch(/^\d00 1em "IBM Plex Mono"$/);
    }
  });

  it('negative: no font set at all (jsdom, an old engine) does nothing and does not throw', () => {
    expect(() => loadStartupFonts(undefined)).not.toThrow();
  });

  it('negative: a font set without `load` does not throw', () => {
    expect(() => loadStartupFonts({} as unknown as Pick<FontFaceSet, 'load'>)).not.toThrow();
  });

  it('boundary: a face that fails to load leaves no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const fonts = fakeFonts(() => Promise.reject(new Error('the file is missing')));
      loadStartupFonts(fonts);
      expect(fonts.load).toHaveBeenCalledTimes(STARTUP_FONTS.length);
      await new Promise((done) => setTimeout(done, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('boundary: a `load` that throws at once does not stop the next face being asked for', () => {
    const fonts = fakeFonts(() => {
      throw new Error('a syntax error in the font string');
    });
    expect(() => loadStartupFonts(fonts)).not.toThrow();
    expect(fonts.load).toHaveBeenCalledTimes(STARTUP_FONTS.length);
  });
});
