/**
 * Read a candidate profile out of an ai-job-search workspace (L-167).
 *
 * ai-job-search is a job-hunt framework that keeps its candidate profile in
 * Markdown: a `CLAUDE.md` at the top of the folder and three skill files
 * under `.claude/skills/job-application-assistant/`. Somebody who has spent
 * weeks filling those in should not have to type it all again here. Rust
 * reads the four files (`pick_and_read_profile_workspace`); this module turns
 * their text into the fields the Profile view has boxes for, and nothing else.
 *
 * ============================================================================
 * WHAT IS NOT IMPORTED, AND WHY
 * ============================================================================
 * The framework's files hold a name, an address, a phone number, an email, a
 * LinkedIn URL, an education history and a work history. NONE of it is read.
 * The profile does not store contact details — it holds what a CV does not
 * say — and an importer is the wrong place to start: a field that exists
 * because a parser found something to put in it is a field nobody decided
 * the app should have. Every rule below names the section it reads, and a
 * section not named here is not read.
 *
 * `writing_style` is in the `ImportedProfile` type because it is a profile
 * field, and is never set: the framework describes how the candidate writes
 * in `03-writing-style.md`, which Rust does not read. The notes say so.
 *
 * ============================================================================
 * A PLACEHOLDER IS NOT A VALUE
 * ============================================================================
 * A freshly cloned workspace still has every `[PLACEHOLDER]` token in place:
 * `[YOUR_LINKEDIN_HEADLINE]`, `[SECTOR_1]: [EXAMPLE_COMPANIES]`, a language
 * called `[LANGUAGE]`. Anything that carries such a token, or is nothing but
 * a bracketed phrase, is skipped — never imported as text, never "cleaned".
 * The pristine template must import NOTHING, and the test says so.
 *
 * ============================================================================
 * PURE, AND FORGIVING
 * ============================================================================
 * No I/O, no React, no Markdown library: the shapes are a handful of headings,
 * bullet lists, one kind of table and one kind of block, and a real parser
 * would be more code than these rules. Every rule is lenient about the
 * markup — `**S:**` and `Situation:` both work, tables may be indented, a
 * list may be inline after a colon or bulleted under it — and strict about
 * the value: trimmed, non-empty, not a placeholder. What could not be read is
 * reported in `notes`, so the review panel can show it rather than lose it.
 */
import { type Profile, type ProfileLanguage, type StarExample } from '@cviper/core-types';

import { type WorkspaceFiles } from '../../platform/files';

/** The fields this importer can fill. Each is absent when nothing was found. */
export type ImportedProfile = Partial<
  Pick<
    Profile,
    | 'headline'
    | 'languages'
    | 'work_rights'
    | 'deal_breakers'
    | 'target_sectors'
    | 'career_goals'
    | 'energising'
    | 'draining'
    | 'writing_style'
    | 'star_examples'
  >
> & {
  /** What was found and what was skipped, one sentence each, for the review panel. */
  readonly notes: string[];
};

/** The four files, by the name the user would recognise. */
const FILE_NAMES: Record<keyof WorkspaceFiles, string> = {
  claude_md: 'CLAUDE.md',
  candidate_profile: '01-candidate-profile.md',
  job_evaluation: '04-job-evaluation.md',
  interview_prep: '07-interview-prep.md',
};

// --- Placeholders -----------------------------------------------------------

/**
 * A `[PLACEHOLDER]` token as the framework writes them: upper-case words,
 * digits (`[SECTOR_1]`), and the handful of punctuation its templates use
 * (`[LEVEL, e.g. ...]` is caught by `WHOLLY_BRACKETED` instead).
 */
