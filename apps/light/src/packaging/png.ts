/**
 * A PNG reader, writer and downscaler, in Node builtins and nothing else.
 *
 * ============================================================================
 * WHY NOT A LIBRARY
 * ============================================================================
 * This exists to turn ONE committed source icon into the Microsoft Store's
 * asset set (`msixAssets.ts`). That is a build-time chore run by a person, on
 * one file, whose format is known: `apps/light/branding/cviper-icon-1024.png`
 * is 1024x1024, 8-bit RGBA, non-interlaced, and so is every icon in
 * `src-tauri/icons/`.
 *
 * Adding `sharp` or `jimp` for that would put a native binary — or a megabyte
 * of JavaScript — into a lockfile that CI installs with `--frozen-lockfile` on
 * every job, for code that runs neither in the app nor in CI. `node:zlib`
 * already does the only hard part (DEFLATE), and the rest is a filter loop and
 * a box filter.
 *
 * ============================================================================
 * IT REFUSES WHAT IT CANNOT DO, RATHER THAN GUESSING
 * ============================================================================
 * Every unsupported shape — a palette, 16 bits a channel, an interlaced image,
 * an upscale — throws with a sentence naming what was found and what was
 * expected. None of them returns "something".
 *
 * That is the whole reason this module is safe to be small. A decoder that
 * quietly mis-read a palette image would emit a Store asset that is the right
 * SIZE and the wrong PICTURE, and the test that checks the assets checks
 * dimensions — so the wrong picture would ship green. The narrow, loud version
 * cannot do that: it stops.
 */
import { deflateSync, inflateSync } from 'node:zlib';

/** An 8-bit RGBA image: `data` is `width * height * 4` bytes, row-major. */
export interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel. This module handles colour type 6 (RGBA) only. */
const BPP = 4;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/** The header fields this module cares about. */
export interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colourType: number;
  readonly interlace: number;
}

/**
 * The IHDR of a PNG, without inflating a single pixel.
 *
 * Separate from `decodePng` because the asset contract test asks only "is this
 * file the size it claims to be?" over thirty-odd files, and inflating them all
 * to answer it would be a slow test for no extra truth.
 */
export function readPngHeader(bytes: Uint8Array): PngHeader {
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) {
      throw new Error('not a PNG: the 8-byte signature does not match.');
    }
  }
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
    throw new Error('not a PNG: the first chunk is not IHDR.');
  }

  return {
    width: readUint32(bytes, 16),
    height: readUint32(bytes, 20),
    bitDepth: bytes[24] ?? 0,
    colourType: bytes[25] ?? 0,
    interlace: bytes[28] ?? 0,
  };
}

