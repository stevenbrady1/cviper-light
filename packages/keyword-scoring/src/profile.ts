/**
 * Rebuilding the two structures `matching()` expects, from raw text.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS AT ALL.
 * ============================================================================
 * In the source, `FallbackService.matching()` receives a `cv_profile` and a
 * `job` dict that an AI call built earlier in the pipeline. The whole point of
 * this package is the case where there is no AI call, so the structures have
 * to come from somewhere else: a scan of the text against the same lexicon
 * vocabulary the rest of the scorer uses.
 *
 * Ported from `backend/ai/fallbacks.py`:
 *   - `extract_job_titles` (line 203)
 *   - `suggested_titles`   (line 238)
 *   - the skill scan and headline parsing inside `job_summary` (lines 763-869)
 *
 * The AI-only fields (`related_skills`, `related_titles`, `essential_skills`)
 * stay empty, and every consumer already has a documented branch for that:
 * `matching()` falls back from `essential_skills` to `key_skills`, and expands
 * skills with `getSimilarTerms` internally rather than trusting a
 * pre-expanded list.
 */
import { foldSpelling } from './spelling';
import { getSimilarTerms } from './similar';
import { termInFoldedText } from './term';
import { COMMON_SKILLS, SKILL_VOCABULARY } from './vocabulary';

/** Matches `_MAX_TEXT_LENGTH` in `FallbackService` — a CPU guard on regex work. */
export const MAX_TEXT_LENGTH = 50000;

export interface CvProfile {
  /** Lexicon skills the CV text names. */
  readonly skills: readonly string[];
  /** Always empty: filled by AI keyword expansion in the source. */
  readonly relatedSkills: readonly string[];
  /** Titles implied by the CV's skills, via the lexicon `skill_title_map`. */
  readonly suggestedTitles: readonly string[];
  /** Titles found literally in the CV prose. */
  readonly jobTitles: readonly string[];
  /** Always empty: filled by AI keyword expansion in the source. */
  readonly relatedTitles: readonly string[];
}

export interface JobPosting {
  readonly title: string;
  readonly description: string;
  /** Lexicon skills the advert names. */
  readonly keySkills: readonly string[];
  /** Always empty without AI. `matching()` falls back to `keySkills`. */
  readonly essentialSkills: readonly string[];
  /** Always empty without AI. Used only to corroborate ultra-short tokens. */
  readonly keyRequirements: readonly string[];
}

/** Python's `str.title()`: capitalise the first letter of every alphabetic run. */
export function titleCase(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase());
}

/**
 * The lexicon skills named in `text`, whole-token and symbol-aware.
 *
 * The haystack is folded ONCE and then tested against every term, rather than
 * re-folding a 50,000-character document a few hundred times.
 */
export function extractSkills(text: string, vocabulary: readonly string[] = SKILL_VOCABULARY): string[] {
  const trimmed = (text || '').slice(0, MAX_TEXT_LENGTH);
  if (!trimmed.trim()) return [];
  const folded = foldSpelling(trimmed.toLowerCase());
  const found: string[] = [];
  const seen = new Set<string>();
  for (const term of vocabulary) {
    if (seen.has(term)) continue;
    if (termInFoldedText(term, folded)) {
      seen.add(term);
      found.push(term);
    }
  }
  return found;
}

// ── Job titles in CV prose ───────────────────────────────────────────────────

const TITLE_WORDS =
  '(?:developer|engineer|architect|manager|analyst|consultant|' +
  'administrator|designer|scientist|specialist|coordinator|' +
  'director|officer|lead|head|chief|vp|president|' +
  'tester|technician|programmer|dba|sre|cto|cio|cfo)';

const SENIORITY =
  '(?:senior|junior|lead|principal|staff|mid[- ]?level|entry[- ]?level|graduate|intern|trainee|chief|head\\s+of)?';

const DOMAIN =
  '(?:software|web|frontend|front[- ]end|backend|back[- ]end|full[- ]?stack|' +
  'data|cloud|devops|security|mobile|ios|android|qa|quality|test|' +
  'systems?|network|infrastructure|platform|product|project|programme|' +
  'business|financial|investment|risk|operations|it|technical|solutions?)?';

const TITLE_PATTERN = new RegExp(
  '\\b' + SENIORITY + '\\s*' + DOMAIN + '\\s*' + TITLE_WORDS + '\\b',
  'gi',
);