const PLACEHOLDER_TOKEN = /\[[A-Z0-9_ ,./"()-]+\]/;

/** A value that is nothing but one bracketed phrase, whatever its case. */
const WHOLLY_BRACKETED = /^\[[^\]]*\]$/;

/** `true` when the value is the template's, not the candidate's. */
export function isPlaceholder(value: string): boolean {
  const text = value.trim();
  return text === '' || WHOLLY_BRACKETED.test(text) || PLACEHOLDER_TOKEN.test(text);
}

// --- Markdown, just enough --------------------------------------------------

/** Strip HTML comments — the template's instructions to the user, not values. */
function withoutComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

/** Strip emphasis and code markers, and surrounding quotes, from one value. */
function clean(value: string): string {
  return value
    .replace(/\*\*|__|`/g, '')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;

/**
 * The lines under a heading whose text is `title` (case-insensitive), up to
 * the next heading of the same or a higher level. Empty when there is none.
 */
function sectionLines(markdown: string, title: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const wanted = title.toLowerCase();
  const out: string[] = [];
  let level: number | null = null;

  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading !== undefined && heading !== null) {
      const depth = heading[1]?.length ?? 0;
      const text = clean(heading[2] ?? '').toLowerCase();
      if (level === null) {
        if (text === wanted) level = depth;
        continue;
      }
      if (depth <= level) break;
    }
    if (level !== null) out.push(line);
  }

  return out;
}

/** The bullet items in some lines, cleaned, placeholders and blanks dropped. */
function bulletsIn(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    if (bullet === null) continue;
    const value = clean(bullet[1] ?? '');
    if (!isPlaceholder(value)) out.push(value);
  }
  return out;
}

/** How far a line is indented, in characters. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The bullets directly under a line that matches `marker`: the line's own
 * text after the marker if it has any (an inline list, split on commas), else
 * the bullet lines that follow until something that is not a bullet.
 *
 * When the marker line is ITSELF a bullet (`- Tasks that drain:`), only the
 * bullets nested under it belong to it: the next bullet at the same indent
 * (`- Non-task factors: ...`) is its sibling, not its content.
 */
function listAfter(markdown: string, marker: RegExp): string[] {
  const lines = markdown.split(/\r?\n/);
  for (let at = 0; at < lines.length; at += 1) {
    const markerLine = lines[at] ?? '';
    const match = marker.exec(markerLine);
    if (match === null) continue;

    const inline = clean(match[1] ?? '');
    if (inline !== '') {
      if (isPlaceholder(inline)) return [];
      return inline
        .split(/[,;]/)
        .map((item) => clean(item))
        .filter((item) => item !== '' && !isPlaceholder(item));
    }

    const nestedOnly = BULLET.test(markerLine);
    const following: string[] = [];
    for (let next = at + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? '';
      if (line.trim() === '') continue;
      if (!BULLET.test(line)) break;
      if (nestedOnly && indentOf(line) <= indentOf(markerLine)) break;
      following.push(line);
    }
    return bulletsIn(following);
  }
  return [];
}

// --- Languages --------------------------------------------------------------

/** Split one Markdown table row into its cells. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => clean(cell));
}

const SEPARATOR_ROW = /^\s*\|?[\s:|-]+\|?\s*$/;

interface LanguageScan {
  readonly found: ProfileLanguage[];
  readonly skippedRows: number;
}

/**
 * Every `| Language | Level |` table in the text. Extra columns (the skill
 * file adds `Notes`) are ignored; a row with fewer than two cells, an empty
 * name, or a placeholder in either cell is skipped and counted.
 */
function languagesIn(markdown: string): LanguageScan {
  const lines = markdown.split(/\r?\n/);
  const found: ProfileLanguage[] = [];
  let skippedRows = 0;
  let inTable = false;

  for (const line of lines) {
    const cells = cellsOf(line);
    if (cells.length === 0) {
      inTable = false;
      continue;
    }
    if (!inTable) {
      inTable = cells[0]?.toLowerCase() === 'language' && cells[1]?.toLowerCase() === 'level';
      continue;
    }
    if (SEPARATOR_ROW.test(line)) continue;

    const name = cells[0] ?? '';
    const level = cells[1];
    if (cells.length < 2 || name === '' || level === undefined) {
      skippedRows += 1;
      continue;
    }
    if (isPlaceholder(name) || isPlaceholder(level)) {
      // The template's own row, or a half-filled one. Not a value either way.
      if (!(WHOLLY_BRACKETED.test(name) && WHOLLY_BRACKETED.test(level))) skippedRows += 1;
      continue;
    }
    found.push({ name, level });
  }

  return { found, skippedRows };
}

// --- STAR examples ----------------------------------------------------------

const STAR_TITLE = /^###\s+\d+\.\s+(.+?)\s*$/;

/**
 * One line of a STAR block, in any of the three spellings the framework and
 * its users write: `**S:** text`, `**Situation:** text`, `**Situation**:
 * text`, `Situation: text`, `S: text`. `\b` after the word keeps `Something:`
 * from reading as an `S` line.
 */
const STAR_PART =
  /^\s*(?:-\s+)?(?:\*\*(situation|task|action|result|s|t|a|r)\b\s*:\*\*|\*\*(situation|task|action|result|s|t|a|r)\*\*\s*:|(situation|task|action|result|s|t|a|r)\b\s*:)\s*(.*)$/i;

const STAR_KEYS: Record<string, keyof Omit<StarExample, 'title'>> = {
  s: 'situation',
  situation: 'situation',
  t: 'task',
  task: 'task',
  a: 'action',
  action: 'action',
  r: 'result',
  result: 'result',
};

const STAR_LABELS: Record<keyof Omit<StarExample, 'title'>, string> = {
  situation: 'Situation',
  task: 'Task',
  action: 'Action',
  result: 'Result',
};

interface StarScan {
  readonly found: StarExample[];
  readonly skipped: string[];
}

/**
 * Every `### N. Title (Skill)` block, with its four parts. A block whose title
 * is a placeholder is the template's and is skipped silently; one with a real
 * title but a missing or placeholder part is skipped with a note naming the
 * part, so the user can see what to finish by hand.
 */
function starExamplesIn(markdown: string): StarScan {
  const lines = markdown.split(/\r?\n/);
  const found: StarExample[] = [];
  const skipped: string[] = [];

  let title: string | null = null;
  let parts: Partial<Record<keyof Omit<StarExample, 'title'>, string>> = {};
  let current: keyof Omit<StarExample, 'title'> | null = null;

  const finish = (): void => {
    if (title === null) return;
    const missing = (Object.keys(STAR_LABELS) as Array<keyof typeof STAR_LABELS>).filter(
      (key) => parts[key] === undefined || isPlaceholder(parts[key] ?? ''),
    );
    if (missing.length === 0) {
      found.push({
        title,
        situation: parts.situation ?? '',
        task: parts.task ?? '',
        action: parts.action ?? '',
        result: parts.result ?? '',
      });
    } else {
      skipped.push(
        `STAR example "${title}" was skipped: no ${missing.map((key) => STAR_LABELS[key]).join(', ')} line.`,
      );
    }
    title = null;
    parts = {};
    current = null;
  };

  for (const line of lines) {
    const heading = STAR_TITLE.exec(line);
    if (heading !== null) {
      finish();
      const text = clean(heading[1] ?? '');
      title = isPlaceholder(text) ? null : text;
      continue;
    }
    if (HEADING.test(line)) {
      finish();
      continue;
    }
    if (title === null) continue;

    const part = STAR_PART.exec(line);
    if (part !== null) {
      const key = STAR_KEYS[(part[1] ?? part[2] ?? part[3] ?? '').toLowerCase()];
      if (key === undefined) continue;
      current = key;
      parts[key] = clean(part[4] ?? '');
      continue;
    }
    // A continuation line of the part above. `Use for:` is the framework's
    // own cross-reference and is not part of the example.
    if (current !== null && line.trim() !== '' && !/^\s*\*{0,2}use for/i.test(line)) {
      parts[current] = `${parts[current] ?? ''} ${clean(line)}`.trim();
    }
  }
  finish();

  return { found, skipped };
}

// --- Scalars ----------------------------------------------------------------

const HEADLINE_LINE = /linkedin headline:\**\s*(.+)$/i;
const RIGHTS_LINE = /^\s*[-*+]?\s*\*{0,2}(?:status|constraints)\s*:?\*{0,2}\s*:?\s*(.+)$/i;
const RIGHTS_WORDS = /\bvisa\b|sponsor|right to work|citizen|permit|\bresiden(?:t|cy)\b/i;

/** The LinkedIn headline, quotes stripped, or `null`. */
function headlineIn(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = HEADLINE_LINE.exec(line);
    if (match === null) continue;
    const value = clean(match[1] ?? '');
    if (!isPlaceholder(value)) return value;
  }
  return null;
}

/**
 * `Status:` and `Constraints:` lines that actually talk about the right to
 * work — a visa, sponsorship, citizenship, a permit. "Employed, looking" is a
 * status, not a right.
 */
function workRightsIn(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = RIGHTS_LINE.exec(line);
    if (match === null) continue;
    const value = clean(match[1] ?? '');
    if (!isPlaceholder(value) && RIGHTS_WORDS.test(value)) out.push(value);
  }
  return out;
}

// --- Putting it together ----------------------------------------------------

/** Case-insensitive union, first occurrence kept, order kept. */
function union(...lists: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.trim().toLowerCase();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push(item.trim());
    }
  }
  return out;
}

