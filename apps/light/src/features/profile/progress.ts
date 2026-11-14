import { type Cv, type Profile } from '@cviper/core-types';

/**
 * Which of the six parts of the profile are filled in (L-413).
 *
 * Worked out from what the Profile screen has already loaded. Nothing here is
 * stored, and nothing is read that the screen did not read anyway.
 *
 * ============================================================================
 * THE SIX RULES — GENEROUS ON PURPOSE
 * ============================================================================
 * A part counts as soon as the user has started it. Every part is optional, so
 * the card must never read as a telling-off for a box left empty by choice.
 *
 *   Part                                   Filled in when
 *   -------------------------------------  ----------------------------------
 *   Your CV                                at least one CV is saved
 *   About you                              Headline has text
 *   Languages                              at least one language has a name
 *   What you are looking for               any of its three boxes has a line
 *   What energises you, what drains you    either box has a line
 *   STAR examples                          at least one example has any text
 *
 * Text that is only spaces is not text.
 */

/** The parts, in the order the page shows them. */
export const PROFILE_PART_IDS = ['cv', 'about', 'languages', 'wants', 'energy', 'star'] as const;

export type ProfilePartId = (typeof PROFILE_PART_IDS)[number];

/**
 * Each part's title. The page's own section headings are drawn from here, so
 * the checklist cannot name a part by a title the page does not show.
 */
export const PART_TITLE: Readonly<Record<ProfilePartId, string>> = {
  cv: 'Your CV',
  about: 'About you',
  languages: 'Languages',
  wants: 'What you are looking for',
  energy: 'What energises you, what drains you',
  star: 'STAR examples',
};

export interface ProfilePart {
  readonly id: ProfilePartId;
  readonly title: string;
  readonly done: boolean;
}

function hasText(text: string | null): boolean {
  return (text ?? '').trim() !== '';
}

function hasLine(...boxes: ReadonlyArray<readonly string[]>): boolean {
  return boxes.some((lines) => lines.some(hasText));
}

export function profileParts(profile: Profile, cvs: readonly Cv[]): ProfilePart[] {
  const done: Record<ProfilePartId, boolean> = {
    cv: cvs.length > 0,
    about: hasText(profile.headline),
    languages: profile.languages.some((language) => hasText(language.name)),
    wants: hasLine(profile.deal_breakers, profile.target_sectors, profile.career_goals),
    energy: hasLine(profile.energising, profile.draining),
    star: profile.star_examples.some((example) =>
      [example.title, example.situation, example.task, example.action, example.result].some(
        hasText,
      ),
    ),
  };
  return PROFILE_PART_IDS.map((id) => ({ id, title: PART_TITLE[id], done: done[id] }));
}
