/**
 * The tailored CV and the cover letter as a PDF (L-201).
 *
 * ============================================================================
 * BUILT HERE, ON THIS MACHINE, WITH NO LIBRARY AND NO FONT FILE.
 * ============================================================================
 * A text-only PDF is a few hundred lines of a well-documented format, so the
 * app writes it itself rather than ship a PDF library in the bundle. It uses
 * the two fonts every PDF reader must supply — Helvetica and Helvetica-Bold —
 * so nothing is embedded either: a CV is a few kilobytes, and the widths in
 * `helvetica.ts` are all this file needs to wrap lines. The bytes go to
 * `FilePort.saveBytes` exactly as the Word export's do.
 *
 * ============================================================================
 * ATS-SAFE, BY THE SAME RULES AS THE WORD EXPORT
 * ============================================================================
 * One column, the shared block list from `exportBlocks.ts` in its order, real
 * text in reading order — no images, no drawings, no links, no columns. Each
 * font carries a ToUnicode map, so every reader (and every applicant-tracking
 * system) turns the glyphs back into the same characters. `pdf.test.ts` reads
 * every file back with the app's own PDF reader and asserts the same words.
 *
 * ============================================================================
 * WHAT THE BUILT-IN FONTS CANNOT DRAW IS NAMED, NOT DROPPED
 * ============================================================================
 * The two fonts cover Latin-1 and most of Latin Extended-A — é, ł, ñ, ő, ș.
 * A character outside that set is drawn as its plain letter when it has one
 * (ạ as a) or as `?` when it has not (Cyrillic, Chinese, emoji), and is
 * returned in `missing` so the screen can say so and point at the Word file,
 * which keeps everything. Invisible characters (zero-width spaces, soft
 * hyphens) are dropped and odd spaces become spaces, which changes nothing a
 * reader can see.
 *
 * A single-byte PDF font has 256 codes. ASCII keeps its own codes; every
 * other character the document uses gets one of 128 codes from 128 up, and a
 * document that somehow uses more than 128 of them gets a second pair of
 * fonts for the next 128 — so no character is ever turned away for space.
 */
import { type CoverLetter, type TailoredCv } from '@cviper/core-types';

import { cvBlocks, letterBlocks, type ExportBlock } from './exportBlocks';
import { HELVETICA_GLYPHS, type HelveticaGlyph } from './helvetica';

/** A4, in points, with 2 cm margins all round. */
export const PAGE = { width: 595.28, height: 841.89, margin: 56.69 } as const;

/** How far a bullet's text sits in from the margin, and where its • goes. */
const BULLET_INDENT = 14;
const BULLET_MARK_AT = 3;

interface Style {
  readonly size: number;
  readonly leading: number;
  readonly bold: boolean;
  /** Space above the block, unless it starts a page. */
  readonly before: number;
  /** Space below the block. */
  readonly after: number;
  /** Lines of the blocks that follow that must fit on the page with this one. */
  readonly keepWithNext: number;
}

const BODY = { size: 11, leading: 14, bold: false, before: 0, keepWithNext: 0 } as const;

const STYLES: Record<ExportBlock['kind'], Style> = {
  name: { size: 16, leading: 20, bold: true, before: 0, after: 6, keepWithNext: 1 },
  heading: { size: 12, leading: 15, bold: true, before: 12, after: 4, keepWithNext: 3 },
  line: { ...BODY, after: 4 },
  bullet: { ...BODY, after: 2 },
  block: { ...BODY, after: 10 },
};

/**
 * A role's title: bold, with space above it to set each role apart, and kept
 * with its `Company | Location | Dates` line and first bullet.
 */
const ROLE_TITLE: Style = { ...BODY, bold: true, before: 8, after: 2, keepWithNext: 2 };

function styleOf(block: ExportBlock): Style {
  return block.kind === 'line' && block.bold === true ? ROLE_TITLE : STYLES[block.kind];
}

/** One line of text, placed: where it starts, its baseline, and how wide it is. */
export interface PlacedLine {
  readonly kind: ExportBlock['kind'];
  readonly text: string;
  readonly x: number;
  /** The baseline, in PDF space: points up from the bottom of the page. */
  readonly y: number;
  readonly width: number;
  readonly size: number;
  readonly bold: boolean;
  /** The first line of a bullet, which has its • drawn before it. */
  readonly bullet: boolean;
}

