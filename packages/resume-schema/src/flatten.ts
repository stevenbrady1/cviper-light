/**
 * A JSON Resume as plain text, the way a CV reads on the page.
 *
 * ============================================================================
 * WHY TEXT
 * ============================================================================
 * Everything downstream of a CV in Light — the keyword match, the prompt to a
 * model, the analysis view — works on `cvs.extracted_text`, the same thing a
 * PDF or a .docx becomes. A JSON Resume is structured, which is nicer, but
 * flattening it to the same text is what makes it a CV here with no second
 * pipeline to maintain.
 *
 * ============================================================================
 * DETERMINISTIC
 * ============================================================================
 * Same résumé, same text, every time: sections in a fixed order, entries in
 * the order the file gives them, one format per section. A test can pin the
 * output, and a re-import produces a byte-identical CV row. Nothing here is
 * localised or dated.
 *
 * Empty strings and absent fields are simply not printed. A section with
 * nothing printable in it is skipped along with its heading.
 */
import type {
  Award,
  Basics,
  Certificate,
  Education,
  Interest,
  JsonResume,
  Language,
  Project,
  Publication,
  Reference,
  Skill,
  Volunteer,
  Work,
} from './schema';

/** ` · ` between the pieces of one line: email, phone, location. */
const SEPARATOR = ' · ';

/** ` – ` between a start and an end date. */
const DATE_DASH = ' – ';

/** Trim, and treat whitespace-only as absent. */
function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

function cleanList(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => clean(value))
    .filter((value): value is string => value !== null);
}

/** The non-empty pieces of a line, joined. `null` when there are none. */
function joinPieces(pieces: readonly (string | null)[], separator: string): string | null {
  const present = pieces.filter((piece): piece is string => piece !== null);
  return present.length === 0 ? null : present.join(separator);
}

/** `2019-03 – 2021-06`, `2019-03 – Present`, `2019-03`, or nothing. */
function dateRange(start: string | undefined, end: string | undefined): string | null {
  const from = clean(start);
  const to = clean(end);
  if (from === null && to === null) return null;
  if (from === null) return to;
  return `${from}${DATE_DASH}${to ?? 'Present'}`;
}

/** `Title (dates)` — the dates in brackets when there are any. */
function titled(title: string | null, dates: string | null): string | null {
  if (title === null) return dates;
  return dates === null ? title : `${title} (${dates})`;
}

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

/** `Label: a, b, c` — or nothing when the list is empty. */
function labelledList(label: string, items: readonly string[]): string | null {
  return items.length === 0 ? null : `${label}: ${items.join(', ')}`;
}

/** The lines of one entry, empties dropped. */
type Lines = (string | null)[];

function compact(lines: Lines): string[] {
  return lines.filter((line): line is string => line !== null);
}

// ── Sections ─────────────────────────────────────────────────────────────────

function basicsLines(basics: Basics | undefined): string[] {
  if (basics === undefined) return [];
  const location = basics.location;
  const place = joinPieces(
    [
      clean(location?.address),
      clean(location?.city),
      clean(location?.region),
      clean(location?.postalCode),
      clean(location?.countryCode),
    ],
    ', ',
  );
  const profiles = (basics.profiles ?? [])
    .map((profile) =>
      joinPieces(
        [joinPieces([clean(profile.network), clean(profile.username)], ': '), clean(profile.url)],
        ' ',
      ),
    )
    .filter((line): line is string => line !== null);

  return compact([
    clean(basics.name),
    clean(basics.label),
    joinPieces([clean(basics.email), clean(basics.phone), clean(basics.url), place], SEPARATOR),
    ...profiles,
  ]);
}

function summaryLines(basics: Basics | undefined): string[] {
  return compact([clean(basics?.summary)]);
}

function workEntry(entry: Work): string[] {
  const role = joinPieces([clean(entry.position), clean(entry.name)], ', ');
  return compact([
    titled(role, dateRange(entry.startDate, entry.endDate)),
    clean(entry.location),
    clean(entry.description),
    clean(entry.summary),
    ...bullets(cleanList(entry.highlights)),
  ]);
}

function volunteerEntry(entry: Volunteer): string[] {
  const role = joinPieces([clean(entry.position), clean(entry.organization)], ', ');
  return compact([
    titled(role, dateRange(entry.startDate, entry.endDate)),
    clean(entry.summary),
    ...bullets(cleanList(entry.highlights)),
  ]);
}

