/**
 * The skill vocabulary the scanner looks for.
 *
 * Ported from `backend/ai/keywords.py::KeywordService.DEFAULT_KEYWORDS`
 * (lines 156-187) and the lexicon union at line 232.
 *
 * The source loads this from a database `Config` row and falls back to these
 * literals when there is none. CViper Light has no such row and no operator to
 * edit one, so the fallback IS the configuration.
 */
import { lexicon } from './lexicon';

/** `DEFAULT_KEYWORDS["skills"]` — verbatim, in source order. */
export const DEFAULT_SKILLS: readonly string[] = [
  'python',
  'java',
  'javascript',
  'react',
  'sql',
  'aws',
  'docker',
  'kubernetes',
  'api',
  'backend',
  'frontend',
  'devops',
  'agile',
  'node',
  'angular',
  'vue',
  'mongodb',
  'postgresql',
  'redis',
  'typescript',
  'go',
  'rust',
  'c++',
  'c#',
  'jenkins',
  'git',
  'machine learning',
  'ai',
  'data science',
  'tensorflow',
  'pytorch',
  'html',
  'css',
  'rest',
  'graphql',
  'microservices',
  'cloud',
  'ci/cd',
  'testing',
  'selenium',
  'junit',
  'pytest',
  'linux',
  'windows',
  'azure',
  'gcp',
  'firebase',
  'nosql',
  'elasticsearch',
];

/** `DEFAULT_KEYWORDS["common_skills"]` — verbatim, in source order. */
export const DEFAULT_COMMON_SKILLS: readonly string[] = [
  'python',
  'java',
  'javascript',
  'typescript',
  'react',
  'angular',
  'vue',
  'sql',
  'nosql',
  'docker',
  'kubernetes',
  'aws',
  'azure',
  'gcp',
  'cloud',
  'agile',
  'scrum',
  'jira',
  'confluence',
  'ci/cd',
  'devops',
  'git',
  'api',
  'rest',
  'microservices',
  'linux',
  'node.js',
  '.net',
  'c#',
  'machine learning',
  'data analysis',
  'power bi',
  'tableau',
  'excel',
  'stakeholder management',
  'business analysis',
  'requirements gathering',
  'swift',
  'payments',
  'fx',
  'settlements',
  'risk',
  'compliance',
];

/** De-duplicate, preserving first-seen order (Python's `dict.fromkeys`). */
function ordered(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * The tech/finance core plus every domain lexicon's `common_skills`, exactly
 * as `keywords.py` line 232 unions them.
 *
 * This is what makes the scorer work for a nurse or a bricklayer rather than
 * only for a software engineer.
 */
export const COMMON_SKILLS: readonly string[] = ordered([
  ...DEFAULT_COMMON_SKILLS,
  ...lexicon.commonSkills,
]);

/**
 * The full scan vocabulary: `skills` + `common_skills`, matching the
 * `skill_vocab` built in `fallbacks.py::ats_score` (line 987).
 */
export const SKILL_VOCABULARY: readonly string[] = ordered([...DEFAULT_SKILLS, ...COMMON_SKILLS]);
