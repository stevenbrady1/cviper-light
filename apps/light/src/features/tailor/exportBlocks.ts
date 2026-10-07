/**
 * What an exported CV or cover letter is made of, in order (L-165, L-201).
 *
 * The Word export (`docx.ts`) and the PDF export (`pdf.ts`) both draw THIS
 * list, so the two files a user can save always hold the same sections in
 * the same order: the name when the app knows it, PROFESSIONAL SUMMARY, KEY
 * SKILLS, PROFESSIONAL EXPERIENCE (title / `Company | Location | Dates` /
 * bullets), EDUCATION, CERTIFICATIONS — `MANDATORY_STRUCTURE`'s order, and
 * the same two rules as `renderTailoredCv`: an empty section is left out
 * rather than shown as a bare heading, and no name is ever guessed.
 */
import { type CoverLetter, type TailoredCv, type TailoredCvRole } from '@cviper/core-types';

export type ExportBlock =
  /** The candidate's name, at the top. */
  | { readonly kind: 'name'; readonly text: string }
  /** A section heading: `PROFESSIONAL SUMMARY` and its siblings. */
  | { readonly kind: 'heading'; readonly text: string }
  /** A paragraph. `bold` is for a role's title, and nothing else. */
  | { readonly kind: 'line'; readonly text: string; readonly bold?: boolean }
  /** One bullet of a role. */
  | { readonly kind: 'bullet'; readonly text: string }
  /** A paragraph whose line breaks are kept: a sign-off's name under its valediction. */
  | { readonly kind: 'block'; readonly text: string };

/**
 * `Company | Location | Dates`, with any empty part left out rather than left
 * as a bare bar. The same rule as `renderTailoredCv`'s `roleLine`.
 */
export function roleLine(role: TailoredCvRole): string {
  return [role.company, role.location, role.dates]
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' | ');
}

/** The tailored CV, in `MANDATORY_STRUCTURE`'s order. */
export function cvBlocks(cv: TailoredCv, name: string | null): ExportBlock[] {
  const blocks: ExportBlock[] = [];

  const trimmedName = name?.trim() ?? '';
  if (trimmedName !== '') blocks.push({ kind: 'name', text: trimmedName });

  blocks.push(
    { kind: 'heading', text: 'PROFESSIONAL SUMMARY' },
    { kind: 'line', text: cv.summary.trim() },
  );

  if (cv.key_skills.length > 0) {
    blocks.push(
      { kind: 'heading', text: 'KEY SKILLS' },
      { kind: 'line', text: cv.key_skills.join(', ') },
    );
  }

  if (cv.experience.length > 0) {
    blocks.push({ kind: 'heading', text: 'PROFESSIONAL EXPERIENCE' });
    for (const role of cv.experience) {
      blocks.push({ kind: 'line', text: role.title.trim(), bold: true });
      const header = roleLine(role);
      if (header !== '') blocks.push({ kind: 'line', text: header });
      for (const point of role.bullets) blocks.push({ kind: 'bullet', text: point.trim() });
    }
  }

  if (cv.education.length > 0) {
    blocks.push(
      { kind: 'heading', text: 'EDUCATION' },
      ...cv.education.map((entry): ExportBlock => ({ kind: 'line', text: entry.trim() })),
    );
  }

  if (cv.certifications.length > 0) {
    blocks.push(
      { kind: 'heading', text: 'CERTIFICATIONS' },
      ...cv.certifications.map((entry): ExportBlock => ({ kind: 'line', text: entry.trim() })),
    );
  }

  return blocks;
}

/** The cover letter: greeting, body, sign-off. Blank blocks are dropped. */
export function letterBlocks(letter: CoverLetter): ExportBlock[] {
  return [letter.greeting, ...letter.paragraphs, letter.sign_off]
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .map((text) => ({ kind: 'block', text }));
}
