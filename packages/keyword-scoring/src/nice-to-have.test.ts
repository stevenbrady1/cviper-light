/**
 * L-292 — the desirables a CV lacks, for the screen to list separately.
 *
 * L-289 rightly stopped them costing anything, and so stopped listing them as
 * missing. A user should still be told: "nice to have, not on your CV" is
 * useful, it just is not a gap.
 */
import { describe, expect, it } from 'vitest';

import { missingNiceToHaves, scoreByKeywords } from './score';

const ADVERT =
  'Data Analyst\nBristol. Full time.\n\nEssential:\n- SQL\n- Excel\n- Power BI\n\n' +
  'Desirable:\n- Tableau\n- Python';
const CV =
  'Data analyst, five years. SQL every day, Excel models, Power BI dashboards and Python ' +
  'scripts for the finance team. Clear written reports for non-technical managers.';

describe('missingNiceToHaves (L-292)', () => {
  it('lists the desirables the CV lacks, spelled for the screen', () => {
    expect(missingNiceToHaves(CV, ADVERT)).toEqual(['Tableau']);
  });

  // NEGATIVE — a desirable the CV has is not listed; an essential never is.
  it('never lists one the CV has, or an essential', () => {
    const list = missingNiceToHaves(CV, ADVERT);
    expect(list).not.toContain('Python');
    expect(list).not.toContain('SQL');
  });

  it('does not overlap the missing-skills list', () => {
    const scored = scoreByKeywords(
      'Shop assistant, five years of customer service and stock.',
      ADVERT,
    );
    if (!scored.ok) throw new Error('refused');
    const nice = missingNiceToHaves(
      'Shop assistant, five years of customer service and stock.',
      ADVERT,
    );
    expect(nice).toEqual(expect.arrayContaining(['Tableau', 'Python']));
    for (const n of nice) expect(scored.value.missing_skills).not.toContain(n);
  });

  // NEGATIVE — no desirable marker, nothing to list.
  it('is empty for an advert that marks nothing desirable', () => {
    expect(missingNiceToHaves(CV, 'Analyst\n\nYou will use SQL, Excel and Tableau daily.')).toEqual(
      [],
    );
  });

  // BOUNDARY — input the scorer refuses.
  it.each([
    ['', ADVERT],
    [CV, ''],
  ])('is empty when the scorer would refuse (%#)', (cv, advert) => {
    expect(missingNiceToHaves(cv, advert)).toEqual([]);
  });
});