/** Same, for languages: merged by name, the first level seen wins. */
function unionLanguages(...lists: ReadonlyArray<readonly ProfileLanguage[]>): ProfileLanguage[] {
  const seen = new Set<string>();
  const out: ProfileLanguage[] = [];
  for (const list of lists) {
    for (const language of list) {
      const key = language.name.trim().toLowerCase();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push({ name: language.name.trim(), level: language.level.trim() });
    }
  }
  return out;
}

/** Same, for STAR examples: merged by title. */
function unionStars(...lists: ReadonlyArray<readonly StarExample[]>): StarExample[] {
  const seen = new Set<string>();
  const out: StarExample[] = [];
  for (const list of lists) {
    for (const example of list) {
      const key = example.title.trim().toLowerCase();
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push(example);
    }
  }
  return out;
}

/** Everything of value in the four files, and a note per field saying what was found. */
export function parseAiJobSearchWorkspace(files: WorkspaceFiles): ImportedProfile {
  const notes: string[] = [];
  const text = (key: keyof WorkspaceFiles): string => withoutComments(files[key] ?? '');

  for (const key of Object.keys(FILE_NAMES) as Array<keyof WorkspaceFiles>) {
    if (files[key] === null) notes.push(`${FILE_NAMES[key]} is not in that folder.`);
  }

  const claude = text('claude_md');
  const candidate = text('candidate_profile');
  const evaluation = text('job_evaluation');
  const interview = text('interview_prep');

  const out: {
    -readonly [K in keyof ImportedProfile]: ImportedProfile[K];
  } = { notes };

  // Headline: CLAUDE.md's Identity has it; the skill file does not.
  const headline = headlineIn(claude) ?? headlineIn(candidate);
  if (headline !== null) {
    out.headline = headline;
    notes.push(`Headline: "${headline}".`);
  } else notes.push('Headline: none found.');

  // Languages: a table in each file; merged by name.
  const claudeLanguages = languagesIn(claude);
  const candidateLanguages = languagesIn(candidate);
  const languages = unionLanguages(claudeLanguages.found, candidateLanguages.found);
  const skippedRows = claudeLanguages.skippedRows + candidateLanguages.skippedRows;
  if (languages.length > 0) out.languages = languages;
  notes.push(
    languages.length > 0 ? `Languages: ${languages.length} found.` : 'Languages: none found.',
  );
  if (skippedRows > 0) {
    notes.push(
      `Skipped ${skippedRows} language ${skippedRows === 1 ? 'row' : 'rows'} that ${skippedRows === 1 ? 'was' : 'were'} not "Language | Level".`,
    );
  }

  // Right to work: Status/Constraints lines that mention it.
  const rights = union(workRightsIn(claude), workRightsIn(candidate));
  if (rights.length > 0) {
    out.work_rights = rights.join('; ');
    notes.push(`Right to work: "${out.work_rights}".`);
  } else notes.push('Right to work: none found (no Status or Constraints line mentions it).');

  const list = (
    field: 'deal_breakers' | 'target_sectors' | 'career_goals' | 'energising' | 'draining',
    label: string,
    ...sources: ReadonlyArray<readonly string[]>
  ): void => {
    const items = union(...sources);
    if (items.length > 0) out[field] = items;
    notes.push(items.length > 0 ? `${label}: ${items.length} found.` : `${label}: none found.`);
  };

  list('deal_breakers', 'Deal breakers', bulletsIn(sectionLines(claude, 'Deal-breakers')));
  list('target_sectors', 'Target sectors', bulletsIn(sectionLines(claude, 'Target Sectors')));
  list(
    'career_goals',
    'Career goals',
    listAfter(evaluation, /^\s*\*{0,2}career goals\s*:?\*{0,2}\s*:?\s*(.*)$/i),
  );
  list(
    'energising',
    'Energising',
    bulletsIn(sectionLines(claude, 'What Excites You')),
    listAfter(evaluation, /^\s*[-*+]?\s*\*{0,2}tasks that energi[sz]e\s*:?\*{0,2}\s*:?\s*(.*)$/i),
  );
  list(
    'draining',
    'Draining',
    listAfter(evaluation, /^\s*[-*+]?\s*\*{0,2}tasks that drain\s*:?\*{0,2}\s*:?\s*(.*)$/i),
  );

  // STAR examples: the interview file, and CLAUDE.md in case somebody keeps them there.
  const stars = starExamplesIn(interview);
  const starsInClaude = starExamplesIn(claude);
  const examples = unionStars(stars.found, starsInClaude.found);
  if (examples.length > 0) out.star_examples = examples;
  notes.push(
    examples.length > 0 ? `STAR examples: ${examples.length} found.` : 'STAR examples: none found.',
  );
  notes.push(...stars.skipped, ...starsInClaude.skipped);

  notes.push(
    'How you write: not read. The framework keeps it in 03-writing-style.md, which is not one of the four files.',
    'Name, contact details, education and work history: not read. The profile does not store them.',
  );

  return out;
}

