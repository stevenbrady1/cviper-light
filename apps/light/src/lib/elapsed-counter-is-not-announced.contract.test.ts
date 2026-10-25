/**
 * The running seconds counter is shown, never announced.
 *
 * Every "the model is thinking" line sits in a `role="status"` live region and
 * ends with a counter that changes every second. A changing live region is
 * read out again, so a screen reader repeated the whole sentence ("Sending
 * your CV ... 12s", "... 13s") once a second for as long as the model took.
 * The counter is for the eye; `aria-hidden` keeps it out of the accessibility
 * tree, so the sentence is announced once and the seconds tick silently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const FEATURES = join(REPO_ROOT, 'apps', 'light', 'src', 'features');

function tsxSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsxSources(path));
    else if (name.endsWith('.tsx') && !/\.test\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

/** The opening tag of every element whose content is exactly `{elapsed}s`. */
export function counterTags(source: string): string[] {
  return [...source.matchAll(/(<[a-z]+\b[^>]*>)\s*\{elapsed\}s\s*</g)].map((m) => m[1] ?? '');
}

export const isHidden = (tag: string): boolean => /\saria-hidden=(?:"true"|\{true\})/.test(tag);

describe('the elapsed counter stays out of the live region', () => {
  it('every {elapsed}s counter in the features is aria-hidden', () => {
    const offences: string[] = [];
    let counters = 0;
    for (const file of tsxSources(FEATURES)) {
      for (const tag of counterTags(readFileSync(file, 'utf8'))) {
        counters += 1;
        if (!isHidden(tag)) offences.push(`${relative(REPO_ROOT, file)}: ${tag}`);
      }
    }
    // Five today: Tailor, Analysis, the interview panel, and Paste a job twice.
    expect(counters).toBeGreaterThanOrEqual(5);
    expect(offences).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('negative: a visible counter is caught', () => {
    const [tag = ''] = counterTags('<span className="font-mono">{elapsed}s</span>');
    expect(isHidden(tag)).toBe(false);
  });

  it('boundary: aria-hidden="false" is not hidden', () => {
    const [tag = ''] = counterTags('<span aria-hidden="false">{elapsed}s</span>');
    expect(isHidden(tag)).toBe(false);
  });

  it('happy: both spellings of a hidden counter pass', () => {
    for (const markup of [
      '<span aria-hidden="true" className="x">{elapsed}s</span>',
      '<span className="x" aria-hidden={true}>{elapsed}s</span>',
    ]) {
      const [tag = ''] = counterTags(markup);
      expect(isHidden(tag)).toBe(true);
    }
  });
});
