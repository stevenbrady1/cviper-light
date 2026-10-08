/**
 * Every hint the app shows, in one place (L-215).
 *
 * One list, so the same mark always means the same thing wherever it
 * appears, and so a reviewer can read every explanation in the app at once.
 * Plain words, a sentence or two each: a hint answers "what does this mark
 * mean" and stops.
 */
import { type AtsCheck, type CheckStatus } from '@cviper/ats-checks';
import { type AtsBand } from '@cviper/keyword-scoring';

import { type StepState } from '../features/flow/steps';

export const ATS_HINT = {
  heading:
    'ATS means applicant tracking system: the software many employers use to read and sort CVs ' +
    'before a person sees them. This checks how well that software can read your CV.',
  before: 'Your original CV, as you uploaded it.',
  after: 'This tailored draft.',
  keyword:
    'How many of the important words in the advert also appear in your CV, out of 100. ' +
    'Screening software looks for these words.',
  bullets:
    'How strong your bullet points are, out of 100. A strong bullet starts with an action verb, ' +
    'shows a result, and includes a number.',
  noScore: 'No score: there was nothing to measure here, for example no bullet points.',
  noChange: 'The same score as your original CV.',
  fabrication:
    'Compares the draft with your original CV. Any employer, year, certification or figure that ' +
    'is not in your original is flagged, because the AI may have made it up.',
  stillMissing:
    'Words from the advert that this draft still does not use. Add one only if it is true for you.',
} as const;

/** The three standard checks, by their id in `@cviper/ats-checks`. */
export const ATS_CHECK_HINT: Readonly<Record<AtsCheck['id'], string>> = {
  section_headers:
    'Whether the CV has the standard headings screening software looks for, such as ' +
    'Experience, Education and Skills.',
  contact_info: 'Whether your email address and phone number are near the top of the CV.',
  cv_length: 'Whether the CV is a sensible length: about 300 to 1,200 words, or one to two pages.',
};

export const ATS_STATUS_HINT: Readonly<Record<CheckStatus, string>> = {
  pass: 'OK: this check passed.',
  warn: 'Check: worth a look. The reason is listed under the table.',
  fail: 'Missing: this needs adding. The reason is listed under the table.',
};

export const ATS_BAND_HINT: Readonly<Record<AtsBand, string>> = {
  low: 'Needs work: under 60 out of 100. Many important advert words are missing from the CV.',
  fair: 'Getting there: 60 to 79 out of 100. Most important advert words are there.',
  good: 'Reads well: 80 or more out of 100. The CV uses the advert’s important words.',
};

/** ▲ / ▼ beside a score. */
export function changeHint(value: number): string {
  return value > 0
    ? `Up ${value} points on your original CV: better.`
    : `Down ${Math.abs(value)} points on your original CV: worse.`;
}

export const STEP_HINT: Readonly<Record<StepState, string>> = {
  done: '✓ Done.',
  current: '● You are on this step now.',
  skipped: '⊘ Skipped: you moved past this step without doing it. You can still go back to it.',
  todo: '○ Not done yet.',
};

export const FLOW_HINT = {
  tracker: 'Back to the tracker board, where this job is saved.',
  choice:
    'The CV and AI engine used for this job. Choose them once: Analysis and Tailor share the choice.',
  cardDots:
    'How far this job has got: one dot for each step — Find, Analyse, Tailor, ATS Score, ' +
    'Export. A filled dot ● is done; an empty one ○ is not.',
  diff: 'Green lines are new in the draft. Struck-through lines were in your original CV and are not in the draft.',
} as const;

export const RAIL_HINT = {
  dots: 'Green: ready to use. Amber: needs attention in Settings. A service that is not set up is not listed.',
  requests:
    'How many requests the app has sent today to job boards, job pages and AI services. ' +
    'Some of them have daily limits or charge per request.',
} as const;

/** A coloured dot in the rail's SET UP list: what it is, and what the colour says. */
export function statusDotHint(label: string, description: string): string {
  return `${label}: ${description}. ${RAIL_HINT.dots}`;
}

export const VERDICT_HINT = {
  strong: 'Strong match: a match score of 75 or more out of 100.',
  possible: 'Possible match: a match score of 60 to 74 out of 100.',
  weak: 'Weak match: a match score under 60 out of 100.',
} as const;

/** "Ctrl 3" beside a rail item. */
export function shortcutHint(label: string, key: string): string {
  return `Keyboard shortcut: hold Ctrl and press ${key} to open ${label}.`;
}
