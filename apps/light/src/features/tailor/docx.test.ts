/**
 * The Word export (L-165): the tailored CV and the cover letter as `.docx`
 * bytes, built on this machine.
 *
 * The bytes are opened the way Word would open them — as a zip — and
 * `word/document.xml` is read out of them, so every assertion here is about
 * the file a user actually gets, not about the object that produced it. The
 * zip reader below is the twenty lines of the format a test needs (the
 * central directory and one local header) and `node:zlib` does the inflating;
 * nothing here is a dependency the app ships.
 *
 * The ATS rules are asserted as a FORBID-LIST, the house style: no table, no
 * drawing, no text box, no second column may appear. What IS present — the
 * headings, in `MANDATORY_STRUCTURE`'s order — is asserted by position in
 * the document's text, so a heading that moved would fail and a heading
 * that was merely reworded would not.
 */
import { inflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { type CoverLetter, type TailoredCv } from '@cviper/core-types';

import { buildCoverLetterDocx, buildCvDocx } from './docx';

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

// ── A zip reader the size of the format a test needs ─────────────────────────

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DEFLATE = 8;

/** Every entry in the zip, by name, inflated. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();

  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) end -= 1;
  if (end < 0) throw new Error('no end-of-central-directory record: not a zip');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) throw new Error('bad central header');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = text.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error(`bad local header: ${name}`);
    const dataStart =
      local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === DEFLATE ? new Uint8Array(inflateRawSync(data)) : data);

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** `word/document.xml`, as XML text. */
function documentXml(bytes: Uint8Array): string {
  const entry = unzip(bytes).get('word/document.xml');
  if (entry === undefined) throw new Error('the zip has no word/document.xml');
  return new TextDecoder().decode(entry);
}

/** The document's text, one line per paragraph, tags stripped. */
function documentText(bytes: Uint8Array): string[] {
  return documentXml(bytes)
    .split('</w:p>')
    .map((paragraph) => paragraph.replace(/<[^>]+>/g, '').trim())
    .filter((line) => line !== '');
}

/** The index of the first line equal to `line`, or a failure naming it. */
function lineIndex(lines: readonly string[], line: string): number {
  const index = lines.indexOf(line);
  if (index === -1) throw new Error(`no line ${JSON.stringify(line)} in ${JSON.stringify(lines)}`);
  return index;
}

/** The ATS forbid-list: none of these may appear in the document body. */
const FORBIDDEN_IN_BODY = ['<w:tbl', '<w:drawing', '<w:pict', '<w:txbxContent', '<w:object'];

describe('buildCvDocx', () => {
  it('is a zip with a Word document inside', async () => {
    const bytes = await buildCvDocx(CV, 'Steve Brady');

    // PK\x03\x04: the local-header signature every zip opens with.
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const entries = unzip(bytes);
    expect(entries.has('[Content_Types].xml')).toBe(true);
    expect(entries.has('word/document.xml')).toBe(true);
  });

  it("renders the sections in MANDATORY_STRUCTURE's order, headings and all", async () => {
    const lines = documentText(await buildCvDocx(CV, 'Steve Brady'));

    const name = lineIndex(lines, 'Steve Brady');
    const summary = lineIndex(lines, 'PROFESSIONAL SUMMARY');
    const skills = lineIndex(lines, 'KEY SKILLS');
    const experience = lineIndex(lines, 'PROFESSIONAL EXPERIENCE');
    const education = lineIndex(lines, 'EDUCATION');
    const certifications = lineIndex(lines, 'CERTIFICATIONS');
    expect([name, summary, skills, experience, education, certifications]).toEqual(
      [name, summary, skills, experience, education, certifications].slice().sort((a, b) => a - b),
    );

    expect(lines[summary + 1]).toBe(CV.summary);
    expect(lines[skills + 1]).toBe('SQL, Python, IFRS 9');
    // Title, then `Company | Location | Dates`, then the bullets.
    expect(lines.slice(experience + 1, experience + 5)).toEqual([
      'Senior Credit Risk Analyst',
      'Lloyds Banking Group | London | 2019 – present',
      'Cut IFRS 9 model run time by 40%.',
      'Led a team of three analysts.',
    ]);
    // An empty part leaves no bare bar behind, exactly as the text render.
    expect(lines).toContain('Barclays | 2016 – 2019');
    expect(lines[education + 1]).toBe('BSc Mathematics, University of Manchester, 2016');
    expect(lines[certifications + 1]).toBe('FRM');
  });

  it('omits the name line when the app does not know the name, and never guesses one', async () => {
    const lines = documentText(await buildCvDocx(CV, null));

    expect(lines[0]).toBe('PROFESSIONAL SUMMARY');
    expect(lines).not.toContain('Steve Brady');
  });

  it('omits an empty section rather than rendering a bare heading', async () => {
    const lines = documentText(
      await buildCvDocx({ ...CV, key_skills: [], education: [], certifications: [] }, null),
    );

    expect(lines).not.toContain('KEY SKILLS');
    expect(lines).not.toContain('EDUCATION');
    expect(lines).not.toContain('CERTIFICATIONS');
    expect(lines).toContain('PROFESSIONAL EXPERIENCE');
  });

  it('negative: a CV with zero roles is still a document', async () => {
    const bytes = await buildCvDocx({ ...CV, experience: [] }, 'Steve Brady');

    const lines = documentText(bytes);
    expect(lines).not.toContain('PROFESSIONAL EXPERIENCE');
    expect(lines).toEqual([
      'Steve Brady',
      'PROFESSIONAL SUMMARY',
      CV.summary,
      'KEY SKILLS',
      'SQL, Python, IFRS 9',
      'EDUCATION',
      'BSc Mathematics, University of Manchester, 2016',
      'CERTIFICATIONS',
      'FRM',
    ]);
  });

  it('boundary: 200 bullets in one role all arrive, in order', async () => {
    const bullets = Array.from({ length: 200 }, (_, index) => `Achievement number ${index + 1}.`);
    const role = { ...CV.experience[0]!, bullets };

    const lines = documentText(await buildCvDocx({ ...CV, experience: [role] }, null));

    const first = lineIndex(lines, 'Achievement number 1.');
    expect(lines.slice(first, first + 200)).toEqual(bullets);
  });

  it('is ATS-safe: no table, no drawing, no text box, no second column', async () => {
    const xml = documentXml(await buildCvDocx(CV, 'Steve Brady'));

    for (const forbidden of FORBIDDEN_IN_BODY) {
      expect(xml).not.toContain(forbidden);
    }
    // A `<w:cols>` element with more than one column is a two-column layout.
    expect(xml).not.toMatch(/<w:cols[^>]*w:num="(?!1")/);
    // The bullets are a real Word list, which is what a parser reads as one.
    expect(xml).toContain('<w:numPr>');
  });

  it("negative: markup in the model's text is escaped, never injected", async () => {
    // A model reply — or a hostile advert echoed back through one — cannot
    // put a table into the document by writing a table's tag into a bullet.
    const role = { ...CV.experience[0]!, bullets: ['<w:tbl>R&D</w:tbl>'] };

    const xml = documentXml(await buildCvDocx({ ...CV, experience: [role] }, null));

    expect(xml).not.toContain('<w:tbl>');
    expect(xml).toContain('&lt;w:tbl&gt;R&amp;D&lt;/w:tbl&gt;');
  });
});

