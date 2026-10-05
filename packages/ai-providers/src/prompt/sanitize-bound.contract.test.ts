/**
 * The sanitiser's input bound must stay generous enough that "sanitise, THEN
 * truncate to the field budget" still holds for every prompt field (L-207).
 *
 * Derived, not listed: every exported `MAX_*_CHARS` number in this directory is
 * a field budget, and the bound has to be at least 4 x the largest of them.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SANITIZE_INPUT_CHARS } from '@cviper/cv-parsing';
import { describe, expect, it } from 'vitest';

const DIR = dirname(fileURLToPath(import.meta.url));

const budgets: [string, number][] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const mod = (await import(pathToFileURL(join(DIR, file)).href)) as Record<string, unknown>;
  for (const [name, value] of Object.entries(mod)) {
    if (/^MAX_.*CHARS$/.test(name) && typeof value === 'number') budgets.push([name, value]);
  }
}

describe('MAX_SANITIZE_INPUT_CHARS', () => {
  it('found the field budgets (a broken scan must not pass vacuously)', () => {
    expect(budgets.length).toBeGreaterThan(5);
  });

  it.each(budgets)('is at least 4 x %s (%i)', (_name, budget) => {
    expect(MAX_SANITIZE_INPUT_CHARS).toBeGreaterThanOrEqual(budget * 4);
  });
});
