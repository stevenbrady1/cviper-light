import { describe, expect, it } from 'vitest';

import { notAJsonResumeError } from './errors';
import { parseJsonResume } from './parse';

/**
 * L-347: the "not a JSON Resume" message used to say CVAurum and Reactive
 * Resume export JSON Resume. Reactive Resume saves its own format, so a user
 * told to export from it would get the same error again. The message now
 * explains the format and names no product at all.
 */

const PRODUCT_NAMES = [/reactive\s*-?\s*resume/i, /cvaurum/i, /jsonresume\.org/i];

function notAResumeMessage(): string {
  const result = parseJsonResume('{"jobs":[],"applications":[]}');
  if (result.ok) throw new Error('expected a NOT_A_JSON_RESUME error');
  expect(result.error.code).toBe('NOT_A_JSON_RESUME');
  return result.error.message;
}

describe('notAJsonResumeError — the wording (L-347)', () => {
  it('still says the file is not a JSON Resume, and explains the format', () => {
    const message = notAResumeMessage();

    expect(message).toMatch(/not a JSON Resume/);
    expect(message).toContain(
      'CViper reads the JSON Resume format. Some CV builders save their own kind of ' +
        'JSON instead, so look for an export called JSON Resume.',
    );
  });

  it('does not say Reactive Resume or CVAurum export JSON Resume', () => {
    const message = notAResumeMessage();

    expect(message).not.toMatch(/reactive resume/i);
    expect(message).not.toMatch(/cvaurum/i);
  });

  it('names no product at all', () => {
    const { message } = notAJsonResumeError();

    for (const name of PRODUCT_NAMES) expect(message).not.toMatch(name);
  });

  it('keeps the opening sentence and ends on "Check you picked the right file."', () => {
    const { message } = notAJsonResumeError();

    expect(message.startsWith('That is a JSON file, but not a JSON Resume: ')).toBe(true);
    expect(message).toContain('(basics, work, education, skills and so on) is in it. ');
    expect(message.endsWith('Check you picked the right file.')).toBe(true);
    expect(message).not.toMatch(/\s{2,}/);
  });
});
