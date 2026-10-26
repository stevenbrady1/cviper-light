/**
 * L-291 — how much a basic-match score rests on.
 *
 * A 70 built on two recognised requirements and a 70 built on ten look the
 * same on screen. The label says which. It counts exactly what the score
 * counted (`match.required`), so it can never disagree with the L-287 cap.
 */
import { describe, expect, it } from 'vitest';

import { HIGH_CONFIDENCE_REQUIREMENTS } from './confidence';
import { MIN_REQUIREMENTS_FOR_STRONG, keywordConfidence, scoreByKeywords } from './score';

const CV =
  'Data analyst, five years. SQL, Excel, Power BI, Python, Tableau and statistics for the ' +
  'trading team. Clear written reports for non-technical managers.';

const advertWith = (skills: string[]): string =>
  `Data Analyst\nBristol.\n\nEssential:\n${skills.map((s) => `- ${s}`).join('\n')}`;

describe('keywordConfidence (L-291)', () => {
  it('low below the L-287 threshold, and the score is capped there too', () => {
    const advert = advertWith(['SQL', 'Excel']);
    const confidence = keywordConfidence(CV, advert);
    expect(confidence).toEqual({ level: 'low', requirements: 2 });
    const scored = scoreByKeywords(CV, advert);
    if (!scored.ok) throw new Error('refused');
    expect(scored.value.verdict).not.toBe('strong');
  });

  // BOUNDARY — exactly at each threshold.
  it('medium at exactly the strong threshold', () => {
    const skills = ['SQL', 'Excel', 'Power BI', 'Python', 'Tableau'].slice(
      0,
      MIN_REQUIREMENTS_FOR_STRONG,
    );
    expect(keywordConfidence(CV, advertWith(skills))?.level).toBe('medium');
  });

  it('high at the high threshold', () => {
    const skills = ['SQL', 'Excel', 'Power BI', 'Python', 'Tableau', 'Jira', 'Agile', 'Scrum'];
    const confidence = keywordConfidence(
      CV,
      advertWith(skills.slice(0, HIGH_CONFIDENCE_REQUIREMENTS)),
    );
    expect(confidence?.requirements).toBe(HIGH_CONFIDENCE_REQUIREMENTS);
    expect(confidence?.level).toBe('high');
  });

  it('no recognised requirement is low, with a count of 0', () => {
    expect(keywordConfidence(CV, 'Analyst\n\nJoin our friendly team in Bristol.')).toEqual({
      level: 'low',
      requirements: 0,
    });
  });

  // NEGATIVE — input the scorer refuses gets no label rather than a made-up one.
  it.each([
    ['', advertWith(['SQL'])],
    [CV, ''],
  ])('returns null when the scorer would refuse (%#)', (cv, advert) => {
    expect(keywordConfidence(cv, advert)).toBeNull();
  });
});
