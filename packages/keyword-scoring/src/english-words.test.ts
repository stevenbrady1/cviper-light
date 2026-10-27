/**
 * L-286 — an everyday English word is not a tech skill.
 *
 * The CV lines below are verbatim from the L-281 eval CVs (`eval/fixtures`).
 * Each was read as a skill the candidate does not have. Each is paired with
 * how the same word reads when it IS the skill, which must keep matching:
 * hiding a real skill is worse than the bug.
 */
import { describe, expect, it } from 'vitest';

import { AMBIGUOUS_SKILL_WORDS, dropEnglishWordSkills } from './english-words';
import { buildCvProfile, buildJobPosting } from './profile';
import { SKILL_VOCABULARY } from './vocabulary';

const cvSkills = (text: string): readonly string[] => buildCvProfile(text).skills;

describe('the word list', () => {
  it('names only words the upstream vocabulary actually scans', () => {
    for (const word of AMBIGUOUS_SKILL_WORDS) expect(SKILL_VOCABULARY).toContain(word);
  });
});

describe('a lower-case English word on its own is not the skill (L-286)', () => {
  it.each([
    ['rest', 'I make sure the rest of the round still gets done.'],
    ['go', 'Team Teach trained - I go to de-escalation first.'],
    ['windows', 'Built themed window displays that lifted footfall.'],
    ['windows', 'Sorting, steaming, pricing, windows and the till.'],
    ['react', 'I react calmly when a resident falls.'],
    ['rust', 'Treated rust on the van sills before the MOT.'],
    ['swift', 'Known for a swift response to call bells.'],
  ])('does not credit %j from %j', (skill, line) => {
    expect(cvSkills(line)).not.toContain(skill);
  });
});

describe('the same word written as the skill still counts', () => {
  // NEGATIVE — every one of these is the real skill.
  it.each([
    ['windows', 'Supported Windows Server, Microsoft 365 and Entra ID.'],
    ['rest', 'Designed REST APIs for the bookings service.'],
    ['go', 'Rewrote the ingest service in Go.'],
    ['react', 'Front end in React and TypeScript.'],
    ['swift', 'Processed SWIFT MT103 payments.'],
    ['rust', 'Systems work in Rust.'],
  ])('credits %j in %j', (skill, line) => {
    expect(cvSkills(line)).toContain(skill);
  });

  // A lower-case skills list: the other tech skills on the line vouch for it.
  it.each([
    ['go', 'languages: python, go, rust'],
    ['rest', 'node.js, rest, graphql'],
    ['react', 'react / typescript / css'],
  ])('credits lower-case %j in a tech list: %j', (skill, line) => {
    expect(cvSkills(line)).toContain(skill);
  });

  // BOUNDARY — one capitalised mention anywhere is enough.
  it('a capitalised mention elsewhere keeps the skill', () => {
    expect(cvSkills('Took a rest day.\nBuilt REST services.')).toContain('rest');
  });
});

describe('the advert side', () => {
  it('"the rest of the team" is not a REST requirement', () => {
    expect(
      buildJobPosting('Care Assistant\n\nSupport the rest of the team on nights.').keySkills,
    ).not.toContain('rest');
  });

  it('"REST APIs" still is', () => {
    expect(buildJobPosting('Backend Developer\n\nBuild REST APIs in Python.').keySkills).toContain(
      'rest',
    );
  });
});

describe('dropEnglishWordSkills', () => {
  it('leaves every word not on the list alone', () => {
    expect(dropEnglishWordSkills(['python', 'excel', 'risk'], 'python excel risk')).toEqual([
      'python',
      'excel',
      'risk',
    ]);
  });

  it('handles empty input', () => {
    expect(dropEnglishWordSkills([], '')).toEqual([]);
  });
});
