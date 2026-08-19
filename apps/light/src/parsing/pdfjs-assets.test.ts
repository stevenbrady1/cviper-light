import { getPdfJsAssetUrls, resetPdfJs } from '@cviper/cv-parsing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CMAP_URL, STANDARD_FONT_DATA_URL, configurePdfJsAssets } from './pdfjs-assets';

/**
 * What this covers, and what it cannot.
 *
 * COVERS: that the `?url` import resolves through pnpm's symlinked
 * node_modules at all, that it produces a same-origin URL to a real `.mjs`
 * file, and that every URL reaches the parser in the shape pdf.js expects.
 * Those are the parts that silently rot when a dependency moves.
 *
 * DOES NOT COVER: `new Worker(...)` actually starting, or the copied
 * `public/pdfjs` files actually being fetchable. Both need a browser and a
 * packaged app. `vite build` proves the worker asset is emitted; the rest is
 * app runtime, and is stated as such rather than implied to be tested.
 */

beforeEach(() => {
  resetPdfJs();
});

afterEach(() => {
  resetPdfJs();
});

describe('configurePdfJsAssets', () => {
  it('hands the parser a worker URL pointing at a real pdf.js worker module', () => {
    configurePdfJsAssets();
    const { workerSrc } = getPdfJsAssetUrls();

    expect(workerSrc).not.toBeNull();
    expect(workerSrc).toMatch(/pdf\.worker.*\.mjs$/);
  });

  it('keeps the worker URL same-origin so pdf.js does not need a blob URL', () => {
    // pdf.js only wraps `workerSrc` in a `blob:` URL when it is cross-origin,
    // and a blob worker is exactly what a strict CSP blocks. A root-relative
    // path can never be cross-origin.
    configurePdfJsAssets();
    const { workerSrc } = getPdfJsAssetUrls();

    expect(workerSrc?.startsWith('/')).toBe(true);
    expect(workerSrc).not.toMatch(/^https?:/);
    expect(workerSrc).not.toMatch(/^blob:/);
  });

  it('configures the character map and standard font directories', () => {
    configurePdfJsAssets();
    const assets = getPdfJsAssetUrls();

    expect(assets.cMapUrl).toBe(CMAP_URL);
    expect(assets.standardFontDataUrl).toBe(STANDARD_FONT_DATA_URL);
  });

  it('gives every directory URL a trailing slash', () => {
    // pdf.js concatenates a filename straight onto these. Without the slash it
    // requests `/pdfjs/cmapsAdobe-Japan1-UCS2`, gets a 404, and falls back to
    // no character mappings at all — which shows up as mojibake in a CV, not as
    // an error anyone would connect to this line.
    configurePdfJsAssets();
    const assets = getPdfJsAssetUrls();

    expect(assets.cMapUrl?.endsWith('/')).toBe(true);
    expect(assets.standardFontDataUrl?.endsWith('/')).toBe(true);
  });

  it('leaves the render-only assets unset', () => {
    // Not an oversight: nothing in this app renders a PDF page, and shipping
    // the WASM decoders would add about 1.6 MB to the installer for a code path
    // nothing calls. If this ever fails, someone added a preview feature and
    // needs to add the copy step too.
    configurePdfJsAssets();
    const assets = getPdfJsAssetUrls();

    expect(assets.wasmUrl).toBeNull();
    expect(assets.iccUrl).toBeNull();
  });

  it('reports nothing configured until it is called', () => {
    expect(getPdfJsAssetUrls()).toEqual({
      workerSrc: null,
      cMapUrl: null,
      standardFontDataUrl: null,
      wasmUrl: null,
      iccUrl: null,
    });
  });
});
