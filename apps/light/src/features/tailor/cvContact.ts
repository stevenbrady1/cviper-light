/**
 * The name, email and phone at the top of a saved CV (L-346).
 *
 * ============================================================================
 * A SUGGESTION THE USER CONFIRMS, AND BLANK WHEN UNSURE
 * ============================================================================
 * The model is never asked for the candidate's details: a name is the easiest
 * thing in a CV to get subtly wrong and the hardest to check (see
 * `renderTailoredCv`). So this reads them out of the CV the user uploaded,
 * offers them in a dialog, and the user's confirmed values are what is saved.
 *
 * Every rule below leans towards a BLANK field. A blank costs the user one
 * line of typing; a wrong name on a CV costs them the application. No AI, no
 * filename and no email address is ever turned into a name, and every value
 * returned is a piece of the CV's own text, character for character.
 *
 * ============================================================================
 * WHERE IT LOOKS
 * ============================================================================
 *   - A stored JSON Resume: `basics` only, and each value only if it still
 *     appears in `extracted_text` — a correction (L-218) that removed it wins.
 *   - Otherwise the text's header: the first `HEADER_LINES` non-blank lines,
 *     stopping at the first section heading, so a referee's details further
 *     down are never read. Exactly one distinct email and one distinct phone,
 *     or that field stays blank.
 */
import { renderTailoredCv, type Cv, type TailoredCv } from '@cviper/core-types';

export interface CvContact {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
}

export const NO_CONTACT: CvContact = { name: '', email: '', phone: '' };

/** How far down the CV the header can reach, in non-blank lines. */
export const HEADER_LINES = 15;

/**
 * The longest line searched for an email or a phone. A contact line is short;
 * a longer one is a paragraph (or a whole CV a PDF gave back as one line), and
 * the email pattern below backtracks in time that grows with the square of
 * its input (CodeQL js/polynomial-redos), so it is never given more than this.
 */
export const SCANNED_LINE_MAX = 300;

/**
 * COPIED FROM `packages/ats-checks/src/checks.ts` (`EMAIL_RE`), with the
 * global flag added to find every candidate. Copied, not imported: that
 * package is pinned to the web app's Python by `parity.test.ts`, and this is
 * not one of its checks. Using the same pattern means an email found here is
 * one the ATS Score step's contact check also sees.
 */
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gu;

