/**
 * The PDF export (L-201): the tailored CV and the cover letter as PDF bytes,
 * built on this machine with no font file and no PDF library.
 *
 * THE ROUND TRIP IS THE TEST. Every file built here is read back by the
 * app's OWN PDF reader (`extractPdfText` from `@cviper/cv-parsing`, the one
 * that reads uploaded CVs) and must give back the same text, in the same
 * order, as the plain-text export. If Light cannot read its own PDF, an
 * applicant-tracking system will not read it either.
 *
 * The ATS rules are a FORBID-LIST, as in `docx.test.ts`: no image, no
 * drawing object, no link box, no second column.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { extractPdfText, resetPdfJs, setPdfJsLoader, type PdfJsLike } from '@cviper/cv-parsing';
import {
  renderCoverLetter,
  renderTailoredCv,
  type CoverLetter,
  type TailoredCv,
} from '@cviper/core-types';

import { cvBlocks } from './exportBlocks';
import { HELVETICA_GLYPHS } from './helvetica';
import { PAGE, buildCoverLetterPdf, buildCvPdf, layoutBlocks } from './pdf';

// ── pdf.js under Node: the legacy build, warmed once (see cv-parsing's
// `test/pdfjs-node.ts` for why it is this build and why it is warmed). ──────

const loadLegacyBuild = async (): Promise<PdfJsLike> =>
  (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;

// Loads the ~1.2 MB build and reads one page now, so no single test is billed
// for it on a cold runner. `beforeEach` still resets the parser for every test.
beforeAll(async () => {
  setPdfJsLoader(loadLegacyBuild);
  await extractPdfText(buildCvPdf(CV, null).bytes);
}, 60_000);

beforeEach(() => {
  resetPdfJs();
  setPdfJsLoader(loadLegacyBuild);
});

// ── Fixtures ────────────────────────────────────────────────────────────────

const CV: TailoredCv = {
  summary: 'Credit risk analyst with eight years in London banking.',
  key_skills: ['SQL', 'Python', 'IFRS 9'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2019 – present',
      bullets: ['Cut IFRS 9 model run time by 40%.', 'Led a team of three analysts.'],
    },
    {
      title: 'Credit Risk Analyst',
      company: 'Barclays',
      location: '',
      dates: '2016 – 2019',
      bullets: ['Built the PD model in Python.'],
    },
  ],
  education: ['BSc Mathematics, University of Manchester, 2016'],
  certifications: ['FRM'],
};

const LETTER: CoverLetter = {
  greeting: 'Dear Hiring Manager,',
  paragraphs: [
    'Having spent eight years in credit risk, I was drawn to the Credit Risk Analyst role.',
    'At Lloyds Banking Group I cut IFRS 9 model run time by 40%.',
  ],
  sign_off: 'Yours sincerely,\nSteve Brady',
};

/** A CV long enough for three pages or more: twelve roles of six bullets. */
function longCv(): TailoredCv {
  return {
    ...CV,
    summary: `${CV.summary} `.repeat(6).trim(),
    experience: Array.from({ length: 12 }, (_, role) => ({
      title: `Risk Analyst ${role + 1}`,
      company: `Bank ${role + 1}`,
      location: 'London',
      dates: `${2000 + role} – ${2001 + role}`,
      bullets: Array.from(
        { length: 6 },
        (_, point) =>
          `Role ${role + 1} point ${point + 1}: rebuilt the stress-testing suite for the ` +
          'retail book and cut quarter-end run time from three days to four hours.',
      ),
    })),
  };
}

async function readBack(bytes: Uint8Array) {
  const result = await extractPdfText(bytes);
  if (!result.ok) throw new Error(`the app could not read its own PDF: ${result.error.message}`);
  return result.value;
}

/** Words in order: what both files say, whatever their line breaks. */
function words(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:-|•)\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

// ── The round trip ──────────────────────────────────────────────────────────

