/**
 * L-346 — `renderTailoredCv`'s optional contact line: an ordinary line under
 * the name, and NOTHING changes for a caller that does not pass one.
 */
import { describe, expect, it } from 'vitest';

import { renderTailoredCv, type TailoredCv } from './tailoring';

const CV: TailoredCv = {
  summary: 'Credit risk analyst with eight years in London banking.',
  key_skills: ['SQL', 'Python'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: '2019 – present',
      bullets: ['Cut IFRS 9 model run time by 40%.'],
    },
  ],
  education: ['BSc Mathematics, University of Manchester, 2016'],
  certifications: [],
};

/** What the renderer printed before L-346, for a CV with no name. */
const WITHOUT_NAME = `PROFESSIONAL SUMMARY
Credit risk analyst with eight years in London banking.

KEY SKILLS
SQL, Python

PROFESSIONAL EXPERIENCE

Senior Credit Risk Analyst
Lloyds Banking Group | London | 2019 – present
- Cut IFRS 9 model run time by 40%.

EDUCATION
BSc Mathematics, University of Manchester, 2016
`;

describe('renderTailoredCv with a contact line (L-346)', () => {
  it('regression: (cv, null) and (cv, null, null) are byte-for-byte what they always were', () => {
    expect(renderTailoredCv(CV, null)).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, null, null)).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, 'Jamie Lewis', null)).toBe(`Jamie Lewis\n\n${WITHOUT_NAME}`);
    expect(renderTailoredCv(CV, 'Jamie Lewis')).toBe(`Jamie Lewis\n\n${WITHOUT_NAME}`);
  });

  it('happy: the line goes straight under the name, then the usual gap', () => {
    expect(renderTailoredCv(CV, 'Jamie Lewis', 'jamie@example.com | 07700 900123')).toBe(
      `Jamie Lewis\njamie@example.com | 07700 900123\n\n${WITHOUT_NAME}`,
    );
  });

  it('edge: a line with no name is still at the top', () => {
    expect(renderTailoredCv(CV, null, 'jamie@example.com')).toBe(
      `jamie@example.com\n\n${WITHOUT_NAME}`,
    );
  });

  it('boundary: a blank line is no line', () => {
    expect(renderTailoredCv(CV, null, '   ')).toBe(WITHOUT_NAME);
    expect(renderTailoredCv(CV, ' ', '')).toBe(WITHOUT_NAME);
  });
});
