/**
 * Ported from `backend/ai/keywords.py::load_lexicons` (line 113) and the
 * merge-order rationale at lines 102-110 (CV-705a).
 */
import { describe, expect, it } from 'vitest';
import { LEXICON_FILENAMES, aliasIndex, lexicon, readLexiconFile } from './lexicon';

describe('lexicon file set', () => {
  it('carries all 15 files from the source, base first then alphabetical', () => {
    expect(LEXICON_FILENAMES).toEqual([
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
    ]);
  });

  // The loader merges with last-write-wins on `related_terms` and
  // `skill_weights`, so `_base.json` MUST be applied first and the domain
  // files layered on top. Sorting puts `_` before any letter — this pins it.
  it('puts _base.json first', () => {
    expect(LEXICON_FILENAMES[0]).toBe('_base.json');
    expect([...LEXICON_FILENAMES].sort()).toEqual([...LEXICON_FILENAMES]);
  });
});

describe('merged lexicon', () => {
  it('merges every section at the counts the source produces', () => {
    expect(Object.keys(lexicon.relatedTerms).length).toBe(248);
    expect(Object.keys(lexicon.skillWeights).length).toBe(25);
    expect(lexicon.skillTitleMap.length).toBe(84);
    expect(lexicon.commonSkills.length).toBe(76);
  });

  it('carries base entries', () => {
    expect(lexicon.relatedTerms['business analyst']).toContain('business analysis');
    expect(lexicon.skillWeights['agile']).toBe(0.4);
  });

  it('carries domain entries layered on top of base', () => {
    // From marketing.json / healthcare.json — proof the domain files loaded.
    expect(lexicon.commonSkills).toContain('digital marketing');
    expect(lexicon.commonSkills).toContain('patient care');
    expect(Object.keys(lexicon.relatedTerms)).toContain('safeguarding');
  });

  it('has no empty skill-title-map entry', () => {
    for (const entry of lexicon.skillTitleMap) {
      expect(entry.skills.length).toBeGreaterThan(0);
      expect(entry.title.length).toBeGreaterThan(0);
    }
  });
});

describe('readLexiconFile', () => {
  it('reads a well-formed file', () => {
    const parsed = readLexiconFile({
      related_terms: { aws: ['amazon web services'] },
      skill_weights: { agile: 0.4 },
      skill_title_map: [[['python'], 'Python Developer']],
      common_skills: ['python'],
    });
    expect(parsed.relatedTerms['aws']).toEqual(['amazon web services']);
    expect(parsed.skillTitleMap[0]).toEqual({ skills: ['python'], title: 'Python Developer' });
  });

  // NEGATIVE — the source's contract is "a malformed file is skipped rather
  // than breaking startup". Nothing here may throw.
  it.each([null, undefined, 42, 'a string', [], true])(
    'returns an empty lexicon for the malformed input %j',
    (input) => {
      const parsed = readLexiconFile(input);
      expect(parsed.relatedTerms).toEqual({});
      expect(parsed.skillWeights).toEqual({});
      expect(parsed.skillTitleMap).toEqual([]);
      expect(parsed.commonSkills).toEqual([]);
    },
  );

  // NEGATIVE — bad rows inside an otherwise good file are dropped, not fatal.
  it('drops malformed rows and keeps the good ones', () => {
    const parsed = readLexiconFile({
      related_terms: { aws: ['ok'], bad: 'not-an-array', alsoBad: [1, 2] },
      skill_weights: { agile: 0.4, broken: 'heavy', nan: Number.NaN },
      skill_title_map: [
        [['python'], 'Python Developer'],
        ['not-a-pair'],
        [[], 'No Skills'],
        [['x'], ''],
      ],
      common_skills: ['python', 7, '', '  '],
    });
    expect(parsed.relatedTerms).toEqual({ aws: ['ok'] });
    expect(parsed.skillWeights).toEqual({ agile: 0.4 });
    expect(parsed.skillTitleMap).toEqual([{ skills: ['python'], title: 'Python Developer' }]);
    expect(parsed.commonSkills).toEqual(['python']);
  });

  // BOUNDARY
  it('reads an empty object', () => {
    const parsed = readLexiconFile({});
    expect(parsed.commonSkills).toEqual([]);
  });
});

describe('aliasIndex', () => {
  // Ported from `backend/ai/skill_canonical.py::_build_alias_index`.
  it('maps an alias to its canonical term', () => {
    expect(aliasIndex.get('k8s')).toBe('kubernetes');
  });

  it('self-maps every canonical term (idempotency)', () => {
    expect(aliasIndex.get('kubernetes')).toBe('kubernetes');
  });

  it('carries the cert-only extra aliases', () => {
    expect(aliasIndex.get('ci cd')).toBe('ci/cd');
    expect(aliasIndex.get('ml')).toBe('machine learning');
  });

  it('is first-write-wins on a collision', () => {
    // Rebuilding must be stable: the same alias never flips canonical between
    // runs, which is what keeps saved scores comparable.
    expect(aliasIndex.size).toBe(962);
  });

  // NEGATIVE
  it('does not invent a canonical for an unknown term', () => {
    expect(aliasIndex.get('quidditch')).toBeUndefined();
  });
});
