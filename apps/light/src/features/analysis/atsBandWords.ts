import { type AtsBand } from '@cviper/keyword-scoring';

/**
 * The ATS keyword number's band words (L-196). The tiers are `atsBand`'s - the
 * same 60 and 80 the advice text uses - so the word and the advice agree. Same
 * colour grammar as the match score: nothing is red.
 *
 * Shared by the Analysis result and the Tailor screen's ATS Score step (L-198),
 * so one number never wears two different words on two screens.
 */
export const ATS_BAND_WORD: Record<AtsBand, string> = {
  low: 'Needs work',
  fair: 'Getting there',
  good: 'Reads well',
};

export const ATS_BAND_TONE: Record<AtsBand, string> = {
  low: 'text-ink-muted',
  fair: 'text-gold-ink',
  good: 'text-teal-ink',
};