/** `true` when the import has at least one field to add. */
export function hasAnythingToImport(imported: ImportedProfile): boolean {
  const { notes: _notes, ...fields } = imported;
  return Object.values(fields).some((value) => value !== undefined);
}

/** `null` or whitespace: a scalar the user has not written. */
function blank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

/**
 * Lay an import over the profile the user has.
 *
 * Nothing the user typed is overwritten: a scalar is filled only when it is
 * null or blank, and every list is a union with the current entries first,
 * the imported ones appended, and case-insensitive duplicates dropped —
 * languages by name, STAR examples by title. `updated_at` is the caller's:
 * the view stamps it in `apply`, as for every other edit.
 */
export function mergeImportedProfile(current: Profile, imported: ImportedProfile): Profile {
  // `theirs` is `string | null | undefined`: the field is `string | null` on
  // the profile and optional on the import, and both absences mean "nothing".
  const scalar = (mine: string | null, theirs: string | null | undefined): string | null =>
    blank(mine) && typeof theirs === 'string' && theirs.trim() !== '' ? theirs.trim() : mine;

  return {
    ...current,
    headline: scalar(current.headline, imported.headline),
    work_rights: scalar(current.work_rights, imported.work_rights),
    writing_style: scalar(current.writing_style, imported.writing_style),
    languages: unionLanguages(current.languages, imported.languages ?? []),
    deal_breakers: union(current.deal_breakers, imported.deal_breakers ?? []),
    target_sectors: union(current.target_sectors, imported.target_sectors ?? []),
    career_goals: union(current.career_goals, imported.career_goals ?? []),
    energising: union(current.energising, imported.energising ?? []),
    draining: union(current.draining, imported.draining ?? []),
    star_examples: unionStars(current.star_examples, imported.star_examples ?? []),
  };
}