/** Undo one scanline's filter, in place, given the already-reconstructed row above. */
function unfilter(type: number, row: Uint8Array, previous: Uint8Array | null): void {
  const width = row.length;
  switch (type) {
    case 0:
      return;
    case 1:
      for (let i = BPP; i < width; i += 1) row[i] = ((row[i] ?? 0) + (row[i - BPP] ?? 0)) & 0xff;
      return;
    case 2:
      if (previous === null) return;
      for (let i = 0; i < width; i += 1) row[i] = ((row[i] ?? 0) + (previous[i] ?? 0)) & 0xff;
      return;
    case 3:
      for (let i = 0; i < width; i += 1) {
        const left = i >= BPP ? (row[i - BPP] ?? 0) : 0;
        const up = previous === null ? 0 : (previous[i] ?? 0);
        row[i] = ((row[i] ?? 0) + ((left + up) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < width; i += 1) {
        const a = i >= BPP ? (row[i - BPP] ?? 0) : 0;
        const b = previous === null ? 0 : (previous[i] ?? 0);
        const c = previous !== null && i >= BPP ? (previous[i - BPP] ?? 0) : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[i] = ((row[i] ?? 0) + predictor) & 0xff;
      }
      return;
    default:
      throw new Error(`unsupported PNG scanline filter type ${type} (expected 0-4).`);
  }
}

/**
 * A PNG to raw RGBA.
 *
 * Supports 8-bit truecolour-with-alpha (colour type 6), non-interlaced, which
 * is what every icon in this repository is. Anything else throws.
 */
export function decodePng(bytes: Uint8Array): Rgba {
  const header = readPngHeader(bytes);

  if (header.bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${header.bitDepth} (this reader handles 8 only).`);
  }
  if (header.colourType !== 6) {
    throw new Error(
      `unsupported PNG colour type ${header.colourType} (this reader handles 6, RGBA, only). ` +
        'Re-save the source icon as 8-bit RGBA.',
    );
  }
  if (header.interlace !== 0) {
    throw new Error('unsupported interlaced PNG (this reader handles non-interlaced only).');
  }

  const parts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IDAT') parts.push(bytes.slice(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (parts.length === 0) throw new Error('this PNG has no IDAT chunk, so it has no pixels.');

  const raw = new Uint8Array(inflateSync(Buffer.concat(parts.map((part) => Buffer.from(part)))));
  const stride = header.width * BPP;
  const data = new Uint8Array(header.height * stride);

  let previous: Uint8Array | null = null;
  for (let y = 0; y < header.height; y += 1) {
    const start = y * (stride + 1);
    const filterType = raw[start] ?? 0;
    const row = raw.slice(start + 1, start + 1 + stride);
    unfilter(filterType, row, previous);
    data.set(row, y * stride);
    previous = row;
  }

  return { width: header.width, height: header.height, data };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  writeUint32(out, 0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  writeUint32(out, 8 + body.length, crc32(out.slice(4, 8 + body.length)));
  return out;
}

/** The sum of absolute differences a filtered row costs — the standard heuristic. */
function filterCost(row: Uint8Array): number {
  let total = 0;
  for (const byte of row) total += byte < 128 ? byte : 256 - byte;
  return total;
}

/**
 * Raw RGBA to a PNG.
 *
 * Filters adaptively (the minimum-sum-of-absolute-differences heuristic the PNG
 * specification suggests) because the alternative — filter type 0 on every row
 * — makes a 1240x1240 tile about four times larger than it needs to be, and
 * these files are committed.
 */
export function encodePng(image: Rgba): Uint8Array {
  const stride = image.width * BPP;
  const filtered = new Uint8Array(image.height * (stride + 1));
  const candidate = new Uint8Array(stride);

  for (let y = 0; y < image.height; y += 1) {
    const row = image.data.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : image.data.subarray((y - 1) * stride, y * stride);

    let bestType = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    let best = row;

    for (let type = 0; type <= 4; type += 1) {
      for (let i = 0; i < stride; i += 1) {
        const x = row[i] ?? 0;
        const a = i >= BPP ? (row[i - BPP] ?? 0) : 0;
        const b = previous === null ? 0 : (previous[i] ?? 0);
        const c = previous !== null && i >= BPP ? (previous[i - BPP] ?? 0) : 0;

        let predictor = 0;
        if (type === 1) predictor = a;
        else if (type === 2) predictor = b;
        else if (type === 3) predictor = (a + b) >> 1;
        else if (type === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        candidate[i] = (x - predictor) & 0xff;
      }

      const cost = filterCost(candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestType = type;
        best = candidate.slice();
      }
    }

    filtered[y * (stride + 1)] = bestType;
    filtered.set(best, y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, image.width);
  writeUint32(ihdr, 4, image.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // compression: DEFLATE
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const idat = new Uint8Array(deflateSync(Buffer.from(filtered), { level: 9 }));

  const chunks = [
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of chunks) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Area-average downscale, on PREMULTIPLIED alpha.
 *
 * ============================================================================
 * PREMULTIPLIED, AND THAT IS NOT A DETAIL
 * ============================================================================
 * Averaging straight RGBA mixes the colour of fully TRANSPARENT pixels into
 * their neighbours. The source icon sits on a transparent canvas, so every edge
 * of the badge borders pixels whose RGB is arbitrary and whose alpha is zero —
 * and a straight average draws a pale halo all the way round the artwork at
 * every size. It is invisible at 310px and obvious at 16px, which is exactly
 * the size that ends up on the taskbar.
 *
 * ============================================================================
 * IT REFUSES TO UPSCALE
 * ============================================================================
 * A box filter enlarging an image produces blocks. More to the point, every
 * asset this repository generates is smaller than the 1024px source, so an
 * upscale request means the asset table asked for something the source cannot
 * honestly provide — and Windows already handles a missing large asset by
 * scaling the next one down. Throwing says so; returning a blurry PNG would
 * ship it.
 */
export function downscale(source: Rgba, width: number, height: number): Rgba {
  if (width > source.width || height > source.height) {
    throw new Error(
      `refusing to upscale ${source.width}x${source.height} to ${width}x${height}. ` +
        'Windows scales a larger asset down by itself; an upscaled one is worse than an absent ' +
        'one. Either drop this size from the asset table or supply a larger source icon.',
    );
  }
  if (width < 1 || height < 1) throw new Error(`refusing to resize to ${width}x${height}.`);

  const out = new Uint8Array(width * height * BPP);
  const scaleX = source.width / width;
  const scaleY = source.height / height;

  for (let y = 0; y < height; y += 1) {
    const top = y * scaleY;
    const bottom = (y + 1) * scaleY;
    const firstRow = Math.floor(top);
    const lastRow = Math.min(source.height - 1, Math.ceil(bottom) - 1);

    for (let x = 0; x < width; x += 1) {
      const left = x * scaleX;
      const right = (x + 1) * scaleX;
      const firstColumn = Math.floor(left);
      const lastColumn = Math.min(source.width - 1, Math.ceil(right) - 1);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weightTotal = 0;

      for (let sy = firstRow; sy <= lastRow; sy += 1) {
        const coverY = Math.min(bottom, sy + 1) - Math.max(top, sy);
        if (coverY <= 0) continue;

        for (let sx = firstColumn; sx <= lastColumn; sx += 1) {
          const coverX = Math.min(right, sx + 1) - Math.max(left, sx);
          if (coverX <= 0) continue;

          const weight = coverX * coverY;
          const at = (sy * source.width + sx) * BPP;
          const alpha = source.data[at + 3] ?? 0;
          // Premultiplied: a transparent pixel contributes nothing but its area.
          r += (source.data[at] ?? 0) * alpha * weight;
          g += (source.data[at + 1] ?? 0) * alpha * weight;
          b += (source.data[at + 2] ?? 0) * alpha * weight;
          a += alpha * weight;
          weightTotal += weight;
        }
      }

      const at = (y * width + x) * BPP;
      const alphaAverage = weightTotal === 0 ? 0 : a / weightTotal;
      if (a === 0) {
        out[at] = 0;
        out[at + 1] = 0;
        out[at + 2] = 0;
        out[at + 3] = 0;
        continue;
      }
      out[at] = Math.round(r / a);
      out[at + 1] = Math.round(g / a);
      out[at + 2] = Math.round(b / a);
      out[at + 3] = Math.round(alphaAverage);
    }
  }

  return { width, height, data: out };
}

/**
 * A square image centred on a transparent canvas of another shape.
 *
 * The wide tile (310x150) is the only non-square asset Windows asks for, and
 * the source artwork is square. Stretching it to fit would distort the logo;
 * cropping it would cut the badge in half. Letterboxing keeps the artwork
 * intact and leaves the sides transparent, which is what Windows draws its own
 * tile colour behind.
 */
export function centreOnCanvas(source: Rgba, width: number, height: number): Rgba {
  const fit = Math.min(width, height);
  const scaled = downscale(source, fit, fit);
  const out = new Uint8Array(width * height * BPP);
  const offsetX = Math.floor((width - fit) / 2);
  const offsetY = Math.floor((height - fit) / 2);

  for (let y = 0; y < fit; y += 1) {
    const from = y * fit * BPP;
    const to = ((y + offsetY) * width + offsetX) * BPP;
    out.set(scaled.data.subarray(from, from + fit * BPP), to);
  }

  return { width, height, data: out };
}