describe('buildCvPdf — read back by the app’s own PDF reader', () => {
  it('happy: the same words, in the same order, as the text export', async () => {
    const built = buildCvPdf(CV, 'Steve Brady');
    const read = await readBack(built.bytes);

    expect(words(read.text)).toBe(words(renderTailoredCv(CV, 'Steve Brady')));
    expect(built.missing).toEqual([]);
  });

  it('every section heading comes back as a line of its own, in order', async () => {
    const lines = (await readBack(buildCvPdf(CV, null).bytes)).text.split('\n');
    const headings = [
      'PROFESSIONAL SUMMARY',
      'KEY SKILLS',
      'PROFESSIONAL EXPERIENCE',
      'EDUCATION',
      'CERTIFICATIONS',
    ].map((heading) => lines.findIndex((line) => line.trim() === heading));

    expect(headings.every((index) => index >= 0)).toBe(true);
    expect([...headings].sort((a, b) => a - b)).toEqual(headings);
  });

  it('edge: names with accents — é, ł, ñ and friends — come back exactly', async () => {
    const name = 'Zoë Łukasz-Peña';
    const cv: TailoredCv = {
      ...CV,
      summary: 'Analyst at Société Générale, Kraków and Málaga; fluent in Español, Polski.',
      key_skills: ['Ćwiczenia', 'Øresund', 'Smørrebrød', 'Ţară', 'Œuvre'],
    };
    const built = buildCvPdf(cv, name);
    const read = await readBack(built.bytes);

    expect(built.missing).toEqual([]);
    expect(read.text.split('\n')[0]?.trim()).toBe(name);
    expect(words(read.text)).toBe(words(renderTailoredCv(cv, name)));
  });

  it('boundary: a long CV runs to three pages or more, and every bullet survives', async () => {
    const cv = longCv();
    const read = await readBack(buildCvPdf(cv, 'Steve Brady').bytes);

    expect(read.pageCount).toBeGreaterThanOrEqual(3);
    expect(read.warnings).toEqual([]);
    expect(words(read.text)).toBe(words(renderTailoredCv(cv, 'Steve Brady')));
  });

  it('negative: characters the built-in font cannot draw are named, not dropped quietly', async () => {
    const cv: TailoredCv = { ...CV, key_skills: ['SQL', 'Русский', '中文', 'Python 🐍'] };
    const built = buildCvPdf(cv, null);

    expect(built.missing).toEqual(['Р', 'у', 'с', 'к', 'и', 'й', '中', '文', '🐍']);
    // Still a PDF the app can read, with the rest of the CV intact.
    const read = await readBack(built.bytes);
    expect(read.text).toContain('Python');
    expect(read.text).toContain('Credit risk analyst');
  });

  it('edge: invisible characters vanish and odd spaces become spaces, silently', async () => {
    const cv: TailoredCv = {
      ...CV,
      summary: 'Risk analyst​ with\tco­operation﻿ skills.',
    };
    const built = buildCvPdf(cv, null);
    const read = await readBack(built.bytes);

    expect(built.missing).toEqual([]);
    expect(read.text).toContain('Risk analyst with cooperation skills.');
  });

  it('boundary: a word wider than the page is broken across lines, never cut off', async () => {
    const url = `https://example.com/${'portfolio'.repeat(20)}`;
    const cv: TailoredCv = { ...CV, certifications: [url] };
    const read = await readBack(buildCvPdf(cv, null).bytes);

    expect(read.text.replace(/\s+/g, '')).toContain(url);
  });

  it('boundary: more than 128 different accented characters still all come back', async () => {
    // Every non-ASCII letter the built-in fonts have — more than one font's
    // 128 spare codes, so the second pair of fonts has to be used. Letters a
    // reader rewrites by design (the ligature ﬁ as "fi", the micro sign as μ)
    // are left out: those are the reader's normalising, not a lost character.
    const every = HELVETICA_GLYPHS.map(([codePoint]) => String.fromCodePoint(codePoint))
      .filter(
        (char) =>
          char.charCodeAt(0) > 160 && /\p{L}/u.test(char) && char.normalize('NFKC') === char,
      )
      .join('');
    expect(every.length).toBeGreaterThan(128);

    const cv: TailoredCv = { ...CV, summary: every.match(/.{1,20}/gu)?.join(' ') ?? '' };
    const built = buildCvPdf(cv, null);
    const read = await readBack(built.bytes);

    expect(built.missing).toEqual([]);
    expect(read.text.replace(/\s+/g, '')).toContain(every);
  });

  it('boundary: a CV with every optional section empty is still a valid one-page PDF', async () => {
    const cv: TailoredCv = {
      summary: 'Analyst.',
      key_skills: [],
      experience: [],
      education: [],
      certifications: [],
    };
    const read = await readBack(buildCvPdf(cv, null).bytes);

    expect(read.pageCount).toBe(1);
    expect(words(read.text)).toBe('PROFESSIONAL SUMMARY Analyst.');
  });
});

