/**
 * L-289 — a skill an advert only calls "desirable" is not a requirement.
 *
 * Every recognised skill used to count as required, so missing a nice-to-have
 * cost exactly as much as missing an essential. The scorer already supports an
 * essentials list (`match.ts`: required = essentialSkills when present); this
 * fills it from the advert's own words. A skill found ONLY in a desirable part
 * of the advert is left out; everything else stays required, exactly as before.
 */
import { describe, expect, it } from 'vitest';

import { splitDesirable } from './desirable';
import advertsJson from './eval/fixtures/adverts.json';
import customerServiceGoodCv from './eval/fixtures/cvs/05-good.txt?raw';
import { buildJobPosting } from './profile';
import { scoreByKeywords } from './score';

const ADVERT =
  'Data Analyst\nBristol. Full time.\n\nEssential:\n- SQL\n- Excel\n- Power BI\n\n' +
  'Desirable:\n- Tableau\n- Python';

describe('splitDesirable', () => {
  it('puts a Desirable section in the desirable half', () => {
    const { desirable, rest } = splitDesirable(ADVERT);
    expect(desirable).toContain('Tableau');
    expect(desirable).toContain('Python');
    expect(rest).toContain('SQL');
    expect(rest).not.toContain('Tableau');
  });

  it.each([
    'Desirable:',
    'Desirable criteria',
    'Desirable skills and experience:',
    'Nice to have:',
    'Nice-to-have',
    'It would be great if you have:',
    'Bonus points for:',
  ])('recognises the heading %j', (heading) => {
    const { desirable } = splitDesirable(`Analyst\n\nEssential:\n- SQL\n\n${heading}\n- Tableau`);
    expect(desirable).toContain('Tableau');
  });

  it('a later Essential heading ends the desirable section', () => {
    const { rest } = splitDesirable('Nice to have:\n- Tableau\n\nEssential:\n- SQL');
    expect(rest).toContain('SQL');
  });

  it('reads an inline marker on one line', () => {
    const { desirable, rest } = splitDesirable(
      'Requirements:\n- SQL\n- Tableau (desirable)\n- Python would be an advantage',
    );
    expect(desirable).toContain('Tableau');
    expect(desirable).toContain('Python');
    expect(rest).toContain('SQL');
  });

  it('reads "Desirable: x, y" on the heading line itself', () => {
    expect(splitDesirable('Essential: SQL\nDesirable: Tableau, Python').desirable).toContain(
      'Tableau',
    );
  });

  // NEGATIVE — no marker, no split: the whole advert is "rest", as before.
  it('an advert with no desirable marker is all rest', () => {
    const text = 'Analyst\n\nYou will use SQL, Excel and Tableau every day.';
    expect(splitDesirable(text)).toEqual({ desirable: '', rest: text });
  });

  // NEGATIVE — words that look like markers but are not about a skill.
  it.each(['Preferred start date: January', 'An advantageous pension scheme'])(
    '%j is not a desirable marker',
    (line) => {
      expect(splitDesirable(`Analyst\n${line}\n- SQL`).desirable).toBe('');
    },
  );
});

describe('the advert side (buildJobPosting)', () => {
  it('a desirable-only skill is recognised, but not required', () => {
    const job = buildJobPosting(ADVERT);
    expect(job.keySkills).toEqual(expect.arrayContaining(['sql', 'excel', 'tableau']));
    expect(job.essentialSkills).toEqual(expect.arrayContaining(['sql', 'excel', 'power bi']));
    expect(job.essentialSkills).not.toContain('tableau');
  });

  it('a skill listed as both essential and desirable stays essential', () => {
    const job = buildJobPosting(
      'Analyst\n\nEssential:\n- SQL\n- Excel\n\nDesirable:\n- Advanced SQL\n- Tableau',
    );
    expect(job.essentialSkills).toEqual(expect.arrayContaining(['sql', 'excel']));
    expect(job.essentialSkills).not.toContain('tableau');
  });

  // NEGATIVE — no markers: essentials stay empty, so match.ts falls back to
  // every recognised skill, exactly as before L-289.
  it('an advert with no markers is unchanged', () => {
    const job = buildJobPosting('Analyst\n\nYou will use SQL, Excel and Tableau every day.');
    expect(job.essentialSkills).toEqual([]);
  });

  // BOUNDARY — if every skill is desirable, nothing is essential and the
  // fallback keeps them all as requirements rather than scoring against none.
  it('an advert whose skills are all desirable keeps them as requirements', () => {
    const job = buildJobPosting('Analyst\n\nDesirable:\n- SQL\n- Excel');
    expect(job.essentialSkills).toEqual([]);
    expect(job.keySkills).toEqual(expect.arrayContaining(['sql', 'excel']));
  });
});

