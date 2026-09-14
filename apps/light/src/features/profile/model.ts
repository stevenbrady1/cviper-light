/**
 * The profile view's rules, with no React in sight.
 *
 * ============================================================================
 * ONE ITEM PER LINE
 * ============================================================================
 * The list fields — deal breakers, target sectors, career goals, what
 * energises, what drains — are `string[]` in the data model and ONE TEXTAREA
 * each on screen. A row of chips with an add button per list is five more
 * controls to learn for something a person already knows how to do: press
 * Enter. So the textarea holds one item per line, and these two functions are
 * the whole conversion.
 *
 * Trimming and dropping blank lines happens HERE, on the way from the box to
 * the model, and nowhere else. The schema (`ProfileSchema`) is about shape and
 * deliberately does not edit what it stores; a backup written by another
 * producer keeps its own whitespace.
 */
import { type Profile, type ProfileLanguage, type StarExample } from '@cviper/core-types';

/** Textarea text -> list. Each line trimmed; empty lines dropped. */
export function linesToList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** List -> textarea text, one item per line. */
export function listToLines(items: readonly string[]): string {
  return items.join('\n');
}

/** `''` from an input means "nothing here", and the model spells that `null`. */
export function textOrNull(value: string): string | null {
  const text = value.trim();
  return text === '' ? null : text;
}

export const EMPTY_LANGUAGE: ProfileLanguage = { name: '', level: '' };

export const EMPTY_STAR_EXAMPLE: StarExample = {
  title: '',
  situation: '',
  task: '',
  action: '',
  result: '',
};

/** Trim every string in a patch, so what is stored is what was meant. */
function trimmed<T extends Record<string, string>>(patch: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (typeof value === 'string') out[key] = value.trim() as T[keyof T];
  }
  return out;
}

// --- Languages --------------------------------------------------------------
//
// Rows are addressed by index. Every function returns a NEW profile and leaves
// the one it was given alone; an index that names no row returns the profile
// unchanged rather than throwing, because a remove button that outlived its
// row is a race, not a bug worth crashing over.

export function addLanguage(profile: Profile): Profile {
  return { ...profile, languages: [...profile.languages, { ...EMPTY_LANGUAGE }] };
}

export function withLanguage(
  profile: Profile,
  index: number,
  patch: Partial<ProfileLanguage>,
): Profile {
  if (profile.languages[index] === undefined) return profile;
  return {
    ...profile,
    languages: profile.languages.map((language, at) =>
      at === index ? { ...language, ...trimmed(patch) } : language,
    ),
  };
}

export function removeLanguage(profile: Profile, index: number): Profile {
  if (profile.languages[index] === undefined) return profile;
  return { ...profile, languages: profile.languages.filter((_, at) => at !== index) };
}

// --- STAR examples ----------------------------------------------------------

export function addStarExample(profile: Profile): Profile {
  return { ...profile, star_examples: [...profile.star_examples, { ...EMPTY_STAR_EXAMPLE }] };
}

export function withStarExample(
  profile: Profile,
  index: number,
  patch: Partial<StarExample>,
): Profile {
  if (profile.star_examples[index] === undefined) return profile;
  return {
    ...profile,
    star_examples: profile.star_examples.map((example, at) =>
      at === index ? { ...example, ...trimmed(patch) } : example,
    ),
  };
}

export function removeStarExample(profile: Profile, index: number): Profile {
  if (profile.star_examples[index] === undefined) return profile;
  return { ...profile, star_examples: profile.star_examples.filter((_, at) => at !== index) };
}