function educationEntry(entry: Education): string[] {
  const qualification = joinPieces([clean(entry.studyType), clean(entry.area)], ' ');
  const where = joinPieces([qualification, clean(entry.institution)], ', ');
  const score = clean(entry.score);
  return compact([
    titled(where, dateRange(entry.startDate, entry.endDate)),
    score === null ? null : `Grade: ${score}`,
    labelledList('Courses', cleanList(entry.courses)),
  ]);
}

function awardEntry(entry: Award): string[] {
  const what = joinPieces([clean(entry.title), clean(entry.awarder)], ', ');
  return compact([titled(what, clean(entry.date)), clean(entry.summary)]);
}

function certificateEntry(entry: Certificate): string[] {
  const what = joinPieces([clean(entry.name), clean(entry.issuer)], ', ');
  return compact([titled(what, clean(entry.date))]);
}

function publicationEntry(entry: Publication): string[] {
  const what = joinPieces([clean(entry.name), clean(entry.publisher)], ', ');
  return compact([titled(what, clean(entry.releaseDate)), clean(entry.summary)]);
}

function skillEntry(entry: Skill): string[] {
  const name = clean(entry.name);
  const level = clean(entry.level);
  const head = name === null ? level : level === null ? name : `${name} (${level})`;
  const keywords = cleanList(entry.keywords);
  if (head === null) return keywords.length === 0 ? [] : [keywords.join(', ')];
  return [keywords.length === 0 ? head : `${head}: ${keywords.join(', ')}`];
}

function languageEntry(entry: Language): string[] {
  const language = clean(entry.language);
  const fluency = clean(entry.fluency);
  if (language === null) return compact([fluency]);
  return [fluency === null ? language : `${language} (${fluency})`];
}

function interestEntry(entry: Interest): string[] {
  const name = clean(entry.name);
  const keywords = cleanList(entry.keywords);
  if (name === null) return keywords.length === 0 ? [] : [keywords.join(', ')];
  return [keywords.length === 0 ? name : `${name}: ${keywords.join(', ')}`];
}

function referenceEntry(entry: Reference): string[] {
  const name = clean(entry.name);
  const reference = clean(entry.reference);
  if (name === null) return compact([reference]);
  return [reference === null ? name : `${name}: ${reference}`];
}

function projectEntry(entry: Project): string[] {
  const roles = cleanList(entry.roles);
  const what = joinPieces([clean(entry.name), clean(entry.entity)], ', ');
  return compact([
    titled(what, dateRange(entry.startDate, entry.endDate)),
    labelledList('Role', roles),
    clean(entry.type),
    clean(entry.description),
    ...bullets(cleanList(entry.highlights)),
    labelledList('Keywords', cleanList(entry.keywords)),
  ]);
}

// ── Assembly ─────────────────────────────────────────────────────────────────

interface Section {
  readonly heading: string | null;
  /** Each entry's lines. Entries are separated by one blank line. */
  readonly entries: readonly (readonly string[])[];
}

function listSection<T>(
  heading: string,
  entries: readonly T[] | undefined,
  render: (entry: T) => string[],
): Section {
  return { heading, entries: (entries ?? []).map(render) };
}

/** Sections in the order a reader expects them, one-line entries grouped tight. */
function sections(resume: JsonResume): Section[] {
  return [
    { heading: null, entries: [basicsLines(resume.basics)] },
    { heading: 'Summary', entries: [summaryLines(resume.basics)] },
    listSection('Experience', resume.work, workEntry),
    listSection('Volunteering', resume.volunteer, volunteerEntry),
    listSection('Education', resume.education, educationEntry),
    listSection('Projects', resume.projects, projectEntry),
    { heading: 'Skills', entries: [(resume.skills ?? []).flatMap(skillEntry)] },
    { heading: 'Languages', entries: [(resume.languages ?? []).flatMap(languageEntry)] },
    listSection('Certificates', resume.certificates, certificateEntry),
    listSection('Awards', resume.awards, awardEntry),
    listSection('Publications', resume.publications, publicationEntry),
    { heading: 'Interests', entries: [(resume.interests ?? []).flatMap(interestEntry)] },
    listSection('References', resume.references, referenceEntry),
  ];
}

/**
 * Render a résumé as text. Returns `''` for a résumé with nothing in it.
 *
 * Lines are separated by `\n`, entries by one blank line, sections by one
 * blank line before their heading. There is no trailing newline.
 */
export function flattenJsonResume(resume: JsonResume): string {
  const blocks: string[] = [];
  for (const section of sections(resume)) {
    const entries = section.entries.filter((lines) => lines.length > 0);
    if (entries.length === 0) continue;
    const body = entries.map((lines) => lines.join('\n')).join('\n\n');
    blocks.push(section.heading === null ? body : `${section.heading}\n${body}`);
  }
  return blocks.join('\n\n');
}