export interface BuiltPdf {
  readonly bytes: Uint8Array;
  /** Characters the built-in fonts could not draw, in order of first use. */
  readonly missing: readonly string[];
}

// ── Characters ──────────────────────────────────────────────────────────────

const GLYPHS = new Map<number, HelveticaGlyph>(HELVETICA_GLYPHS.map((glyph) => [glyph[0], glyph]));
const INVISIBLE = /^[\p{Cc}\p{Cf}]$/u;
const WHITESPACE = /^\s$/u;

function drawable(text: string): boolean {
  return [...text].every((char) => GLYPHS.has(char.codePointAt(0) ?? -1));
}

/**
 * The text as the fonts can draw it, one space between words. Anything they
 * cannot draw is added to `missing` and replaced (see the header).
 */
function clean(text: string, missing: Set<string>): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    if (GLYPHS.has(char.codePointAt(0) ?? -1)) out += char;
    else if (WHITESPACE.test(char)) out += ' ';
    else if (INVISIBLE.test(char)) continue;
    else {
      missing.add(char);
      const plain = char.normalize('NFKD').replace(/\p{M}/gu, '');
      out += plain !== '' && drawable(plain) ? plain : '?';
    }
  }
  return out.replace(/ +/g, ' ').trim();
}

function widthOf(text: string, style: Pick<Style, 'size' | 'bold'>): number {
  let units = 0;
  for (const char of text) {
    const glyph = GLYPHS.get(char.codePointAt(0) ?? -1);
    if (glyph !== undefined) units += style.bold ? glyph[3] : glyph[2];
  }
  return (units * style.size) / 1000;
}

/** A word too wide for any line, cut into pieces that each fit. */
function breakWord(word: string, room: number, style: Style): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const char of word) {
    if (piece !== '' && widthOf(piece + char, style) > room) {
      pieces.push(piece);
      piece = '';
    }
    piece += char;
  }
  if (piece !== '') pieces.push(piece);
  return pieces;
}

/** Greedy word wrap: as many words on each line as fit in `room`. */
function wrap(text: string, room: number, style: Style): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    for (const piece of widthOf(word, style) > room ? breakWord(word, room, style) : [word]) {
      const candidate = current === '' ? piece : `${current} ${piece}`;
      if (current !== '' && widthOf(candidate, style) > room) {
        lines.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

// ── Layout ──────────────────────────────────────────────────────────────────

/**
 * The blocks, wrapped and placed on as many A4 pages as they need. Exported
 * for the tests, which hold the one-column and margin rules to it.
 */
export function layoutBlocks(
  blocks: readonly ExportBlock[],
  missing: Set<string> = new Set(),
): PlacedLine[][] {
  const top = PAGE.height - PAGE.margin;
  const pages: PlacedLine[][] = [[]];
  let cursor = top;

  const wrapped = blocks.map((block) => {
    const style = styleOf(block);
    const indent = block.kind === 'bullet' ? BULLET_INDENT : 0;
    const room = PAGE.width - 2 * PAGE.margin - indent;
    const paragraphs = block.kind === 'block' ? block.text.split('\n') : [block.text];
    const lines = paragraphs.flatMap((part) => wrap(clean(part, missing), room, style));
    return { block, style, indent, lines };
  });

  wrapped.forEach(({ block, style, indent, lines }, index) => {
    if (lines.length === 0) return;
    const atTop = cursor === top;
    const before = atTop ? 0 : style.before;

    // A heading (or a name, or a role's title) never ends a page: the next
    // lines that belong under it — across the blocks that follow — must fit
    // too, or it moves to the next page.
    let kept = 0;
    let wanted = style.keepWithNext;
    for (const after of wrapped.slice(index + 1)) {
      if (wanted === 0) break;
      const take = Math.min(wanted, after.lines.length);
      if (take > 0) kept += after.style.before + take * after.style.leading;
      wanted -= take;
    }
    const needed = before + style.leading + kept;
    if (!atTop && cursor - needed < PAGE.margin) {
      pages.push([]);
      cursor = top;
    } else {
      cursor -= before;
    }

    lines.forEach((text, lineIndex) => {
      if (cursor - style.leading < PAGE.margin) {
        pages.push([]);
        cursor = top;
      }
      const baseline = cursor - style.size;
      pages.at(-1)?.push({
        kind: block.kind,
        text,
        x: PAGE.margin + indent,
        y: baseline,
        width: widthOf(text, style),
        size: style.size,
        bold: style.bold,
        bullet: block.kind === 'bullet' && lineIndex === 0,
      });
      cursor -= style.leading;
    });
    cursor -= style.after;
  });

  return pages;
}

// ── Encoding ────────────────────────────────────────────────────────────────

const FIRST_CODE = 32;
const LAST_CODE = 255;
const FIRST_EXTRA_CODE = 128;
const EXTRAS_PER_PLANE = LAST_CODE - FIRST_EXTRA_CODE + 1;
const BULLET_MARK = '•';

function isAscii(codePoint: number): boolean {
  return codePoint >= FIRST_CODE && codePoint <= 126;
}

/** Which font plane and byte code each non-ASCII character is drawn with. */
interface Encoding {
  readonly planes: number;
  readonly extras: Map<number, { readonly plane: number; readonly code: number }>;
}

function encodingFor(pages: readonly PlacedLine[][]): Encoding {
  const extras = new Map<number, { plane: number; code: number }>();
  const add = (char: string) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isAscii(codePoint) || extras.has(codePoint)) return;
    const index = extras.size;
    extras.set(codePoint, {
      plane: Math.floor(index / EXTRAS_PER_PLANE),
      code: FIRST_EXTRA_CODE + (index % EXTRAS_PER_PLANE),
    });
  };
  for (const line of pages.flat()) {
    if (line.bullet) add(BULLET_MARK);
    for (const char of line.text) add(char);
  }
  return { planes: Math.max(1, Math.ceil(extras.size / EXTRAS_PER_PLANE)), extras };
}

