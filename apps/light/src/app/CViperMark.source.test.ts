/**
 * One logo, not two (L-184). The sidebar and the app icons must come from the
 * same committed file: `branding/cviper-mark.svg`, CViper's own mark.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../lib/repo-scan.ts';

const BRANDING = join(REPO_ROOT, 'apps/light/branding');

describe('the CViper mark has one source', () => {
  it('the sidebar component imports the committed branding SVG', () => {
    const component = readFileSync(join(REPO_ROOT, 'apps/light/src/app/CViperMark.tsx'), 'utf8');
    expect(component).toContain("from '../../branding/cviper-mark.svg'");
  });

  it("the branding SVG is CViper's mark: the navy badge and three teal bars", () => {
    const svg = readFileSync(join(BRANDING, 'cviper-mark.svg'), 'utf8').toLowerCase();
    expect(svg).toContain('#0f2044');
    expect(svg).toContain('#1ed7d1');
    expect(svg.match(/<rect x="\d+" y="\d+" width="80"/g)).toHaveLength(3);
  });

  it('the icon source PNG is square and 1024px, as tauri icon and the Store generator need', () => {
    const png = readFileSync(join(BRANDING, 'cviper-icon-1024.png'));
    // PNG IHDR: width and height are the big-endian integers at bytes 16 and 20.
    expect(png.readUInt32BE(16)).toBe(1024);
    expect(png.readUInt32BE(20)).toBe(1024);
  });
});
