import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadFragments } from './fragmentsOnDisk.ts';

const GOOD = '---\nsection: Fixed\n---\n\n- A fix (L-7).\n';

describe('loadFragments', () => {
  let directory = '';
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fragments-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads every fragment, sorted by name, and ignores .gitkeep', () => {
    writeFileSync(join(directory, '.gitkeep'), '');
    writeFileSync(join(directory, 'L-7.md'), GOOD);
    writeFileSync(join(directory, 'L-10.md'), GOOD.replace('L-7', 'L-10'));
    expect(loadFragments(directory).map((file) => file.fragment.lNumber)).toEqual([10, 7]);
  });

  it('boundary: an emptied folder holding only .gitkeep is zero fragments', () => {
    writeFileSync(join(directory, '.gitkeep'), '');
    expect(loadFragments(directory)).toEqual([]);
  });

  it('negative: a misnamed file fails instead of being skipped', () => {
    writeFileSync(join(directory, 'notes.md'), GOOD);
    expect(() => loadFragments(directory)).toThrow(/notes\.md: the file name/);
  });

  it('negative: a sub-folder fails', () => {
    mkdirSync(join(directory, 'L-8.md'));
    expect(() => loadFragments(directory)).toThrow(/files only/);
  });

  it('negative: a missing folder throws, it is never "no fragments"', () => {
    expect(() => loadFragments(join(directory, 'absent'))).toThrow(/ENOENT/);
  });
});
