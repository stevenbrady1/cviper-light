/**
 * The lexicons: skill synonyms, skill→title mappings and rarity weights.
 *
 * Ported from `backend/ai/keywords.py::load_lexicons` (line 113) and the
 * merge-order rationale at lines 102-110 (CV-705a). The 15 JSON files under
 * `lexicons/` are byte-for-byte copies of
 * `backend/ai/data/lexicons/*.json` — they are DATA, not code, and must not be
 * edited here. Improve them in the source repository and re-copy.
 *
 * ============================================================================
 * MERGE ORDER IS LOAD-BEARING.
 * ============================================================================
 * The Python loader globs the directory and merges in `sorted()` filename
 * order, and `related_terms` / `skill_weights` merge with LAST-WRITE-WINS. So
 * `_base.json` (the tech + finance + BA/PM core) has to be applied first and
 * the 14 domain files layered on top of it — `_` sorts before every letter,
 * which is why the file is named with a leading underscore rather than
 * `base.json`. A bundler has no directory to glob, so the order is written out
 * explicitly below and pinned by a test.
 *
 * The alias index at the bottom is ported from
 * `backend/ai/skill_canonical.py::_build_alias_index`.
 */

import base from './lexicons/_base.json';
import accounting from './lexicons/accounting.json';
import construction from './lexicons/construction.json';
import creative from './lexicons/creative.json';
import education from './lexicons/education.json';
import engineering from './lexicons/engineering.json';
import healthcare from './lexicons/healthcare.json';
import hospitalityRetail from './lexicons/hospitality_retail.json';
import hr from './lexicons/hr.json';
import legal from './lexicons/legal.json';
import manufacturing from './lexicons/manufacturing.json';
import marketing from './lexicons/marketing.json';
import publicSector from './lexicons/public_sector.json';
import sales from './lexicons/sales.json';
import science from './lexicons/science.json';

/** One `[skills, title]` row of a `skill_title_map`, given names. */
export interface SkillTitleRule {
  readonly skills: readonly string[];
  readonly title: string;
}

export interface Lexicon {
  /** canonical term -> related terms. Bidirectional by curation, not by code. */
  readonly relatedTerms: Readonly<Record<string, readonly string[]>>;
  /** term -> rarity weight. Anything absent is 1.0. */
  readonly skillWeights: Readonly<Record<string, number>>;
  readonly skillTitleMap: readonly SkillTitleRule[];
  readonly commonSkills: readonly string[];
}

/**
 * The filenames in the exact order `sorted(LEXICON_DIR.glob("*.json"))`
 * produces. Pinned by `lexicon.test.ts`.
 */
export const LEXICON_FILENAMES = [
  '_base.json',
  'accounting.json',
  'construction.json',
  'creative.json',
  'education.json',
  'engineering.json',
  'healthcare.json',
  'hospitality_retail.json',
  'hr.json',
  'legal.json',
  'manufacturing.json',
  'marketing.json',
  'public_sector.json',
  'sales.json',
  'science.json',
] as const;

