/**
 * Ported from `backend/ai/fallbacks.py`: `extract_job_titles` (line 203),
 * `suggested_titles` (line 238) and the skill/title extraction inside
 * `job_summary` (lines 763-869).
 *
 * The Python originals take an already-structured `cv_profile` and `job` dict,
 * built upstream by an AI call. CViper Light has no AI on this path, so these
 * functions rebuild the same two structures from raw text.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SKILLS, SKILL_VOCABULARY } from './vocabulary';
import { buildCvProfile, buildJobPosting, extractJobTitles, extractSkills, suggestedTitles } from './profile';

describe('SKILL_VOCABULARY', () => {
  it('merges the default skills with every lexicon common_skills entry', () => {
    expect(SKILL_VOCABULARY).toContain('python');
    expect(SKILL_VOCABULARY).toContain('stakeholder management');
    expect(SKILL_VOCABULARY).toContain('patient care'); // healthcare.json
    expect(SKILL_VOCABULARY).toContain('safeguarding'); // healthcare.json
  });

  it('is de-duplicated and non-empty throughout', () => {
    expect(new Set(SKILL_VOCABULARY).size).toBe(SKILL_VOCABULARY.length);
    for (const term of SKILL_VOCABULARY) expect(term.trim()).not.toBe('');
  });

  it('keeps the symbol-bearing skills the token matcher exists for', () => {
    for (const term of ['c#', 'c++', 'ci/cd', '.net', 'node.js']) {
      expect(DEFAULT_SKILLS.concat([...SKILL_VOCABULARY])).toContain(term);
    }
  });
});

describe('extractSkills', () => {
  it('finds lexicon skills named in the text', () => {
    const found = extractSkills('Built REST APIs in Python and deployed on AWS with Docker containers');
    expect(found).toContain('python');
    expect(found).toContain('aws');
    expect(found).toContain('docker');
  });

  // NEGATIVE — the whole point of the token matcher.
  it('does not report java for a javascript CV', () => {
    const found = extractSkills('Senior JavaScript engineer, React and TypeScript.');
    expect(found).toContain('javascript');
    expect(found).not.toContain('java');
  });

  it('finds symbol-bearing skills', () => {
    const found = extractSkills('Strong C# and .NET background, plus CI/CD pipelines.');
    expect(found).toContain('c#');
    expect(found).toContain('.net');
    expect(found).toContain('ci/cd');
  });

  it('matches across US/UK spelling', () => {
    expect(extractSkills('search engine optimization specialist')).toContain(
      'search engine optimisation',
    );
  });

  // BOUNDARY
  it.each(['', '   '])('returns nothing for the empty text %j', (text) => {
    expect(extractSkills(text)).toEqual([]);
  });

  it('returns nothing when the text names no lexicon skill at all', () => {
    expect(extractSkills('I enjoy long walks and baking sourdough bread.')).toEqual([]);
  });

  it('is deterministic and de-duplicated', () => {
    const text = 'Python, python, PYTHON and more Python.';
    expect(extractSkills(text)).toEqual(['python']);
  });
});

describe('extractJobTitles', () => {
  it('pulls role titles out of CV prose', () => {
    const titles = extractJobTitles('2019-2024 Senior Business Analyst at a London bank.');
    expect(titles).toContain('Senior Business Analyst');
  });

  it('title-cases and de-duplicates', () => {
    const titles = extractJobTitles('data engineer ... Data Engineer ... DATA ENGINEER');
    expect(titles).toEqual(['Data Engineer']);
  });

  // BOUNDARY — the source caps at 8.
  it('never returns more than 8 titles', () => {
    const text = [
      'software developer',
      'data engineer',
      'cloud architect',
      'product manager',
      'business analyst',
      'security consultant',
      'systems administrator',
      'web designer',
      'data scientist',
      'qa tester',
    ].join('\n');
    expect(extractJobTitles(text).length).toBeLessThanOrEqual(8);
  });

  // NEGATIVE
  it.each(['', '   ', 'no roles mentioned here whatsoever'])(
    'returns nothing for %j',
    (text) => {
      expect(extractJobTitles(text)).toEqual([]);
    },
  );

  it('drops matches shorter than 5 characters', () => {
    // "lead" and "head" are in the title-word list but are too short alone.
    expect(extractJobTitles('lead')).toEqual([]);
  });
});

describe('suggestedTitles', () => {
  it('derives a title from the skills the CV shows', () => {
    expect(suggestedTitles(['python', 'django'])).toContain('Python Developer');
  });

  it('derives a domain title from a domain lexicon', () => {
    expect(suggestedTitles(['patient care', 'nursing']).length).toBeGreaterThan(0);
  });

  // BOUNDARY — the source caps at 5.
  it('never returns more than 5 titles', () => {
    expect(suggestedTitles([...SKILL_VOCABULARY]).length).toBeLessThanOrEqual(5);
  });

  // NEGATIVE
  it('returns nothing for no skills', () => {
    expect(suggestedTitles([])).toEqual([]);
    expect(suggestedTitles(['baking', 'sourdough'])).toEqual([]);
  });

  it('de-duplicates case-insensitively', () => {
    const titles = suggestedTitles(['python', 'django', 'flask']);
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(titles.length);
  });
});

describe('buildJobPosting', () => {
  const advert = [
    'Senior Business Analyst',
    'Barclays',
    'London, United Kingdom',
    '',
    'We are looking for a Business Analyst with strong SQL, stakeholder management',
    'and requirements gathering. Experience of Agile delivery is essential here.',
  ].join('\n');

  it('takes the first content line as the title', () => {
    expect(buildJobPosting(advert).title).toBe('Senior Business Analyst');
  });

  it('extracts the skills the advert names', () => {
    const job = buildJobPosting(advert);
    expect(job.keySkills).toContain('sql');
    expect(job.keySkills).toContain('stakeholder management');
    expect(job.keySkills).toContain('agile');
  });

  it('handles a "Company hiring Role in Location" headline', () => {
    const job = buildJobPosting('Barclays hiring Data Engineer in London\n\nPython and SQL needed.');
    expect(job.title).toBe('Data Engineer');
  });

  it('handles a pipe-separated headline', () => {
    const job = buildJobPosting('Risk Analyst | HSBC | London\n\nStrong Excel and SQL.');
    expect(job.title).toBe('Risk Analyst');
  });

  // BOUNDARY — no extractable requirements at all is a legitimate advert, not
  // an error. The scorer has a documented branch for it.
  it('returns an empty skill list for prose that names no lexicon skill', () => {
    const job = buildJobPosting('Barista wanted\n\nWe need someone warm, reliable and cheerful.');
    expect(job.keySkills).toEqual([]);
    expect(job.title).toBe('Barista wanted');
  });

  it('has no essential-skills list, because nothing can extract one without AI', () => {
    // The ported `matching()` falls back to keySkills when this is empty. If a
    // future extractor fills it, coverage switches to it automatically.
    expect(buildJobPosting(advert).essentialSkills).toEqual([]);
  });
});

describe('buildCvProfile', () => {
  const cv = [
    'Jane Doe',
    'Senior Business Analyst',
    '',
    'Eight years delivering change in London banking.',
    'Skills: SQL, stakeholder management, requirements gathering, Agile.',
  ].join('\n');

  it('collects skills and titles from the CV text', () => {
    const profile = buildCvProfile(cv);
    expect(profile.skills).toContain('sql');
    expect(profile.skills).toContain('stakeholder management');
    expect(profile.jobTitles).toContain('Senior Business Analyst');
  });

  it('leaves the AI-only fields empty', () => {
    // `related_skills` / `related_titles` are filled by AI keyword expansion in
    // the source. There is no AI on this path, and `matching()` expands with
    // `getSimilarTerms` internally anyway — filling them here would double-count.
    const profile = buildCvProfile(cv);
    expect(profile.relatedSkills).toEqual([]);
    expect(profile.relatedTitles).toEqual([]);
  });

  // BOUNDARY
  it('returns empty collections for empty text', () => {
    const profile = buildCvProfile('');
    expect(profile.skills).toEqual([]);
    expect(profile.jobTitles).toEqual([]);
    expect(profile.suggestedTitles).toEqual([]);
  });
});