/** A run that could be a phone number: digits with spaces, dots, dashes or brackets between. */
const PHONE_RUN = /[+(]?\d[\d \t\u00a0().-]*\d/gu;
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 15;
/** "Tel", "Mobile", "M:" and friends, right before the number. */
const PHONE_LABELS: ReadonlySet<string> = new Set([
  'tel',
  'telephone',
  'phone',
  'mobile',
  'mob',
  'cell',
  'ph',
  't',
  'm',
]);

const SPACE = /^\s$/u;
const LETTER = /^\p{L}$/u;

/**
 * Where `chars[0..end)` would end with every trailing character that passes
 * `test` taken off. One pass backwards: the `[…]+$` and `\s*:?\s*$` patterns
 * this replaces retried from every position in a run (CodeQL
 * js/polynomial-redos), which a long run in a user's CV made quadratic.
 */
function endWithout(chars: readonly string[], end: number, test: (char: string) => boolean) {
  let at = end;
  while (at > 0 && test(chars[at - 1] ?? '')) at -= 1;
  return at;
}

/** `text` with every trailing character that passes `test` removed. */
function trimEndWhere(text: string, test: (char: string) => boolean): string {
  const chars = Array.from(text);
  return chars.slice(0, endWithout(chars, chars.length, test)).join('');
}

/**
 * Whether `prefix` ends in a phone label: a whole word from `PHONE_LABELS`,
 * any case, then an optional `.`, spaces, an optional `:` and spaces. What
 * `/(?:^|[^\p{L}])(?:tel|…|m)\.?\s*:?\s*$/iu` matched, in one pass.
 */
function endsWithPhoneLabel(prefix: string): boolean {
  const chars = Array.from(prefix);
  const isSpace = (char: string) => SPACE.test(char);
  let end = endWithout(chars, chars.length, isSpace);
  if (chars[end - 1] === ':') end = endWithout(chars, end - 1, isSpace);
  if (chars[end - 1] === '.') end -= 1;
  // The label is the whole run of letters before that: never the tail of a
  // longer word ("Hotel", "Item").
  const start = endWithout(chars, end, (char) => LETTER.test(char));
  return PHONE_LABELS.has(chars.slice(start, end).join('').toLowerCase());
}

/** Whole-line section headings. "Contact details" is not one: it sits in the header. */
const SECTION_HEADINGS: ReadonlySet<string> = new Set([
  'profile',
  'personal profile',
  'professional profile',
  'career profile',
  'summary',
  'professional summary',
  'career summary',
  'executive summary',
  'personal statement',
  'about me',
  'objective',
  'career objective',
  'experience',
  'work experience',
  'professional experience',
  'relevant experience',
  'employment',
  'employment history',
  'work history',
  'career history',
  'education',
  'education and training',
  'qualifications',
  'skills',
  'key skills',
  'technical skills',
  'core skills',
  'core competencies',
  'competencies',
  'certifications',
  'certificates',
  'projects',
  'achievements',
  'key achievements',
  'references',
  'referees',
  'interests',
  'hobbies',
  'hobbies and interests',
  'languages',
  'volunteering',
  'volunteer experience',
  'publications',
  'awards',
  'training',
]);

/** A title line above the name. */
const CV_TITLE = /^(?:cv|curriculum vitae|resume|résumé)$/iu;

/**
 * Words that mean a line is a heading or a job title, not a name. Surnames
 * that are also trades (Smith, Taylor, Baker) are deliberately absent.
 */
const NOT_NAME_WORDS: ReadonlySet<string> = new Set([
  // Headings.
  'profile',
  'personal',
  'professional',
  'career',
  'summary',
  'statement',
  'objective',
  'experience',
  'employment',
  'history',
  'education',
  'qualifications',
  'skills',
  'competencies',
  'certifications',
  'certificates',
  'projects',
  'achievements',
  'references',
  'referees',
  'interests',
  'hobbies',
  'languages',
  'volunteering',
  'publications',
  'awards',
  'training',
  'contact',
  'details',
  'information',
  'curriculum',
  'vitae',
  'resume',
  'résumé',
  'cv',
  // Job titles.
  'manager',
  'engineer',
  'developer',
  'analyst',
  'consultant',
  'director',
  'officer',
  'assistant',
  'specialist',
  'designer',
  'teacher',
  'nurse',
  'accountant',
  'administrator',
  'executive',
  'coordinator',
  'lead',
  'head',
  'senior',
  'junior',
  'graduate',
  'intern',
  'trainee',
  'apprentice',
  'technician',
  'architect',
  'scientist',
  'advisor',
  'adviser',
  'associate',
  'supervisor',
  'operator',
  'clerk',
  'programmer',
  'researcher',
  'lecturer',
  'professor',
  'president',
  'founder',
  'chief',
  'ceo',
  'cto',
  'cfo',
  'coo',
  'chef',
  'driver',
  'worker',
  'representative',
  'receptionist',
  'secretary',
  'editor',
  'writer',
  'recruiter',
  'student',
  'freelance',
  'freelancer',
  'contractor',
  'tutor',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headingKey(line: string): string {
  const lower = line.toLowerCase().replace(/&/gu, 'and');
  return trimEndWhere(lower, (char) => char === ':' || SPACE.test(char))
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The header: the first non-blank lines, up to (not including) the first section heading. */
function headerLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, HEADER_LINES);
  const heading = lines.findIndex((line) => SECTION_HEADINGS.has(headingKey(line)));
  return heading === -1 ? lines : lines.slice(0, heading);
}

/** The one value whose `key` is shared by every candidate, or blank. */
function onlyOne(candidates: readonly string[], key: (value: string) => string): string {
  const distinct = new Set(candidates.map(key));
  return distinct.size === 1 ? (candidates[0] ?? '') : '';
}

/** The header lines short enough to search (`SCANNED_LINE_MAX`). */
function scanned(lines: readonly string[]): string[] {
  return lines.filter((line) => line.length <= SCANNED_LINE_MAX);
}

function emailIn(lines: readonly string[]): string {
  const found = scanned(lines).flatMap((line) => line.match(EMAIL) ?? []);
  return onlyOne(found, (email) => email.toLowerCase());
}

function phoneIn(lines: readonly string[]): string {
  const found: string[] = [];
  for (const line of scanned(lines)) {
    for (const match of line.matchAll(PHONE_RUN)) {
      const value = match[0];
      const digits = value.replace(/\D/gu, '').length;
      if (digits < PHONE_MIN_DIGITS || digits > PHONE_MAX_DIGITS) continue;
      const starts = value.startsWith('+') || value.startsWith('0') || value.startsWith('(');
      if (!starts && !endsWithPhoneLabel(line.slice(0, match.index))) continue;
      found.push(value);
    }
  }
  return onlyOne(found, (phone) => phone.replace(/\D/gu, ''));
}

function looksLikeName(candidate: string): boolean {
  if (candidate === '' || /[\p{Nd}@:：,/]/u.test(candidate)) return false;
  const words = candidate.split(/\s+/u);
  if (words.length > 4 || !words.every((word) => /\p{L}/u.test(word))) return false;
  // One word is a name only in a script with no capitals (Chinese, Japanese,
  // Korean, Arabic…), where a full name is often written without a space.
  if (words.length === 1 && /[\p{Lu}\p{Ll}\p{Lt}]/u.test(candidate)) return false;
  return !words.some((word) => NOT_NAME_WORDS.has(word.toLowerCase().replace(/[^\p{L}]/gu, '')));
}

function nameIn(lines: readonly string[]): string {
  const first = lines[0] ?? '';
  const title = trimEndWhere(first, (char) => char === '.' || char === ':' || SPACE.test(char));
  const line = CV_TITLE.test(title) ? (lines[1] ?? '') : first;
  const candidate = (line.split(/[|•]/u)[0] ?? '').trim();
  return looksLikeName(candidate) ? candidate : '';
}

/** `basics` from a stored JSON Resume, each value only if the text still has it. */
function fromJsonResume(jsonResume: string | null, text: string): Partial<CvContact> {
  if (jsonResume === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonResume);
  } catch {
    // An unreadable stored resume is not an error here: the text is read instead.
    return {};
  }
  const basics = isRecord(parsed) ? parsed['basics'] : undefined;
  if (!isRecord(basics)) return {};
  const found: { name?: string; email?: string; phone?: string } = {};
  for (const field of ['name', 'email', 'phone'] as const) {
    const value = basics[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '' && text.includes(trimmed)) found[field] = trimmed;
  }
  return found;
}

/** The details to offer for this CV. Blank fields mean "not found", never "guessed". */
export function detectCvContact(cv: Pick<Cv, 'extracted_text' | 'json_resume'> | null): CvContact {
  const text = cv?.extracted_text ?? '';
  if (cv === null || text.trim() === '') return NO_CONTACT;
  const fromJson = fromJsonResume(cv.json_resume, text);
  const header = headerLines(text);
  return {
    name: fromJson.name ?? nameIn(header),
    email: fromJson.email ?? emailIn(header),
    phone: fromJson.phone ?? phoneIn(header),
  };
}

/** Stored details, if they are details: three strings, or nothing. */
export function contactFrom(value: unknown): CvContact | null {
  if (!isRecord(value)) return null;
  const { name, email, phone } = value;
  if (typeof name !== 'string' || typeof email !== 'string' || typeof phone !== 'string') {
    return null;
  }
  return { name, email, phone };
}

function present(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value !== '');
}