/** In the same order as `LEXICON_FILENAMES`, which a test asserts. */
const LEXICON_FILES: readonly unknown[] = [
  base,
  accounting,
  construction,
  creative,
  education,
  engineering,
  healthcare,
  hospitalityRetail,
  hr,
  legal,
  manufacturing,
  marketing,
  publicSector,
  sales,
  science,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Read one lexicon file's contents defensively.
 *
 * The Python loader wraps each file in a try/except so "a malformed file is
 * logged and skipped rather than breaking startup". Bundled JSON cannot fail
 * to parse, but it CAN be the wrong shape after a bad hand-edit, and a
 * `TypeError` at module load would take the whole app down before the user has
 * clicked anything. So every row is validated and bad rows are dropped.
 */
export function readLexiconFile(data: unknown): Lexicon {
  const relatedTerms: Record<string, string[]> = {};
  const skillWeights: Record<string, number> = {};
  const skillTitleMap: SkillTitleRule[] = [];
  const commonSkills: string[] = [];

  if (!isRecord(data)) {
    return { relatedTerms, skillWeights, skillTitleMap, commonSkills };
  }

  const rawRelated = data['related_terms'];
  if (isRecord(rawRelated)) {
    for (const [term, aliases] of Object.entries(rawRelated)) {
      if (!Array.isArray(aliases)) continue;
      const cleaned = aliases.map(cleanString).filter((alias): alias is string => alias !== null);
      if (cleaned.length === aliases.length) relatedTerms[term] = cleaned;
    }
  }

  const rawWeights = data['skill_weights'];
  if (isRecord(rawWeights)) {
    for (const [term, weight] of Object.entries(rawWeights)) {
      if (typeof weight === 'number' && Number.isFinite(weight)) skillWeights[term] = weight;
    }
  }

  const rawTitleMap = data['skill_title_map'];
  if (Array.isArray(rawTitleMap)) {
    for (const row of rawTitleMap) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const [rawSkills, rawTitle] = row;
      if (!Array.isArray(rawSkills)) continue;
      const skills = rawSkills.map(cleanString).filter((s): s is string => s !== null);
      const title = cleanString(rawTitle);
      if (skills.length > 0 && title !== null) skillTitleMap.push({ skills, title });
    }
  }

  const rawCommon = data['common_skills'];
  if (Array.isArray(rawCommon)) {
    for (const skill of rawCommon) {
      const cleaned = cleanString(skill);
      if (cleaned !== null) commonSkills.push(cleaned);
    }
  }

  return { relatedTerms, skillWeights, skillTitleMap, commonSkills };
}

/**
 * Merge every lexicon file in `LEXICON_FILENAMES` order.
 *
 * `relatedTerms` and `skillWeights` merge last-write-wins (Python's
 * `dict.update`); `skillTitleMap` and `commonSkills` concatenate (`list.extend`).
 */
function loadLexicons(): Lexicon {
  const relatedTerms: Record<string, readonly string[]> = {};
  const skillWeights: Record<string, number> = {};
  const skillTitleMap: SkillTitleRule[] = [];
  const commonSkills: string[] = [];

  for (const file of LEXICON_FILES) {
    const parsed = readLexiconFile(file);
    Object.assign(relatedTerms, parsed.relatedTerms);
    Object.assign(skillWeights, parsed.skillWeights);
    skillTitleMap.push(...parsed.skillTitleMap);
    commonSkills.push(...parsed.commonSkills);
  }

  return { relatedTerms, skillWeights, skillTitleMap, commonSkills };
}

/** Built once at module load, exactly as the source builds it at import time. */
export const lexicon: Lexicon = loadLexicons();

/**
 * Cert-mapping aliases that are not already in `related_terms`, ported from
 * `skill_canonical.py::EXTRA_ALIASES`.
 */
const EXTRA_ALIASES: Readonly<Record<string, string>> = {
  'ci cd': 'ci/cd',
  ml: 'machine learning',
};

/**
 * alias -> canonical term, inverted from `relatedTerms`.
 *
 * FIRST-WRITE-WINS on a collision, which is why the insertion order of the
 * merged lexicon matters: the same alias must resolve to the same canonical on
 * every run, or two scores of the same CV are not comparable.
 */
function buildAliasIndex(source: Lexicon): Map<string, string> {
  const index = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(source.relatedTerms)) {
    const canonKey = canonical.trim().toLowerCase();
    index.set(canonKey, canonKey);
    for (const alias of aliases) {
      const key = alias.trim().toLowerCase();
      if (key && !index.has(key)) index.set(key, canonKey);
    }
  }
  for (const [alias, canonical] of Object.entries(EXTRA_ALIASES)) {
    const key = alias.trim().toLowerCase();
    if (!index.has(key)) index.set(key, canonical.trim().toLowerCase());
  }
  return index;
}

export const aliasIndex: ReadonlyMap<string, string> = buildAliasIndex(lexicon);
