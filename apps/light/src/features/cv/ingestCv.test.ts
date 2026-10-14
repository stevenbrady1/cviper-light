/**
 * One way in for a CV, whichever screen the button is on (L-240).
 *
 * The REAL parser runs here — not a mock. A JSON Resume needs no pdf.js, an
 * empty file and a `.txt` are refused before any format code runs, so every
 * case below is the same code path a user's file takes.
 */
import { describe, expect, it } from 'vitest';

import { err, ok, type Cv } from '@cviper/core-types';

import { createFakeFilePort } from '../../platform/test/fakeFilePort';
import { createFakeAnalysisPort } from '../analysis/test/fakePort';

import { ingestCv, uploadCv } from './ingestCv';

const NOW = new Date('2026-10-14T09:00:00.000Z');
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const RESUME = JSON.stringify({
  basics: { name: 'Jane Smith', label: 'Senior Credit Risk Analyst' },
  work: [
    {
      name: 'Lloyds Banking Group',
      position: 'Credit Risk Analyst',
      summary: 'Built SQL stress-testing models and IFRS 9 impairment reporting for the CRO.',
    },
  ],
  skills: [{ name: 'Risk', keywords: ['SQL', 'Python', 'Basel III'] }],
});

function deps(port = createFakeAnalysisPort()) {
  return { saveCv: port.saveCv.bind(port), now: NOW, newId: () => 'cv-new' };
}

describe('ingestCv', () => {
  it('reads the file, stores it in the shared CV store, and returns it', async () => {
    const port = createFakeAnalysisPort();
    const result = await ingestCv(
      { name: 'jane-smith.json', path: 'C:\\jane-smith.json', bytes: utf8(RESUME) },
      deps(port),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cv.id).toBe('cv-new');
    expect(result.value.cv.name).toBe('jane-smith.json');
    expect(result.value.cv.extracted_text).toContain('Credit Risk Analyst');
    expect(result.value.cv.created_at).toBe(NOW.toISOString());
    // L-147: where the file lives on this computer is never stored.
    expect(result.value.cv.file_path).toBeNull();
    // L-20b: a JSON Resume is kept verbatim so it can be saved back out.
    expect(result.value.cv.json_resume).toBe(RESUME);
    expect(port.storedCvs()).toEqual([result.value.cv]);
  });

  it('boundary: an empty file is refused in the parser’s own words, and nothing is stored', async () => {
    const port = createFakeAnalysisPort();
    const result = await ingestCv(
      { name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array(0) },
      deps(port),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unreadable');
    expect(result.error.message.toLowerCase()).toContain('empty');
    expect(port.storedCvs()).toEqual([]);
  });

  it('negative: a file that is not a CV format is refused, and nothing is stored', async () => {
    const port = createFakeAnalysisPort();
    const result = await ingestCv(
      { name: 'notes.txt', path: 'C:\\notes.txt', bytes: utf8('just some notes') },
      deps(port),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unreadable');
    expect(port.storedCvs()).toEqual([]);
  });

  it('negative: a CV that read but could not be saved says so and asks to try again', async () => {
    const port = createFakeAnalysisPort();
    port.failNext('saveCv');
    const result = await ingestCv(
      { name: 'jane-smith.json', path: 'C:\\jane-smith.json', bytes: utf8(RESUME) },
      deps(port),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not-saved');
    expect(result.error.message).toMatch(/^That CV could not be saved: .+ Try again\.$/);
  });
});

describe('uploadCv — the dialog, then ingestCv', () => {
  it('a cancelled dialog is not a problem: nothing is read and nothing is said', async () => {
    const files = createFakeFilePort();
    const port = createFakeAnalysisPort();
    files.nextCv(null);

    const result = await uploadCv(files, deps(port));

    expect(result).toEqual(ok(null));
    expect(port.storedCvs()).toEqual([]);
  });

  it('negative: a refusal from the file layer comes back verbatim', async () => {
    const files = createFakeFilePort();
    files.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');

    const result = await uploadCv(files, deps());

    expect(result).toEqual(
      err({
        kind: 'unreadable',
        message: 'CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.',
      }),
    );
  });

  it('a picked file goes through the same ingest', async () => {
    const files = createFakeFilePort();
    const port = createFakeAnalysisPort();
    files.nextCv({ name: 'jane-smith.json', path: 'C:\\jane-smith.json', bytes: utf8(RESUME) });

    const result = await uploadCv(files, deps(port));

    expect(result.ok && result.value !== null ? result.value.cv.name : null).toBe(
      'jane-smith.json',
    );
    expect(port.storedCvs().map((cv: Cv) => cv.id)).toEqual(['cv-new']);
  });
});
