/**
 * L-283 — a skill the CV says it LACKS is not a skill the CV has.
 *
 * Reproduced on the L-281 eval set: the HGV poor-fit CV says "No CPC or
 * tachograph card yet", and the scorer credited it with a digital tachograph.
 *
 * The rule is deliberately narrow. Each case that is masked is paired with a
 * near miss that must NOT be, because masking a real skill is worse than
 * leaving the old bug: it tells a qualified candidate to go and get something
 * they already hold.
 */
import { describe, expect, it } from 'vitest';

import { maskNegated } from './negation';
import { buildCvProfile } from './profile';

const skillsOf = (cv: string): readonly string[] => buildCvProfile(cv).skills;

describe('a CV skill inside a plain negation is not credited (L-283)', () => {
  // The reproducing case, verbatim from fixtures/cvs/03-poor.txt.
  it('"No CPC or tachograph card yet" credits no tachograph', () => {
    expect(
      skillsOf('LICENCES\nClass 2 (C) licence.\nNo CPC or tachograph card yet.'),
    ).not.toContain('Digital tachograph');
  });

  it.each([
    ['No experience of SQL.', 'sql'],
    ['I do not have a full UK driving licence.', 'Full UK driving licence'],
    ["I don't hold a DBS check at the moment.", 'DBS check'],
    ['Applying without a DBS check.', 'DBS check'],
    ['Lacking Excel skills, I used Google Sheets.', 'excel'],
    ['Driver CPC not held.', 'Driver CPC'],
    ['Driver CPC - not yet held', 'Driver CPC'],
    ['SIA licence expired in 2023.', 'SIA licence'],
    ['No node.js', 'node.js'],
  ])('%j credits no %j', (cv, skill) => {
    expect(skillsOf(cv)).not.toContain(skill);
  });

  // A positive mention anywhere else wins: masking removes one mention, not
  // the skill.
  it('a skill negated once but held elsewhere is still credited', () => {
    expect(skillsOf('No ADR. Driver CPC valid until 2028.')).toContain('Driver CPC');
    expect(skillsOf('No Python yet, but I use SQL every day.')).toContain('sql');
    expect(skillsOf('No SQL at my last job. Daily SQL reporting before that.')).toContain('sql');
  });
});

describe('what is NOT a negation', () => {
  // NEGATIVE — every one of these names a skill the candidate has.
  it.each([
    ['Not only Python but also SQL.', 'python'],
    ['No less than five years of Excel.', 'excel'],
    ['No more than a week to learn Tableau.', 'tableau'],
    ['Ran payroll in Sage 50 without errors.', 'Sage accounting'],
    ['Delivered without supervision. SQL reporting daily.', 'sql'],
    ['Never missed a deadline in Jira.', 'jira'],
    [
      'Explained findings to non-technical teams; stakeholder management.',
      'stakeholder management',
    ],
    ["I don't take things personally. Customer service for six years.", 'customer service'],
    // "Working towards" is ambiguous — many adverts accept it — so it stays a
    // match on purpose (recorded on #376).
    ['Working towards NVQ Level 3.', 'NVQ Level 3'],
  ])('%j still credits %j', (cv, skill) => {
    expect(skillsOf(cv)).toContain(skill);
  });

  // BOUNDARY — the masked window is at most six words, so a long sentence
  // that opens with "not" keeps the skills at its far end.
  it('stops masking six words after the cue', () => {
    expect(
      skillsOf('Not afraid to roll up my sleeves running payroll in Sage 50 for 40 staff.'),
    ).toContain('Sage accounting');
  });

  it.each(['Python, no', 'no', ''])('handles %j without throwing', (cv) => {
    expect(() => maskNegated(cv)).not.toThrow();
  });

  it('a cue at the very end masks nothing before it', () => {
    expect(skillsOf('Python, no')).toContain('python');
  });
});

describe('maskNegated', () => {
  it('breaks the masked span so the words either side cannot join into a phrase', () => {
    // "data" + "analysis" around a masked span must not read as "data analysis".
    expect(skillsOf('Data no a b c d e f\nanalysis')).not.toContain('data analysis');
    expect(maskNegated('Data no a b c analysis')).not.toMatch(/data\s+analysis/i);
  });

  it('leaves a sentence with no cue unchanged', () => {
    const cv = 'Six years of SQL, Python and stakeholder management.';
    expect(maskNegated(cv)).toBe(cv);
  });
});