describe('the score', () => {
  const cvWithEssentials =
    'Data analyst, five years. SQL every day, Excel models, Power BI dashboards for the ' +
    'finance team. Clear written reports for non-technical managers.';

  it('meeting every essential, no desirables: no desirable is listed as missing', () => {
    const scored = scoreByKeywords(cvWithEssentials, ADVERT);
    if (!scored.ok) throw new Error('refused');
    expect(scored.value.missing_skills).not.toContain('Tableau');
    expect(scored.value.missing_skills).not.toContain('Python');
  });

  it('scores higher than when the same skills were all required', () => {
    const allRequired = ADVERT.replace('Desirable:', 'Also essential:');
    const withSplit = scoreByKeywords(cvWithEssentials, ADVERT);
    const without = scoreByKeywords(cvWithEssentials, allRequired);
    if (!withSplit.ok || !without.ok) throw new Error('refused');
    expect(withSplit.value.match_score).toBeGreaterThan(without.value.match_score);
  });

  // A desirable the CV HAS still counts: having a nice-to-have helps, lacking
  // one costs nothing. Reproduced on eval advert 05, where the good fit has the
  // desirable "cash handling" and dropped 49 -> 35 when desirables were simply
  // removed from the requirements.
  it('a desirable the CV has still raises the score', () => {
    const cv = cvWithEssentials + ' Comfortable with Tableau for client-facing dashboards.';
    const withIt = scoreByKeywords(cv, ADVERT);
    const without = scoreByKeywords(cvWithEssentials, ADVERT);
    if (!withIt.ok || !without.ok) throw new Error('refused');
    expect(withIt.value.match_score).toBeGreaterThanOrEqual(without.value.match_score);
    expect(withIt.value.matched_skills).toContain('Tableau');
  });

  // BOUNDARY — never lower than scoring every skill as required, for any mix.
  it.each([
    ['all essentials, no desirables', ''],
    ['all essentials, one desirable', ' Tableau dashboards.'],
    ['all essentials, both desirables', ' Tableau dashboards and Python scripts.'],
  ])('%s: never lower than with everything required', (_label, extra) => {
    const cv = cvWithEssentials + extra;
    const split = scoreByKeywords(cv, ADVERT);
    const all = scoreByKeywords(cv, ADVERT.replace('Desirable:', 'Also essential:'));
    if (!split.ok || !all.ok) throw new Error('refused');
    expect(split.value.match_score).toBeGreaterThanOrEqual(all.value.match_score);
  });

  // The real reproduction: eval advert 05 (customer service). Its good-fit
  // CV meets one essential and HAS the desirable "cash handling". Removing
  // desirables outright dropped it 49 -> 35; counting a desirable the CV has
  // keeps it at least where it was with everything required.
  it('eval 05: the good fit never scores lower than with everything required', () => {
    const a = advertsJson[4];
    if (a === undefined) throw new Error('eval advert 05 missing');
    const text =
      `${a.job_title}\n${a.employer}, ${a.location}. ${a.salary}. ${a.contract}.\n\n` +
      `Essential:\n${a.must_have.map((m) => `- ${m}`).join('\n')}\n\n` +
      `Desirable:\n${a.nice_to_have.map((m) => `- ${m}`).join('\n')}`;
    const split = scoreByKeywords(customerServiceGoodCv, text);
    const all = scoreByKeywords(
      customerServiceGoodCv,
      text.replace('Desirable:', 'Also essential:'),
    );
    if (!split.ok || !all.ok) throw new Error('refused');
    expect(split.value.match_score).toBeGreaterThanOrEqual(all.value.match_score);
    expect(split.value.matched_skills).toContain('Cash Handling');
  });
});
