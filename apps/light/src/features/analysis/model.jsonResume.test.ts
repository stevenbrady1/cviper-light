import { describe, expect, it } from 'vitest';

import { type Cv } from '@cviper/core-types';

import {
  FALLBACK_JSON_RESUME_NAME,
  exportJsonResume,
  isJsonResumeFileName,
  jsonResumeFileName,
  newCvRecord,
  originalJsonResume,
} from './model';

/**
 * The JSON Resume export half of L-20 (L-20b): the original is kept verbatim
 * on the way in, and goes back out byte-identical except for `meta.cviper`.
 */

const RESUME_TEXT = `{
  "skills": [
    {
      "name": "SQL"
    }
  ],
  "basics": {
    "name": "Steve Brady"
  },
  "meta": {
    "version": "v1",
    "cviper": {
      "app": "someone-else",
      "exportedAt": "2020-01-01T00:00:00Z"
    }
  }
}
`;

const utf8 = (text: string) => new TextEncoder().encode(text);

function cvFrom(jsonResume: string | null, name = 'Steve Brady CV.json'): Cv {
  return {
    id: 'cv-42',
    name,
    file_path: 'C:\\Users\\steve\\Documents\\' + name,
    extracted_text: 'Steve Brady SQL',
    created_at: '2026-09-08T09:00:00.000Z',
    json_resume: jsonResume,
  };
}

describe('originalJsonResume', () => {
  it('happy: keeps a .json file’s text exactly', () => {
    expect(originalJsonResume('CV.json', utf8(RESUME_TEXT))).toBe(RESUME_TEXT);
  });

  it('is case-insensitive about the extension and ignores surrounding space', () => {
    expect(isJsonResumeFileName('CV.JSON')).toBe(true);
    expect(isJsonResumeFileName(' CV.Json ')).toBe(true);
    expect(isJsonResumeFileName('CV.json.pdf')).toBe(false);
  });

  it('negative: a PDF or a .docx has nothing to keep', () => {
    expect(originalJsonResume('CV.pdf', utf8(RESUME_TEXT))).toBeNull();
    expect(originalJsonResume('CV.docx', utf8(RESUME_TEXT))).toBeNull();
  });

  it('edge: drops a byte-order mark and refuses bytes that are not UTF-8', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{"basics":{}}')]);
    expect(originalJsonResume('CV.json', bom)).toBe('{"basics":{}}');
    expect(originalJsonResume('CV.json', new Uint8Array([0xff, 0xfe, 0x7b]))).toBeNull();
  });

  it('newCvRecord stores it, and defaults to null when not given', () => {
    const base = {
      id: 'a',
      name: 'CV.json',
      path: null,
      text: 't',
      now: '2026-09-08T09:00:00.000Z',
    };
    expect(newCvRecord({ ...base, jsonResume: RESUME_TEXT }).json_resume).toBe(RESUME_TEXT);
    expect(newCvRecord(base).json_resume).toBeNull();
  });
});

describe('jsonResumeFileName', () => {
  it('happy: swaps the extension for .json, keeping the name', () => {
    expect(jsonResumeFileName('Steve Brady CV.json')).toBe('Steve Brady CV.json');
    expect(jsonResumeFileName('Steve Brady CV.pdf')).toBe('Steve Brady CV.json');
    expect(jsonResumeFileName('resume.JSON')).toBe('resume.json');
  });

  it('boundary: a dotted name loses only its last extension', () => {
    expect(jsonResumeFileName('cv.v2.final.docx')).toBe('cv.v2.final.json');
  });

  it('boundary: nothing left after the extension falls back to cv.json', () => {
    expect(jsonResumeFileName('')).toBe(FALLBACK_JSON_RESUME_NAME);
    expect(jsonResumeFileName('.json')).toBe(FALLBACK_JSON_RESUME_NAME);
    expect(jsonResumeFileName('   ')).toBe(FALLBACK_JSON_RESUME_NAME);
  });

  it('negative: separators and control characters are passed through, not repaired — Rust decides', () => {
    // The TypeScript side suggests; `bare_json_name` in files.rs is the guard
    // and falls back to cv.json for these. Repairing here would be a second,
    // differently-wrong copy of that rule.
    expect(jsonResumeFileName('..\\CV.pdf')).toBe('..\\CV.json');
  });
});

describe('exportJsonResume', () => {
  const stamp = { app: 'cviper-light', exportedAt: '2026-09-08T10:00:00.000Z' };

  it('round trip: the file that came in goes out, with only meta.cviper replaced', () => {
    const out = exportJsonResume({ cv: cvFrom(RESUME_TEXT), ...stamp });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const expected = RESUME_TEXT.replace(
      `"cviper": {
      "app": "someone-else",
      "exportedAt": "2020-01-01T00:00:00Z"
    }`,
      `"cviper": {
      "app": "cviper-light",
      "exportedAt": "2026-09-08T10:00:00.000Z",
      "sourceCvId": "cv-42"
    }`,
    );
    expect(out.value).toBe(expected);
    // Key order survived: skills before basics, as the file had it.
    expect(Object.keys(JSON.parse(out.value) as object)).toEqual(['skills', 'basics', 'meta']);
  });

  it('negative: a CV that did not arrive as a JSON Resume has nothing to export', () => {
    const out = exportJsonResume({ cv: cvFrom(null, 'CV.pdf'), ...stamp });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.message).toMatch(/CV\.pdf/);
    expect(out.error.message).toMatch(/nothing to save/);
  });

  it('negative: a stored original that no longer parses is reported, never written', () => {
    const out = exportJsonResume({ cv: cvFrom('{"basics": '), ...stamp });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.message).toMatch(/could not be read/);
  });
});
