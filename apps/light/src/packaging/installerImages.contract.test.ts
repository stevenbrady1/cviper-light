/**
 * The Windows installer's branded images exist where the config says, at the
 * size and in the format NSIS needs (L-251).
 *
 * NSIS only reads uncompressed bitmaps, and Tauri passes the configured path
 * straight to it. A moved or re-saved file would surface only inside the
 * release bundle — or not at all, as the plain default art. So this reads
 * `bundle.windows.nsis` from `tauri.conf.json` and checks each file's header:
 * "BM", BITMAPINFOHEADER, 24 bits per pixel, no compression, and the pixel
 * size Tauri's own schema recommends (sidebar 164×314, header 150×57).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_TAURI = fileURLToPath(new URL('../../src-tauri/', import.meta.url));

const NSIS = (
  JSON.parse(readFileSync(`${SRC_TAURI}tauri.conf.json`, 'utf8')) as {
    bundle?: {
      windows?: {
        nsis?: { sidebarImage?: string; headerImage?: string; installerIcon?: string };
      };
    };
  }
).bundle?.windows?.nsis;

export interface BmpHeader {
  readonly magic: string;
  readonly headerSize: number;
  readonly width: number;
  readonly height: number;
  readonly bitsPerPixel: number;
  readonly compression: number;
}

export function readBmpHeader(bytes: Uint8Array): BmpHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    magic: String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0),
    headerSize: view.getUint32(14, true),
    width: view.getInt32(18, true),
    height: Math.abs(view.getInt32(22, true)),
    bitsPerPixel: view.getUint16(28, true),
    compression: view.getUint32(30, true),
  };
}

const IMAGES = [
  { key: 'sidebarImage', path: NSIS?.sidebarImage, width: 164, height: 314 },
  { key: 'headerImage', path: NSIS?.headerImage, width: 150, height: 57 },
] as const;

describe('the installer images are real, NSIS-readable bitmaps at the configured paths', () => {
  it.each(IMAGES)('$key', ({ path, width, height }) => {
    expect(path, 'configured in bundle.windows.nsis').toMatch(/\.bmp$/);
    const file = `${SRC_TAURI}${path ?? ''}`;
    expect(existsSync(file), file).toBe(true);

    const header = readBmpHeader(readFileSync(file));
    expect(header).toEqual({
      magic: 'BM',
      headerSize: 40,
      width,
      height,
      bitsPerPixel: 24,
      compression: 0,
    });
  });

  it('the installer icon is the app’s own .ico, at the configured path', () => {
    expect(NSIS?.installerIcon).toMatch(/\.ico$/);
    const bytes = readFileSync(`${SRC_TAURI}${NSIS?.installerIcon ?? ''}`);
    // ICONDIR: reserved 0, type 1 (icon), at least one image.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0, 0, 1, 0]);
    expect(bytes[4] ?? 0).toBeGreaterThan(0);
  });

  describe('the header check can fail', () => {
    it('rejects a PNG renamed to .bmp', () => {
      const png = new Uint8Array(64);
      png.set([0x89, 0x50, 0x4e, 0x47]);
      expect(readBmpHeader(png).magic).not.toBe('BM');
    });

    it('reads a compressed 32-bit bitmap as what it is', () => {
      const bmp = new Uint8Array(64);
      const view = new DataView(bmp.buffer);
      bmp.set([0x42, 0x4d]);
      view.setUint32(14, 40, true);
      view.setInt32(18, 164, true);
      view.setInt32(22, -314, true);
      view.setUint16(28, 32, true);
      view.setUint32(30, 3, true);
      expect(readBmpHeader(bmp)).toMatchObject({ width: 164, height: 314, bitsPerPixel: 32 });
      expect(readBmpHeader(bmp).compression).not.toBe(0);
    });
  });
});
