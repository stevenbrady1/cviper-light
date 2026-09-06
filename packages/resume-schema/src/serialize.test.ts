import { describe, expect, it } from 'vitest';

import { parseJsonResume } from './parse';
import { serializeJsonResume } from './serialize';
import { FULL_RESUME, FULL_RESUME_TEXT } from './test/fixtures';

function parsed(text: string) {
  const result = parseJsonResume(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('serializeJsonResume — round trip', () => {
  it('writes back exactly the file that was read', () => {
    // Fixture equality, byte for byte: same keys, same order, same values,
    // including the unknown keys and `meta.cviper`. This is the L-20
    // acceptance test.
    expect(serializeJsonResume(parsed(FULL_RESUME_TEXT))).toBe(FULL_RESUME_TEXT);
  });

  it('is a fixed point: serialise, parse, serialise gives the same text', () => {
    const once = serializeJsonResume(parsed(FULL_RESUME_TEXT));
    const twice = serializeJsonResume(parsed(once));
    expect(twice).toBe(once);
  });

  it('produces a document equal to the source object', () => {
    expect(JSON.parse(serializeJsonResume(parsed(FULL_RESUME_TEXT)))).toStrictEqual(FULL_RESUME);
  });

  it('keeps a file’s own key order rather than imposing the schema’s', () => {
    const text = '{\n  "skills": [],\n  "basics": {\n    "name": "Jane"\n  }\n}\n';
    expect(serializeJsonResume(parsed(text))).toBe(text);
  });

  it('ends with exactly one newline and indents with two spaces', () => {
    const text = serializeJsonResume(parsed('{"basics":{"name":"Jane"}}'));
    expect(text).toBe('{\n  "basics": {\n    "name": "Jane"\n  }\n}\n');
  });
});
