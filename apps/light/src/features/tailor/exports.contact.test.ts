/**
 * L-346 — the confirmed name and contact line in all three saved CVs.
 *
 * Every file is READ BACK by the app's own readers (`extractPdfText`,
 * `extractDocxText` from `@cviper/cv-parsing`, the ones that read uploaded
 * CVs), so these assert what a recruiter's system would see, not the object
 * that produced it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  extractDocxText,
  extractPdfText,
  resetPdfJs,
  setPdfJsLoader,
  type PdfJsLike,
} from '@cviper/cv-parsing';
import { renderTailoredCv, type TailoredCv } from '@cviper/core-types';

import { buildCvDocx } from './docx';
import { cvBlocks } from './exportBlocks';
import { buildCvPdf, layoutBlocks } from './pdf';

const loadLegacyBuild = async (): Promise<PdfJsLike> =>
  (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;

const CV: TailoredCv = {
  summary: 'Credit risk analyst with eight years in London banking.',
  key_skills: ['SQL', 'Python'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2019 – present',
      bullets: ['Cut IFRS 9 model run time by 40%.'],
    },
  ],
  education: ['BSc Mathematics, University of Manchester, 2016'],
  certifications: [],
};

const NAME = 'Jane Smith';
const LINE = 'jane@x.com | 07700 900123';

beforeAll(async () => {
  setPdfJsLoader(loadLegacyBuild);
  await extractPdfText(buildCvPdf(CV, null).bytes);
}, 60_000);

beforeEach(() => {
  resetPdfJs();
  setPdfJsLoader(loadLegacyBuild);
});

async function pdfText(bytes: Uint8Array): Promise<string> {
  const read = await extractPdfText(bytes);
  if (!read.ok) throw new Error(read.error.message);
  return read.value.text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const read = await extractDocxText(bytes);
  if (!read.ok) throw new Error(read.error.message);
  return read.value.text;
}

describe('cvBlocks with a contact line', () => {
  it('happy: an ordinary line straight under the name', () => {
    expect(cvBlocks(CV, NAME, LINE).slice(0, 3)).toEqual([
      { kind: 'name', text: NAME },
      { kind: 'line', text: LINE },
      { kind: 'heading', text: 'PROFESSIONAL SUMMARY' },
    ]);
  });

  it('regression: no third argument, or null, or blank, is the list it always was', () => {
    const before = cvBlocks(CV, NAME);
    expect(cvBlocks(CV, NAME, null)).toEqual(before);
    expect(cvBlocks(CV, NAME, '  ')).toEqual(before);
    expect(cvBlocks(CV, null)[0]).toEqual({ kind: 'heading', text: 'PROFESSIONAL SUMMARY' });
  });

  it('edge: a line with no name still goes first', () => {
    expect(cvBlocks(CV, null, LINE)[0]).toEqual({ kind: 'line', text: LINE });
  });
});

describe('the three files read back with the details (happy)', () => {
  it('the PDF opens with the name and the contact line', async () => {
    const text = await pdfText(buildCvPdf(CV, NAME, LINE).bytes);
    expect(text.startsWith(`${NAME}\n${LINE}`)).toBe(true);
    expect(text).toContain('PROFESSIONAL SUMMARY');
  });

  it('the Word file opens with the name and the contact line', async () => {
    const text = await docxText(await buildCvDocx(CV, NAME, LINE));
    expect(
      text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(0, 2),
    ).toEqual([NAME, LINE]);
  });

  it('the text file opens with the name and the contact line', () => {
    expect(renderTailoredCv(CV, NAME, LINE).split('\n').slice(0, 2)).toEqual([NAME, LINE]);
  });

  it('regression: without details the PDF and Word text are unchanged', async () => {
    expect(await pdfText(buildCvPdf(CV, null, null).bytes)).toBe(
      await pdfText(buildCvPdf(CV, null).bytes),
    );
    expect(await docxText(await buildCvDocx(CV, null, null))).toBe(
      await docxText(await buildCvDocx(CV, null)),
    );
  });
});

describe('letters the PDF font cannot show (edge)', () => {
  /** What `layoutBlocks` reports it could not draw, for the dialog's warning. */
  function cannotShow(name: string): string[] {
    const missing = new Set<string>();
    layoutBlocks([{ kind: 'name', text: name }], missing);
    return [...missing];
  }

  it.each([
    ['Cyrillic', 'Иван Петров'],
    ['CJK', '王伟'],
    ['Vietnamese', 'Nguyễn Văn An'],
  ])('%s: named as missing, and the Word file keeps them exactly', async (_label, name) => {
    expect(cannotShow(name).length).toBeGreaterThan(0);
    expect(buildCvPdf(CV, name, LINE).missing.length).toBeGreaterThan(0);
    const word = await docxText(await buildCvDocx(CV, name, LINE));
    expect(word).toContain(name);
  });

  it('negative: plain Latin letters are not reported', () => {
    expect(cannotShow('Jane Smith')).toEqual([]);
    expect(cannotShow('JANE SMITH')).toEqual([]);
  });
});
