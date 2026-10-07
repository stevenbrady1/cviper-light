/**
 * The tailored CV and the cover letter as a Word document (L-165).
 *
 * ============================================================================
 * BUILT HERE, ON THIS MACHINE. NOTHING IS SENT ANYWHERE.
 * ============================================================================
 * `docx` assembles the zip in memory from the same `TailoredCv` and
 * `CoverLetter` the text render reads. The bytes go to `FilePort.saveBytes`,
 * which hands them to Rust as base64; Rust opens the save dialog, caps the
 * size and writes the one file the user chose. No network, no template
 * fetched from anywhere, no server that "converts" a document.
 *
 * ============================================================================
 * ATS-SAFE, BY THE SAME RULES THE PROMPT ENFORCES
 * ============================================================================
 * The tailoring prompt asks the model for a CV a parser can read, and this
 * file renders it the same way: a single column, the standard headings in
 * `MANDATORY_STRUCTURE`'s order (name, PROFESSIONAL SUMMARY, KEY SKILLS,
 * PROFESSIONAL EXPERIENCE with title / `Company | Location | Dates` /
 * bullets, EDUCATION, CERTIFICATIONS), one plain font throughout, real Word
 * headings and a real Word list — and NO tables, NO images, NO text boxes.
 * Every one of those is a thing applicant-tracking systems are known to
 * read as nothing, or as the wrong thing. `docx.test.ts` asserts the
 * absences, so a decorative table cannot come back in a later change.
 *
 * WHAT goes in, and in what order, is `exportBlocks.ts`'s — shared with the
 * PDF export (L-201), so the two files always agree. An empty section is
 * omitted rather than rendered as a bare heading, and the candidate's name is
 * written ONLY when the app knows it — the same two rules as
 * `renderTailoredCv`, for the same reasons.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

import { type CoverLetter, type TailoredCv } from '@cviper/core-types';

import { cvBlocks, letterBlocks, type ExportBlock } from './exportBlocks';

/**
 * One plain font, everywhere. Arial is on every Windows and macOS machine
 * and every parser's list; a font a parser lacks falls back to something
 * else on their side, and the CV still reads.
 */
const FONT = 'Arial';

/** Sizes are in half-points, as Word stores them: 22 is 11 pt. */
const BODY_HALF_POINTS = 22;
const HEADING_HALF_POINTS = 24;
const NAME_HALF_POINTS = 32;

/** Spacing is in twentieths of a point: 120 is 6 pt. */
const AFTER_PARAGRAPH = 120;
const BEFORE_HEADING = 240;

/** Word's own black, so a heading is never the theme's blue. */
const INK = '000000';

/** The styles that make every heading and every line plain. */
const STYLES = {
  default: {
    document: { run: { font: FONT, size: BODY_HALF_POINTS, color: INK } },
    title: {
      run: { font: FONT, size: NAME_HALF_POINTS, bold: true, color: INK },
      paragraph: { spacing: { after: AFTER_PARAGRAPH } },
    },
    heading1: {
      run: { font: FONT, size: HEADING_HALF_POINTS, bold: true, color: INK },
      paragraph: { spacing: { before: BEFORE_HEADING, after: AFTER_PARAGRAPH } },
    },
  },
} as const;

/** A body paragraph. `bold` is for a role's title, and nothing else. */
function line(text: string, options: { readonly bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, ...options })],
    spacing: { after: AFTER_PARAGRAPH },
  });
}

/** A section heading, as a real Word heading: `PROFESSIONAL SUMMARY` and its siblings. */
function heading(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text })], heading: HeadingLevel.HEADING_1 });
}

/** One bullet in a real Word list. */
function bullet(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun({ text })], bullet: { level: 0 } });
}

/**
 * A block of text as ONE paragraph, with each line break inside it kept as a
 * line break — a sign-off's name sits under the valediction, not a blank
 * line away.
 */
function blockParagraph(text: string): Paragraph {
  const lines = text.split('\n').map((part) => part.trim());
  return new Paragraph({
    children: lines.map((part, index) =>
      index === 0 ? new TextRun({ text: part }) : new TextRun({ text: part, break: 1 }),
    ),
    spacing: { after: AFTER_PARAGRAPH },
  });
}

/** One block of the shared export list as a Word paragraph. */
function paragraph(block: ExportBlock): Paragraph {
  switch (block.kind) {
    case 'name':
      return new Paragraph({
        children: [new TextRun({ text: block.text })],
        heading: HeadingLevel.TITLE,
      });
    case 'heading':
      return heading(block.text);
    case 'line':
      return line(block.text, block.bold === true ? { bold: true } : {});
    case 'bullet':
      return bullet(block.text);
    case 'block':
      return blockParagraph(block.text);
  }
}

/**
 * The bytes of a one-section document. `Packer.toBlob` is the browser-side
 * packer — this code runs in a WebView, not in Node — and a `Blob` becomes
 * bytes with one copy.
 */
async function pack(title: string, children: readonly Paragraph[]): Promise<Uint8Array> {
  const document = new Document({
    creator: 'CViper Light',
    title,
    styles: STYLES,
    sections: [{ children: [...children] }],
  });
  const blob = await Packer.toBlob(document);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The tailored CV as `.docx` bytes. `name` is `null` when the app does not
 * know the candidate's name, and nothing here guesses one.
 */
export function buildCvDocx(cv: TailoredCv, name: string | null): Promise<Uint8Array> {
  return pack('Tailored CV', cvBlocks(cv, name).map(paragraph));
}

/** The cover letter as `.docx` bytes. */
export function buildCoverLetterDocx(letter: CoverLetter): Promise<Uint8Array> {
  return pack('Cover letter', letterBlocks(letter).map(paragraph));
}
