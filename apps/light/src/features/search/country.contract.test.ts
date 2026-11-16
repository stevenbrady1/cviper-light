/**
 * The app never guesses a country (L-417, owner decision 13 Nov 2026).
 *
 * A forbid-list over the shipped text of `country.ts`, comments stripped: the
 * comment explaining the rule must not be what satisfies it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../../lib/repo-scan';

describe('the app never guesses', () => {
  it('contract: country.ts reads neither the time zone nor the language', () => {
    const source = stripComments(
      readFileSync(fileURLToPath(new URL('./country.ts', import.meta.url)), 'utf8'),
    );

    for (const guess of [
      'Intl',
      'navigator',
      'timeZone',
      'getTimezoneOffset',
      'resolvedOptions',
      'languages',
    ]) {
      expect(source, `${guess} would be a guess`).not.toContain(guess);
    }
  });

  it('the contract sees a guess, and is not fooled by a comment', () => {
    expect(
      stripComments('const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;'),
    ).toContain('Intl');
    expect(stripComments('// never Intl or navigator.language')).not.toContain('Intl');
  });
});