/** Ported from `extract_job_titles` (line 203). Caps at 8, as the source does. */
export function extractJobTitles(cvText: string): string[] {
  const text = (cvText || '').slice(0, MAX_TEXT_LENGTH);
  if (!text.trim()) return [];

  const titles: string[] = [];
  const seen = new Set<string>();
  // A fresh regex per call: a `g` regex carries `lastIndex` between uses, and
  // sharing one across calls would silently skip the start of the second CV.
  const pattern = new RegExp(TITLE_PATTERN.source, 'gi');
  for (const match of text.matchAll(pattern)) {
    const title = titleCase(match[0].trim().replace(/\s+/g, ' '));
    if (title.length >= 5 && !seen.has(title.toLowerCase())) {
      titles.push(title);
      seen.add(title.toLowerCase());
    }
  }
  return titles.slice(0, 8);
}

// ── Titles implied by skills ─────────────────────────────────────────────────

import { lexicon } from './lexicon';

/**
 * Ported from `suggested_titles` (line 238).
 *
 * The source prefixes each title with a seniority word derived from the
 * candidate's parsed years of experience. Nothing on this path parses years,
 * and inventing "Graduate" or "Senior" would be a claim about the candidate
 * that no evidence supports — so `experienceYears: null` means no prefix. The
 * prefix is cosmetic for scoring anyway: `coreTitleWords` in `match.ts` strips
 * seniority words before comparing.
 */
export function suggestedTitles(skills: readonly string[], experienceYears: number | null = null): string[] {
  const skillsLower = new Set(skills.map((s) => s.toLowerCase()));
  const titles: string[] = [];

  for (const rule of lexicon.skillTitleMap) {
    if (rule.skills.some((skill) => skillsLower.has(skill.toLowerCase()))) titles.push(rule.title);
  }

  let prefix = '';
  if (experienceYears !== null) {
    if (experienceYears >= 10) prefix = 'Senior ';
    else if (experienceYears >= 5) prefix = '';
    else if (experienceYears >= 2) prefix = 'Junior ';
    else prefix = 'Graduate ';
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const title of titles) {
    const prefixed = prefix && !title.startsWith(prefix) ? prefix + title : title;
    if (!seen.has(prefixed.toLowerCase())) {
      seen.add(prefixed.toLowerCase());
      unique.push(prefixed);
    }
  }
  return unique.slice(0, 5);
}

// ── Building the two structures ──────────────────────────────────────────────

const HEADLINE_NOISE = ['sign in', 'join', 'by clicking', 'cookie'];
const BOARD_NAMES = new Set(['linkedin', 'indeed', 'reed', 'totaljobs', 'efinancialcareers']);

function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 3 && !HEADLINE_NOISE.some((noise) => line.toLowerCase().startsWith(noise)));
}

/**
 * The advert's job title. Ported from the headline parsing in `job_summary`
 * (lines 770-822) — the first content line, unless the line is one of the two
 * job-board headline shapes, in which case the role is pulled out of it.
 */
function extractJobTitle(lines: readonly string[]): string {
  const first = lines[0];
  if (first !== undefined && first.length < 120 && !first.includes('|') && !first.toLowerCase().includes('hiring')) {
    return first;
  }

  for (const line of lines.slice(0, 5)) {
    const hiring = /^(.+?)\s+hiring\s+(.+?)\s+in\s+(.+?)(?:\s*\|.*)?$/i.exec(line);
    if (hiring?.[2] !== undefined) return hiring[2].trim();

    if (line.includes('|')) {
      const parts = line
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part !== '' && !BOARD_NAMES.has(part.toLowerCase()));
      const head = parts[0];
      if (parts.length >= 2 && head !== undefined) return head.slice(0, 100);
    }
  }

  return first !== undefined ? first.slice(0, 100) : 'Job Posting';
}

/** Build the `job` structure `matching()` expects from a pasted advert. */
export function buildJobPosting(jobText: string): JobPosting {
  const text = (jobText || '').slice(0, MAX_TEXT_LENGTH);
  const lines = contentLines(text);
  return {
    title: extractJobTitle(lines),
    description: text,
    // `job_summary` scans `common_skills` for the advert's stated skills; the
    // wider `skills` list is the ATS layer's vocabulary, not this one.
    keySkills: extractSkills(text, COMMON_SKILLS),
    essentialSkills: [],
    keyRequirements: [],
  };
}

/** Build the `cv_profile` structure `matching()` expects from CV text. */
export function buildCvProfile(cvText: string): CvProfile {
  const text = (cvText || '').slice(0, MAX_TEXT_LENGTH);
  const skills = extractSkills(text);
  return {
    skills,
    relatedSkills: [],
    suggestedTitles: suggestedTitles(skills),
    jobTitles: extractJobTitles(text),
    relatedTitles: [],
  };
}

/** Re-exported so callers do not have to reach into two modules for expansion. */
export { getSimilarTerms };
