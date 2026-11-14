/**
 * Which of the six parts of the profile are filled in (L-413).
 *
 * Pure, so every rule is tested at its edge without drawing anything. The
 * rules are generous on purpose: the card must never nag about a part the
 * user has started.
 */
import { describe, expect, it } from 'vitest';

import { emptyProfile, type Cv, type Profile } from '@cviper/core-types';

import { PART_TITLE, PROFILE_PART_IDS, profileParts, type ProfilePartId } from './progress';

const EMPTY = emptyProfile('2026-11-14T09:00:00.000Z');

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.pdf',
  file_path: null,
  extracted_text: null,
  json_resume: null,
  created_at: '2026-11-01T09:00:00.000Z',
};

const STAR = { title: '', situation: '', task: '', action: '', result: '' };

/** Everything filled in, each part by the least its rule accepts. */
const FULL: Profile = {
  ...EMPTY,
  headline: 'Reporting analyst',
  languages: [{ name: 'English', level: '' }],
  career_goals: ['Lead a small team'],
  draining: ['Status meetings'],
  star_examples: [{ ...STAR, result: 'Passed.' }],
};

function done(profile: Profile, cvs: readonly Cv[] = []): Record<ProfilePartId, boolean> {
  return Object.fromEntries(
    profileParts(profile, cvs).map((part) => [part.id, part.done]),
  ) as Record<ProfilePartId, boolean>;
}

describe('profileParts', () => {
  it('lists the six parts in the order the page shows them, under the page’s own titles', () => {
    const parts = profileParts(EMPTY, []);

    expect(parts.map((part) => part.id)).toEqual([
      'cv',
      'about',
      'languages',
      'wants',
      'energy',
      'star',
    ]);
    expect(parts.map((part) => part.id)).toEqual([...PROFILE_PART_IDS]);
    expect(parts.map((part) => part.title)).toEqual(PROFILE_PART_IDS.map((id) => PART_TITLE[id]));
    expect(PART_TITLE.energy).toBe('What energises you, what drains you');
  });

  it('boundary: nothing filled in is 0 of 6', () => {
    expect(profileParts(EMPTY, []).filter((part) => part.done)).toEqual([]);
  });

  it('boundary: each part filled by the least its rule accepts is 6 of 6', () => {
    expect(profileParts(FULL, [CV]).every((part) => part.done)).toBe(true);
  });

  it('happy: five filled and one not names exactly the one', () => {
    const parts = profileParts({ ...FULL, draining: [] }, [CV]);

    expect(parts.filter((part) => !part.done).map((part) => part.id)).toEqual(['energy']);
  });

  describe('Your CV: at least one CV is saved', () => {
    it('none is not filled in; one is, even a CV whose text was never read', () => {
      expect(done(EMPTY, []).cv).toBe(false);
      expect(done(EMPTY, [CV]).cv).toBe(true);
    });
  });

  describe('About you: the headline has text', () => {
    it('one character counts', () => {
      expect(done({ ...EMPTY, headline: 'x' }).about).toBe(true);
    });

    it('negative: null, empty and spaces-only do not', () => {
      expect(done({ ...EMPTY, headline: null }).about).toBe(false);
      expect(done({ ...EMPTY, headline: '' }).about).toBe(false);
      expect(done({ ...EMPTY, headline: '  \n\t ' }).about).toBe(false);
    });

    it('negative: the other two boxes alone do not fill it in', () => {
      expect(done({ ...EMPTY, work_rights: 'Citizen', writing_style: 'Plain' }).about).toBe(false);
    });
  });

  describe('Languages: at least one language has a name', () => {
    it('one named language counts, with no level', () => {
      expect(done({ ...EMPTY, languages: [{ name: 'Welsh', level: '' }] }).languages).toBe(true);
    });

    it('edge: a row with no name does not count, even with a level', () => {
      expect(done({ ...EMPTY, languages: [{ name: '', level: 'Fluent' }] }).languages).toBe(false);
      expect(done({ ...EMPTY, languages: [{ name: '   ', level: '' }] }).languages).toBe(false);
    });

    it('a named row after an empty one counts', () => {
      const languages = [
        { name: '', level: '' },
        { name: 'Polish', level: '' },
      ];
      expect(done({ ...EMPTY, languages }).languages).toBe(true);
    });
  });

  describe('What you are looking for: any of its three boxes has a line', () => {
    it.each(['deal_breakers', 'target_sectors', 'career_goals'] as const)(
      'one line in %s alone counts',
      (box) => {
        expect(done({ ...EMPTY, [box]: ['One line'] }).wants).toBe(true);
      },
    );

    it('negative: lines of spaces do not', () => {
      expect(done({ ...EMPTY, deal_breakers: ['  ', ''], career_goals: [' '] }).wants).toBe(false);
    });
  });

  describe('What energises you, what drains you: either box has a line', () => {
    it.each(['energising', 'draining'] as const)('one line in %s alone counts', (box) => {
      expect(done({ ...EMPTY, [box]: ['One line'] }).energy).toBe(true);
    });

    it('negative: lines of spaces do not', () => {
      expect(done({ ...EMPTY, energising: [' '], draining: [''] }).energy).toBe(false);
    });
  });

  describe('STAR examples: at least one example has any text', () => {
    it.each(['title', 'situation', 'task', 'action', 'result'] as const)(
      'text in %s alone counts',
      (field) => {
        expect(done({ ...EMPTY, star_examples: [{ ...STAR, [field]: 'x' }] }).star).toBe(true);
      },
    );

    it('negative: an added example with nothing typed, or only spaces, does not', () => {
      expect(done({ ...EMPTY, star_examples: [STAR] }).star).toBe(false);
      expect(done({ ...EMPTY, star_examples: [{ ...STAR, action: '  ' }] }).star).toBe(false);
    });
  });
});