describe('buildCoverLetterDocx', () => {
  it('is a zip with a Word document inside', async () => {
    const bytes = await buildCoverLetterDocx(LETTER);

    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(unzip(bytes).has('word/document.xml')).toBe(true);
  });

  it('renders greeting, paragraphs and sign-off in order, a paragraph each', async () => {
    const lines = documentText(await buildCoverLetterDocx(LETTER));

    expect(lines).toEqual([
      'Dear Hiring Manager,',
      LETTER.paragraphs[0],
      LETTER.paragraphs[1],
      // A line break inside the sign-off stays a line break inside one
      // paragraph: the name sits under the valediction, not a blank line away.
      'Yours sincerely,Steve Brady',
    ]);
    expect(documentXml(await buildCoverLetterDocx(LETTER))).toContain('<w:br/>');
  });

  it('negative: a letter with no paragraphs is still greeting and sign-off', async () => {
    const lines = documentText(await buildCoverLetterDocx({ ...LETTER, paragraphs: [] }));

    expect(lines).toEqual(['Dear Hiring Manager,', 'Yours sincerely,Steve Brady']);
  });

  it('boundary: blank blocks are dropped rather than rendered as empty paragraphs', async () => {
    const lines = documentText(
      await buildCoverLetterDocx({ greeting: '  ', paragraphs: ['', 'Only this.'], sign_off: '' }),
    );

    expect(lines).toEqual(['Only this.']);
  });

  it('is ATS-safe: no table, no drawing, no text box', async () => {
    const xml = documentXml(await buildCoverLetterDocx(LETTER));

    for (const forbidden of FORBIDDEN_IN_BODY) {
      expect(xml).not.toContain(forbidden);
    }
  });
});
