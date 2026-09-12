/**
 * The PNG codec, and the four ways it is allowed to be wrong: not at all.
 *
 * Every test here is about a failure that would be INVISIBLE downstream. The
 * asset contract test checks dimensions, so a decoder that mis-read a palette
 * image, or a resizer that drew a halo, would produce files of exactly the
 * right size carrying the wrong picture — and ship green.
 */
import { describe, expect, it } from 'vitest';

import { centreOnCanvas, decodePng, downscale, encodePng, readPngHeader } from './png.ts';

/** A solid block of one colour, as raw RGBA. */
function solid(
  width: number,
  height: number,
  [r, g, b, a]: readonly [number, number, number, number],
) {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  }
  return { width, height, data };
}

function pixelAt(image: { width: number; data: Uint8Array }, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
}

describe('round trip', () => {
  it('writes an image it can read back, byte for byte', () => {
    const original = solid(7, 5, [12, 200, 34, 255]);
    const decoded = decodePng(encodePng(original));

    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(5);
    expect([...decoded.data]).toEqual([...original.data]);
  });

  it('survives content that exercises every scanline filter', () => {
    // A gradient in both axes, so the adaptive filter chooses different types
    // on different rows and each one has to invert correctly.
    const width = 23;
    const height = 19;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        data[at] = (x * 11) & 0xff;
        data[at + 1] = (y * 7) & 0xff;
        data[at + 2] = (x * y) & 0xff;
        data[at + 3] = 255 - ((x + y) & 0x3f);
      }
    }

    const decoded = decodePng(encodePng({ width, height, data }));
    expect([...decoded.data]).toEqual([...data]);
  });

  it('boundary: a single pixel', () => {
    const decoded = decodePng(encodePng(solid(1, 1, [1, 2, 3, 4])));
    expect(pixelAt(decoded, 0, 0)).toEqual([1, 2, 3, 4]);
  });

  it('writes a header that says 8-bit RGBA, non-interlaced', () => {
    const header = readPngHeader(encodePng(solid(4, 4, [0, 0, 0, 255])));
    expect(header).toEqual({ width: 4, height: 4, bitDepth: 8, colourType: 6, interlace: 0 });
  });
});

describe('it refuses what it cannot do, rather than guessing', () => {
  it('negative: rejects something that is not a PNG', () => {
    expect(() => readPngHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a PNG/);
  });

  it('negative: rejects a palette image instead of mis-reading it', () => {
    // Colour type 3 is a palette. Decoding it as RGBA would produce a file of
    // exactly the right SIZE containing noise — which every dimension check
    // downstream would pass.
    const png = encodePng(solid(2, 2, [0, 0, 0, 255]));
    png[25] = 3;
    expect(() => decodePng(png)).toThrow(/colour type 3/);
  });

  it('negative: rejects 16 bits a channel', () => {
    const png = encodePng(solid(2, 2, [0, 0, 0, 255]));
    png[24] = 16;
    expect(() => decodePng(png)).toThrow(/bit depth 16/);
  });

  it('negative: rejects an interlaced image', () => {
    const png = encodePng(solid(2, 2, [0, 0, 0, 255]));
    png[28] = 1;
    expect(() => decodePng(png)).toThrow(/interlaced/);
  });

  it('negative: refuses to enlarge, in either axis', () => {
    const source = solid(8, 8, [0, 0, 0, 255]);
    expect(() => downscale(source, 16, 8)).toThrow(/refusing to upscale/);
    expect(() => downscale(source, 8, 16)).toThrow(/refusing to upscale/);
  });

  it('boundary: a resize to the same size is allowed and is a copy', () => {
    const source = solid(4, 4, [9, 8, 7, 255]);
    expect([...downscale(source, 4, 4).data]).toEqual([...source.data]);
  });
});

describe('downscale', () => {
  it('averages the area it covers, not the nearest pixel', () => {
    // Four opaque pixels: black, white, black, white. A nearest-neighbour
    // resizer answers 0 or 255; an area average answers half way.
    const data = new Uint8Array([
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const result = downscale({ width: 2, height: 2, data }, 1, 1);

    expect(result.width).toBe(1);
    expect(pixelAt(result, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it('handles a ratio that is not a whole number', () => {
    // 3 -> 2 splits a source pixel across two destination pixels. A resizer
    // that only handled integer ratios would silently drop the middle column.
    const data = new Uint8Array(3 * 1 * 4);
    for (let x = 0; x < 3; x += 1) {
      data[x * 4] = x === 1 ? 255 : 0;
      data[x * 4 + 3] = 255;
    }
    const result = downscale({ width: 3, height: 1, data }, 2, 1);

    // The middle column reaches BOTH destination pixels, so neither is black.
    expect(pixelAt(result, 0, 0)[0]).toBeGreaterThan(0);
    expect(pixelAt(result, 1, 0)[0]).toBeGreaterThan(0);
  });

  it('does not bleed a transparent pixel’s colour into its neighbour', () => {
    // ==================================================================
    // THE HALO TEST. This is the whole reason the resizer premultiplies.
    // ==================================================================
    // Red at full opacity beside a FULLY TRANSPARENT pixel whose stored
    // colour is white. Averaging straight RGBA gives a pale pink; averaging
    // premultiplied gives red at half alpha, which is correct. The difference
    // is invisible at 310px and is a white fringe round the badge at 16px.
    const data = new Uint8Array([255, 0, 0, 255, 255, 255, 255, 0]);
    const result = downscale({ width: 2, height: 1, data }, 1, 1);
    const [r, g, b, a] = pixelAt(result, 0, 0);

    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(128);
  });

  it('boundary: an entirely transparent area stays entirely transparent', () => {
    const result = downscale(solid(4, 4, [200, 100, 50, 0]), 1, 1);
    expect(pixelAt(result, 0, 0)).toEqual([0, 0, 0, 0]);
  });
});

describe('centreOnCanvas', () => {
  it('letterboxes a square into a wide canvas without distorting it', () => {
    // 16x16 source, 20x10 canvas: the artwork fits the SHORT side (10) and is
    // centred, leaving x 5..14 covered and both ends transparent. The source
    // has to be at least as big as the short side — `downscale` refuses to
    // enlarge, which is exactly why the real wide tile stops at 200%.
    const result = centreOnCanvas(solid(16, 16, [10, 20, 30, 255]), 20, 10);

    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    expect(pixelAt(result, 10, 5)).toEqual([10, 20, 30, 255]);
    // and the sides are transparent rather than stretched artwork.
    expect(pixelAt(result, 0, 5)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result, 19, 5)).toEqual([0, 0, 0, 0]);
  });

  it('negative: refuses a canvas whose short side is bigger than the source', () => {
    // The refusal that just caught a wrong test fixture. Letterboxing scales
    // the artwork to the SHORT side, so a 10px-tall canvas needs at least a
    // 10px source however wide the canvas is.
    expect(() => centreOnCanvas(solid(8, 8, [0, 0, 0, 255]), 20, 10)).toThrow(
      /refusing to upscale/,
    );
  });
});