describe('buildCoverLetterPdf', () => {
  it('happy: the same words as the text export, the sign-off name on its own line', async () => {
    const read = await readBack(buildCoverLetterPdf(LETTER).bytes);

    expect(words(read.text)).toBe(words(renderCoverLetter(LETTER)));
    expect(read.text.split('\n').map((line) => line.trim())).toContain('Steve Brady');
  });
});

// ── ATS-safe, by forbid-list ────────────────────────────────────────────────

describe('ATS-safe (forbid-list)', () => {
  const file = asText(buildCvPdf(longCv(), 'Steve Brady').bytes);

  it('is a PDF from its first byte to its last', () => {
    expect(file.startsWith('%PDF-1.')).toBe(true);
    expect(file.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has no image, no drawing object, no link box, no embedded font file', () => {
    for (const forbidden of ['/Image', '/XObject', '/Annots', '/FontFile', '/JavaScript']) {
      expect(file).not.toContain(forbidden);
    }
  });

  it('uses only the two built-in fonts every reader has', () => {
    const fonts = new Set([...file.matchAll(/\/BaseFont \/([A-Za-z-]+)/g)].map((m) => m[1]));
    expect([...fonts].sort()).toEqual(['Helvetica', 'Helvetica-Bold']);
  });
});

describe('layoutBlocks', () => {
  const pages = layoutBlocks(cvBlocks(longCv(), 'Steve Brady'));
  const lines = pages.flat();

  it('one column: every line starts at the margin, or at the bullet indent', () => {
    const starts = new Set(lines.map((line) => line.x));
    expect([...starts].every((x) => x >= PAGE.margin && x < PAGE.margin + 20)).toBe(true);
  });

  it('nothing runs past the right margin or below the bottom one', () => {
    for (const line of lines) {
      expect(line.x + line.width).toBeLessThanOrEqual(PAGE.width - PAGE.margin + 0.01);
      expect(line.y).toBeGreaterThanOrEqual(PAGE.margin);
    }
  });

  it('a role’s title is bold, with space above it to set each role apart', () => {
    const title = lines.find((line) => line.text === 'Risk Analyst 2');
    const above = lines[lines.indexOf(title!) - 1];
    expect(title?.bold).toBe(true);
    expect(lines.find((line) => line.text.startsWith('Bank 2 |'))?.bold).toBe(false);
    // The previous role's last bullet sits more than one plain line above it.
    if (above !== undefined && above.y > title!.y) {
      expect(above.y - title!.y).toBeGreaterThan(14);
    }
  });

  it('a role’s title and its Company | Dates line never end a page — whatever the CV’s length', () => {
    // Every length from 1 to 20 roles, so the page break falls on every part
    // of a role at least once.
    for (let roles = 1; roles <= 20; roles += 1) {
      const cv = { ...longCv(), experience: longCv().experience.concat(longCv().experience) };
      const laidOut = layoutBlocks(
        cvBlocks({ ...cv, experience: cv.experience.slice(0, roles) }, 'Steve Brady'),
      );
      for (const page of laidOut.slice(0, -1)) {
        const last = page.at(-1);
        expect(last?.bold, `${roles} roles: ${last?.text}`).toBe(false);
        expect(last?.text, `${roles} roles`).not.toMatch(/^Bank \d+ \|/);
      }
    }
  });

  it('a heading is never the last line on a page', () => {
    for (const page of pages.slice(0, -1)) {
      expect(page.at(-1)?.kind).not.toBe('heading');
    }
  });
});
