/**
 * The advert-boilerplate contract (L-208): a run module that hands an advert
 * to a model does it through `advertForModel`, so the filter cannot drift
 * between paths.
 *
 * The population is DERIVED, not listed (the L-115 lesson): every non-test
 * module under `apps/light/src` named `run*.ts` that imports
 * `createTauriTransport` and mentions an advert field. A seventh path is in
 * scope the day it is written. Each either calls `advertForModel(` in shipped
 * (comment-stripped) text, or is in `RAW_ADVERT_OK` with a written reason.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, displayPath, isTestFile, stripComments, walk } from './repo-scan';

const APP_SRC = join(REPO_ROOT, 'apps/light/src');

/** Modules that may send the advert unstripped, and why. */
const RAW_ADVERT_OK: Readonly<Record<string, string>> = {
  'features/tracker/runExtraction.ts':
    'Extracts company, location and salary from the text; an agency footer or "posted by" block can be the only place they appear.',
};

const ADVERT_FIELD = /\b(jobText|advert|jobDescription|materials)\b/;

function runModules(): string[] {
  return walk(APP_SRC, { extensions: ['.ts'] }).filter(
    (p) => !isTestFile(p) && /^run[A-Z]\w*\.ts$/.test(basename(p)),
  );
}

describe('advert boilerplate contract', () => {
  const modules = runModules();

  it('finds the run modules (the scan is not vacuous)', () => {
    expect(modules.length).toBeGreaterThanOrEqual(7);
  });

  it.each(modules.map((p) => [displayPath(p), p] as const))(
    '%s sends adverts through advertForModel, or says why not',
    (shown, path) => {
      const text = stripComments(readFileSync(path, 'utf8'));
      if (!text.includes('createTauriTransport') || !ADVERT_FIELD.test(text)) return;
      const key = shown.replaceAll('\\', '/').replace(/^.*apps\/light\/src\//, '');
      if (key in RAW_ADVERT_OK) {
        expect(text).not.toContain('advertForModel');
        return;
      }
      expect(text).toContain('advertForModel(');
    },
  );
});
