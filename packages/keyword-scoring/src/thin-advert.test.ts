/**
 * L-287 — a score built on one or two recognised requirements cannot be
 * "strong".
 *
 * Reproduced on the L-281 eval set: the care and charity-shop adverts each
 * yield ONE recognised requirement, so a CV that has it scores 92 "strong" —
 * an all-or-nothing verdict on a single phrase. Steven chose the cap
 * (26 Oct 2026): fewer than three requirements found -> at most 74, the top of
 * "possible", and the summary says why.
 */
import { deriveVerdict } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import advertsJson from './eval/fixtures/adverts.json';
import careGoodCv from './eval/fixtures/cvs/01-good.txt?raw';
import { buildJobPosting } from './profile';
import { MIN_REQUIREMENTS_FOR_STRONG, THIN_ADVERT_SCORE_CAP, scoreByKeywords } from './score';

const filler = ' Reliable, punctual and good with people; happy to work weekends.'.repeat(4);

function score(cv: string, advert: string) {
  const result = scoreByKeywords(cv + filler, advert);
  if (!result.ok) throw new Error(`refused: ${result.error.code}`);
  return result.value;
}

const ONE_REQUIREMENT =
  'Care Assistant (Nights)\nLeicester. Full time.\n\nEssential:\n- NVQ Level 2 in care or equivalent';

describe('the cap (L-287)', () => {
  it('sits at the top of "possible", not in "strong"', () => {
    expect(THIN_ADVERT_SCORE_CAP).toBe(74);
    expect(deriveVerdict(THIN_ADVERT_SCORE_CAP)).toBe('possible');
    expect(deriveVerdict(THIN_ADVERT_SCORE_CAP + 1)).toBe('strong');
    expect(MIN_REQUIREMENTS_FOR_STRONG).toBe(3);
  });

  // The reproduction, on the real eval pair: care advert 01 and its good-fit CV
  // scored 92 "strong" on one recognised requirement before this change.
  const care = advertsJson[0];
  if (care === undefined) throw new Error('eval advert 01 missing');
  const careAdvert =
    `${care.job_title}\n${care.employer}, ${care.location}. ${care.salary}. ${care.contract}.\n\n` +
    `Essential:\n${care.must_have.map((m) => `- ${m}`).join('\n')}\n\n` +
    `Desirable:\n${care.nice_to_have.map((m) => `- ${m}`).join('\n')}`;

  it('eval advert 01 really has only one recognised requirement', () => {
    expect(buildJobPosting(careAdvert).keySkills).toHaveLength(1);
  });

  it('one recognised requirement, fully met: possible, not strong', () => {
    const result = scoreByKeywords(careGoodCv, careAdvert);
    if (!result.ok) throw new Error('refused');
    expect(result.value.match_score).toBe(THIN_ADVERT_SCORE_CAP);
    expect(result.value.verdict).toBe('possible');
  });

  it('says why, in the summary', () => {
    const result = scoreByKeywords(careGoodCv, careAdvert);
    if (!result.ok) throw new Error('refused');
    expect(result.value.summary).toMatch(/only 1 requirement.*capped.*possible/i);
  });

  // BOUNDARY — exactly three requirements is enough to be strong again.
  it('three recognised requirements, all met, can be strong', () => {
    const advert =
      'Care Assistant (Night Shifts)\nLeicester.\n\nEssential:\n- NVQ Level 2 in care\n' +
      '- Moving and handling\n- Dementia care';
    expect(buildJobPosting(advert).keySkills).toHaveLength(MIN_REQUIREMENTS_FOR_STRONG);
    const result = scoreByKeywords(careGoodCv, advert);
    if (!result.ok) throw new Error('refused');
    expect(result.value.match_score).toBeGreaterThan(THIN_ADVERT_SCORE_CAP);
    expect(result.value.verdict).toBe('strong');
    expect(result.value.summary).not.toMatch(/capped/i);
  });

  // NEGATIVE — the cap only ever lowers a score; a low score is untouched.
  it('a poor fit on a thin advert keeps its low score, with no cap note', () => {
    const result = score('Barista. Latte art and opening the shop.', ONE_REQUIREMENT);
    expect(result.match_score).toBeLessThan(THIN_ADVERT_SCORE_CAP);
    expect(result.summary).not.toMatch(/capped/i);
  });

  // BOUNDARY — no recognised requirement at all is the thinnest advert there is.
  // The score then rests on shared words alone, and can reach 95 without a cap.
  it('an advert with no recognised requirement cannot be strong either', () => {
    const advert =
      'Frontend Developer\n\nYou will build the frontend and backend in HTML, CSS and GraphQL, ' +
      'with unit testing.';
    expect(buildJobPosting(advert).keySkills).toEqual([]);
    const result = score(
      'Frontend Developer. HTML, CSS, GraphQL, backend and frontend work, unit testing, ' +
        'Jenkins, Selenium, Linux, Git.',
      advert,
    );
    expect(result.verdict).not.toBe('strong');
    expect(result.summary).toMatch(/no requirement could be recognised.*capped/i);
  });
});