/** The line under the name: `email | phone`, a blank one left out, or `null` for none. */
export function contactLine(contact: CvContact): string | null {
  const parts = present([contact.email, contact.phone]);
  return parts.length === 0 ? null : parts.join(' | ');
}

/** Everything that will go at the top, on one line, for the screen to show. */
export function contactSummary(contact: CvContact): string {
  return present([contact.name, contact.email, contact.phone]).join(' | ');
}

/**
 * The name and the line under it, from the details the user CONFIRMED: what
 * every saved CV file carries at the top, and what the page on screen draws
 * (L-400) — one helper, so the two cannot disagree. No details, or a blank
 * field, is no name or no line; nothing is ever filled in from elsewhere.
 */
export function cvHeader(contact: CvContact | null): {
  readonly name: string | null;
  readonly line: string | null;
} {
  if (contact === null) return { name: null, line: null };
  const name = contact.name.trim();
  return { name: name === '' ? null : name, line: contactLine(contact) };
}

/**
 * The CV text as it will be SAVED: the draft with the confirmed details on
 * top. No details, or all blank, is the draft text exactly as it was.
 */
export function savedCvText(
  result: { readonly cv: TailoredCv; readonly text: string },
  contact: CvContact | null,
): string {
  if (contact === null || contactSummary(contact) === '') return result.text;
  const { name, line } = cvHeader(contact);
  return renderTailoredCv(result.cv, name, line);
}
