/**
 * Big numbers are written the way this computer writes them (L-423).
 *
 * "9,000" is how Britain and the United States write nine thousand; Germany
 * writes "9.000". The app used to force the British form on everyone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cvCutNote } from './cvCutNote';

const real = Number.prototype.toLocaleString;

/** A computer set to `locale`: a number formatted with no locale named uses it. */
function computerSetTo(locale: string): void {
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return real.call(this, locales ?? locale, options);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cvCutNote follows the computer’s number format (L-423)', () => {
  it('happy: a computer set to German reads 9.000, 6.000 and 16.000', () => {
    computerSetTo('de-DE');
    const note = cvCutNote('a'.repeat(9_000), 'ollama') ?? '';
    expect(note).toContain('9.000 characters');
    expect(note).toContain('first 6.000');
    expect(note).toContain('16.000');
  });

  it('negative: no number in the note is in the British form on that computer', () => {
    computerSetTo('de-DE');
    expect(cvCutNote('a'.repeat(20_000), 'openai') ?? '').not.toMatch(/\d,\d{3}/);
  });

  it('boundary: a computer set to British English still reads 9,000', () => {
    computerSetTo('en-GB');
    expect(cvCutNote('a'.repeat(9_000), 'ollama') ?? '').toContain('9,000 characters');
  });
});