/** The glyph each code of one plane draws: ASCII as itself, then that plane's extras. */
function planeGlyphs(encoding: Encoding, plane: number): Map<number, HelveticaGlyph> {
  const byCode = new Map<number, HelveticaGlyph>();
  for (const glyph of HELVETICA_GLYPHS) {
    if (isAscii(glyph[0])) byCode.set(glyph[0], glyph);
  }
  for (const [codePoint, placed] of encoding.extras) {
    const glyph = GLYPHS.get(codePoint);
    if (placed.plane === plane && glyph !== undefined) byCode.set(placed.code, glyph);
  }
  return byCode;
}

const hex = (value: number, digits: number) =>
  value.toString(16).toUpperCase().padStart(digits, '0');

/** Text as runs of hex byte codes, split wherever the font plane changes. */
function runs(text: string, encoding: Encoding): { plane: number; codes: string }[] {
  const out: { plane: number; codes: string }[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    const placed = isAscii(codePoint)
      ? { plane: out.at(-1)?.plane ?? 0, code: codePoint }
      : encoding.extras.get(codePoint);
    if (placed === undefined) continue;
    const last = out.at(-1);
    if (last?.plane === placed.plane) last.codes += hex(placed.code, 2);
    else out.push({ plane: placed.plane, codes: hex(placed.code, 2) });
  }
  return out;
}

// ── Objects ─────────────────────────────────────────────────────────────────

const num = (value: number) => String(Math.round(value * 100) / 100);

function fontName(plane: number, bold: boolean): string {
  return `${bold ? 'B' : 'R'}${plane}`;
}

function contentStream(page: readonly PlacedLine[], encoding: Encoding): string {
  const out: string[] = [];
  for (const line of page) {
    out.push('BT');
    if (line.bullet) {
      // The • and a real space, so a reader that ignores position still
      // sees "• text" rather than "•text".
      out.push(`${num(PAGE.margin + BULLET_MARK_AT)} ${num(line.y)} Td`);
      for (const run of runs(`${BULLET_MARK} `, encoding)) {
        out.push(`/${fontName(run.plane, false)} ${num(line.size)} Tf <${run.codes}> Tj`);
      }
      out.push('ET', 'BT');
    }
    out.push(`${num(line.x)} ${num(line.y)} Td`);
    for (const run of runs(line.text, encoding)) {
      out.push(`/${fontName(run.plane, line.bold)} ${num(line.size)} Tf <${run.codes}> Tj`);
    }
    out.push('ET');
  }
  return `${out.join('\n')}\n`;
}

function differences(glyphs: Map<number, HelveticaGlyph>): string {
  const parts: string[] = [];
  let expected = -1;
  for (const [code, glyph] of [...glyphs].sort((a, b) => a[0] - b[0])) {
    if (code !== expected) parts.push(String(code));
    parts.push(`/${glyph[1]}`);
    expected = code + 1;
  }
  return parts.join(' ');
}

