import { describe, expect, it } from 'vitest';

import { parseJsonResume } from './parse';
import { serializeJsonResume } from './serialize';
import { stampCviperMeta } from './stamp';
import { FULL_RESUME, FULL_RESUME_TEXT } from './test/fixtures';

function parsed(text: string) {
  const result = parseJsonResume(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const STAMP = { app: 'cviper-light', exportedAt: '2026-09-08T10:00:00.000Z', sourceCvId: 'cv-9' };

describe('stampCviperMeta', () => {
  it('round trip: the export is the fixture, byte for byte, except the cviper block', () => {
    // The L-20b acceptance test: import → stamp → export, compared with the
    // fixture in which ONLY `meta.cviper` has been replaced.
    const expected = `${JSON.stringify(
      { ...FULL_RESUME, meta: { ...FULL_RESUME.meta, cviper: STAMP } },
      null,
      2,
    )}\n`;
    expect(serializeJsonResume(stampCviperMeta(parsed(FULL_RESUME_TEXT), STAMP))).toBe(expected);
  });

  it('keeps every other key in the order the file had', () => {
    const source = parsed(
      '{"skills":[{"name":"SQL"}],"basics":{"name":"A"},"meta":{"version":"v1"}}',
    );
    const stamped = stampCviperMeta(source, STAMP);
    expect(Object.keys(stamped)).toEqual(['skills', 'basics', 'meta']);
    expect(stamped.meta).toEqual({ version: 'v1', cviper: STAMP });
  });

  it('adds meta at the end when the file had none', () => {
    const source = parsed('{"basics":{"name":"A"},"work":[{"name":"X"}]}');
    const stamped = stampCviperMeta(source, STAMP);
    expect(Object.keys(stamped)).toEqual(['basics', 'work', 'meta']);
    expect(stamped.meta).toEqual({ cviper: STAMP });
  });

  it('negative: does not mutate the input', () => {
    const source = parsed(FULL_RESUME_TEXT);
    const before = JSON.stringify(source);
    stampCviperMeta(source, STAMP);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('boundary: an existing cviper block is replaced whole, not merged', () => {
    const source = parsed(FULL_RESUME_TEXT);
    const stamped = stampCviperMeta(source, { app: 'cviper-light' });
    expect(stamped.meta?.cviper).toEqual({ app: 'cviper-light' });
  });
});
