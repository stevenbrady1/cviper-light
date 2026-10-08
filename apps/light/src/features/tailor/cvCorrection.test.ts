/**
 * L-218: correcting the CV text the AI works from. One correction, kept on the
 * CV itself, so Analysis, Tailor and every job use it; the text first read
 * from the file is kept beside it, to show what changed and to restore.
 */
import { describe, expect, it } from 'vitest';

import { type Cv } from '@cviper/core-types';

import { MAX_CV_TEXT_CHARS, correctedCv, isCorrected, restoredCv } from './cvCorrection';

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: 'Analyst at Barclays, 2019-2023.\nSQL, Python.',
  created_at: '2026-08-01T09:00:00.000Z',
  json_resume: null,
};

describe('correctedCv', () => {
  it('happy: the correction becomes the text; the file’s text is kept beside it', () => {
    const fixed = correctedCv(CV, 'Analyst at Barclays, 2019-2024.\nSQL, Python.');
    expect(fixed).toEqual({
      ok: true,
      value: {
        ...CV,
        extracted_text: 'Analyst at Barclays, 2019-2024.\nSQL, Python.',
        original_text: CV.extracted_text,
      },
    });
    expect(isCorrected(fixed.ok ? fixed.value : CV)).toBe(true);
  });

  it('a second correction keeps the FILE’s text as the original, not the first correction', () => {
    const once = correctedCv(CV, 'First fix.');
    const twice = once.ok ? correctedCv(once.value, 'Second fix.') : once;
    expect(twice.ok && twice.value.original_text).toBe(CV.extracted_text);
    expect(twice.ok && twice.value.extracted_text).toBe('Second fix.');
  });

  it('boundary: correcting it back to exactly the file’s text is a restore', () => {
    const once = correctedCv(CV, 'Changed.');
    const back = once.ok ? correctedCv(once.value, CV.extracted_text ?? '') : once;
    expect(back.ok && back.value).toEqual({ ...CV, original_text: null });
    expect(back.ok && isCorrected(back.value)).toBe(false);
  });

  it('negative: empty or whitespace-only text is refused', () => {
    expect(correctedCv(CV, '')).toEqual({ ok: false, error: 'empty' });
    expect(correctedCv(CV, ' \n\t ')).toEqual({ ok: false, error: 'empty' });
  });

  it('boundary: exactly the limit is accepted; one character more is refused', () => {
    expect(correctedCv(CV, 'a'.repeat(MAX_CV_TEXT_CHARS)).ok).toBe(true);
    expect(correctedCv(CV, 'a'.repeat(MAX_CV_TEXT_CHARS + 1))).toEqual({
      ok: false,
      error: 'too_long',
    });
  });

  it('edge: a CV the file gave no text for can be typed in; its original is empty', () => {
    const unread: Cv = { ...CV, extracted_text: null };
    const typed = correctedCv(unread, 'Pasted by hand.');
    expect(typed.ok && typed.value.extracted_text).toBe('Pasted by hand.');
    expect(typed.ok && typed.value.original_text).toBe('');
  });

  it('edge: Windows line endings in a paste are not a change on their own', () => {
    const back = correctedCv(CV, (CV.extracted_text ?? '').replaceAll('\n', '\r\n'));
    expect(back.ok && isCorrected(back.value)).toBe(false);
  });

  it('edge: accented and non-Latin text is kept exactly', () => {
    const text = 'Zoë Łukasz — Москва, 東京';
    const fixed = correctedCv(CV, text);
    expect(fixed.ok && fixed.value.extracted_text).toBe(text);
  });
});

describe('restoredCv', () => {
  it('happy: puts the file’s text back and forgets the correction', () => {
    const once = correctedCv(CV, 'Changed.');
    expect(once.ok && restoredCv(once.value)).toEqual({ ...CV, original_text: null });
  });

  it('negative: a CV that was never corrected is returned unchanged', () => {
    expect(restoredCv(CV)).toBe(CV);
  });
});

describe('isCorrected', () => {
  it('a CV from before this feature (no original_text at all) is not corrected', () => {
    expect(isCorrected(CV)).toBe(false);
    expect(isCorrected({ ...CV, original_text: null })).toBe(false);
  });

  it('boundary: an empty original still counts — the file gave nothing and the user typed it', () => {
    expect(isCorrected({ ...CV, original_text: '' })).toBe(true);
  });
});