function widths(glyphs: Map<number, HelveticaGlyph>, bold: boolean): string {
  const out: number[] = [];
  for (let code = FIRST_CODE; code <= LAST_CODE; code += 1) {
    const glyph = glyphs.get(code);
    out.push(glyph === undefined ? 0 : bold ? glyph[3] : glyph[2]);
  }
  return out.join(' ');
}

/** The map a reader uses to turn each code back into its character. */
function toUnicode(glyphs: Map<number, HelveticaGlyph>): string {
  const entries = [...glyphs]
    .sort((a, b) => a[0] - b[0])
    .map(([code, glyph]) => `<${hex(code, 2)}> <${hex(glyph[0], 4)}>`);
  const chunks: string[] = [];
  // A bfchar block may hold at most 100 entries.
  for (let start = 0; start < entries.length; start += 100) {
    const chunk = entries.slice(start, start + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<00> <FF>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
    '',
  ].join('\n');
}

const stream = (body: string) => `<< /Length ${body.length} >>\nstream\n${body}endstream`;

/** A PDF text string for the document's title: UTF-16BE, so any character survives. */
function textString(text: string): string {
  let out = 'FEFF';
  for (let index = 0; index < text.length; index += 1) out += hex(text.charCodeAt(index), 4);
  return `<${out}>`;
}

/** Objects in order, numbered from 1, with the cross-reference table. */
function assemble(objects: readonly string[]): Uint8Array {
  // The second line is the four high bytes the format asks for, so a file
  // tool treats the file as binary.
  let file = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 3 0 R >>\n`;
  file += `startxref\n${xref}\n%%EOF\n`;

  // Every character above is ASCII or one of the four marker bytes, so each
  // is exactly one byte and the offsets counted in characters are bytes.
  return Uint8Array.from(file, (char) => char.charCodeAt(0));
}

/** The blocks as PDF bytes, and what the fonts could not draw. */
export function buildPdf(blocks: readonly ExportBlock[], title: string): BuiltPdf {
  const missing = new Set<string>();
  const pages = layoutBlocks(blocks, missing);
  const encoding = encodingFor(pages);

  // 1 catalog, 2 page tree, 3 info, then four objects per plane (encoding,
  // ToUnicode, regular, bold), then a page and its content for each page.
  const firstFont = 4;
  const firstPage = firstFont + encoding.planes * 4;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R /Lang (en-GB) >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${firstPage + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    `<< /Title ${textString(title)} /Creator (CViper Light) /Producer (CViper Light) >>`,
  ];

  const fontRefs: string[] = [];
  for (let plane = 0; plane < encoding.planes; plane += 1) {
    const glyphs = planeGlyphs(encoding, plane);
    const base = firstFont + plane * 4;
    objects.push(
      `<< /Type /Encoding /Differences [${differences(glyphs)}] >>`,
      stream(toUnicode(glyphs)),
    );
    for (const bold of [false, true]) {
      objects.push(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${bold ? 'Helvetica-Bold' : 'Helvetica'} ` +
          `/FirstChar ${FIRST_CODE} /LastChar ${LAST_CODE} /Widths [${widths(glyphs, bold)}] ` +
          `/Encoding ${base} 0 R /ToUnicode ${base + 1} 0 R >>`,
      );
      fontRefs.push(`/${fontName(plane, bold)} ${base + (bold ? 3 : 2)} 0 R`);
    }
  }

  pages.forEach((page, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
        `/Resources << /Font << ${fontRefs.join(' ')} >> >> ` +
        `/Contents ${firstPage + index * 2 + 1} 0 R >>`,
      stream(contentStream(page, encoding)),
    );
  });

  return { bytes: assemble(objects), missing: [...missing] };
}

/**
 * The tailored CV as a PDF. `name` is `null` when the app does not know the
 * candidate's name, and nothing here guesses one.
 */
export function buildCvPdf(cv: TailoredCv, name: string | null): BuiltPdf {
  return buildPdf(cvBlocks(cv, name), 'Tailored CV');
}

/** The cover letter as a PDF. */
export function buildCoverLetterPdf(letter: CoverLetter): BuiltPdf {
  return buildPdf(letterBlocks(letter), 'Cover letter');
}
