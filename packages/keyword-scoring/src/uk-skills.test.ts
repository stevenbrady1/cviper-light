/**
 * L-282 — the hand-made UK skills list.
 *
 * Every positive case here is paired with the false match it must not make.
 * A false match is worse than a missed one: it tells a candidate they have
 * something they do not, or hides a gap they need to fill.
 */
import { describe, expect, it } from 'vitest';

import { buildCvProfile, buildJobPosting } from './profile';
import { scoreByKeywords } from './score';
import { UK_TERMS, extractUkSkills, impliedUkSkills, readUkTerms } from './uk-skills';
import { SKILL_VOCABULARY } from './vocabulary';

describe('the UK list itself', () => {
  it('loaded, and stays a short hand-reviewed list (spec: under 150 terms)', () => {
    expect(UK_TERMS.length).toBeGreaterThan(40);
    expect(UK_TERMS.length).toBeLessThan(150);
  });

  it('never names a phrase twice, as a label or an alias', () => {
    const all = UK_TERMS.flatMap((t) => [t.label, ...t.aliases].map((s) => s.toLowerCase()));
    const repeated = all.filter((s, i) => all.indexOf(s) !== i);
    expect(repeated).toEqual([]);
  });

  // The upstream vocabulary already scans these. A UK entry for the same words
  // would count one requirement twice, under two names.
  it('never repeats a term the upstream vocabulary already scans', () => {
    const upstream = new Set(SKILL_VOCABULARY);
    const clashes = UK_TERMS.flatMap((t) => [t.label, ...t.aliases])
      .map((s) => s.toLowerCase())
      .filter((s) => upstream.has(s));
    expect(clashes).toEqual([]);
  });

  it('every label is found by its own words, and every alias reports the label', () => {
    for (const term of UK_TERMS) {
      expect(extractUkSkills(`Holds ${term.label}.`)).toContain(term.label);
      for (const alias of term.aliases) {
        expect(extractUkSkills(`Holds ${alias}.`), alias).toContain(term.label);
      }
    }
  });
});

describe('readUkTerms — a bad hand-edit must not take the app down', () => {
  // NEGATIVE
  it.each([null, 42, 'terms', [], { terms: 'x' }])('reads %j as no terms', (data) => {
    expect(readUkTerms(data)).toEqual([]);
  });

  it('drops a malformed row and keeps the good ones', () => {
    const data = {
      terms: [
        { label: 'DBS check', aliases: ['enhanced dbs'] },
        { label: '', aliases: [] },
        { label: 'Food hygiene', aliases: 'food safety' },
        { aliases: ['no label'] },
        { label: 'IPAF', aliases: ['ipaf licence', 7, '  '] },
      ],
    };
    expect(readUkTerms(data)).toEqual([
      { label: 'DBS check', aliases: ['enhanced dbs'], implies: [] },
      { label: 'IPAF', aliases: ['ipaf licence'], implies: [] },
    ]);
  });
});

describe('extractUkSkills', () => {
  it.each([
    ['Enhanced DBS check required', 'DBS check'],
    ['Category C+E (Class 1) licence', 'C+E licence'],
    ['Valid Driver CPC', 'Driver CPC'],
    ['Digital tachograph card', 'Digital tachograph'],
    ['Level 2 Diploma in Health and Social Care (QCF)', 'NVQ Level 2'],
    ['Team Teach trained', 'De-escalation'],
    ['SIA door supervisor badge', 'SIA licence'],
    ['Counterbalance and reach truck licensed', 'Forklift licence'],
  ])('finds %j as %j', (text, label) => {
    expect(extractUkSkills(text)).toContain(label);
  });

  // NEGATIVE — the words that mean something else in another trade.
  it.each([
    ['Hit CPC and CPA targets on paid search', 'Driver CPC'],
    ['Resolved disputes through ADR and mediation', 'ADR licence'],
    ['Taught Class 1 in a village primary', 'C+E licence'],
    ['Sound, sage advice for first-time buyers', 'Sage accounting'],
    ['Opened our first office in Asia', 'SIA licence'],
    ['Built financial literacy workshops', 'Literacy and numeracy'],
    ['In my early years at the firm I ran payroll', 'EYFS'],
    ['Worked as a personal carer', 'Personal care'],
    // plurals.ts strips a trailing s from 4+ letter tokens, so a bare "cpcs"
    // alias read "Driver CPC" as a construction plant card.
    ['Valid Driver CPC', 'CPCS card'],
    ['DB administrator, Postgres', 'DBS check'],
  ])('does not read %j as %j', (text, label) => {
    expect(extractUkSkills(text)).not.toContain(label);
  });

  // NEGATIVE — a C+E licence is not a category C licence, and vice versa.
  it('keeps the two HGV licence classes apart', () => {
    expect(extractUkSkills('Category C+E licence')).not.toContain('C licence');
    expect(extractUkSkills('Category C licence')).not.toContain('C+E licence');
  });

  // BOUNDARY
  it.each(['', '   '])('returns nothing for %j', (text) => {
    expect(extractUkSkills(text)).toEqual([]);
  });

  it('reports each label once however many of its aliases appear', () => {
    expect(extractUkSkills('Enhanced DBS. DBS checked. PVG scheme member.')).toEqual(['DBS check']);
  });

  it('reads past a full stop and a slash (L-275 rules apply)', () => {
    expect(extractUkSkills('Holds a CSCS card/IPAF.')).toContain('IPAF');
  });
});

describe('wired into both sides of the free check', () => {
  it('an advert requirement in UK words becomes a requirement', () => {
    expect(buildJobPosting('Care Assistant\n\nEnhanced DBS check essential.').keySkills).toContain(
      'DBS check',
    );
  });

  it('a CV naming it in different UK words is credited with it', () => {
    expect(
      buildCvProfile('Qualifications: Level 2 Diploma in Health and Social Care, 2021').skills,
    ).toContain('NVQ Level 2');
  });

  it('the upstream vocabulary still comes first and is unchanged', () => {
    const job = buildJobPosting('Analyst\n\nSQL and Excel. Enhanced DBS check.');
    expect(job.keySkills.slice(0, 2)).toEqual(['sql', 'excel']);
  });

  it('a CV with the qualification beats one without it, on that advert', () => {
    const advert =
      'Care Assistant\nLeicester. Full time.\n\nEssential:\n- NVQ Level 2 in care\n' +
      '- Enhanced DBS check\n- Moving and handling\n- Personal care';
    const filler = ' Reliable, punctual, good with people and happy to work weekends.'.repeat(4);
    const withIt = scoreByKeywords(
      'Care worker. Level 2 Diploma in Health and Social Care. Enhanced DBS on the update ' +
        'service. Moving and handling trained. Personal care and continence care.' +
        filler,
      advert,
    );
    const without = scoreByKeywords('Barista. Latte art and opening the shop.' + filler, advert);
    if (!withIt.ok || !without.ok) throw new Error('refused');
    expect(withIt.value.match_score).toBeGreaterThan(without.value.match_score);
    expect(without.value.missing_skills).toContain('DBS Check');
  });
});

/**
 * L-285 — a higher UK qualification counts for the lower one it includes.
 *
 * Only where holding one is impossible without the other (C+E needs C) or
 * where UK adverts treat it as "or above" (NVQ 3 for an NVQ 2 ask). Applied to
 * the CV only: an advert asking for Level 3 does not also ask for Level 2.
 */
describe('implied qualifications (L-285)', () => {
  it('every "implies" names a real label, never itself', () => {
    const labels = new Set(UK_TERMS.map((t) => t.label));
    for (const term of UK_TERMS) {
      for (const implied of term.implies) {
        expect(labels.has(implied), `${term.label} implies unknown ${implied}`).toBe(true);
        expect(implied).not.toBe(term.label);
      }
    }
  });

  it.each([
    ['NVQ Level 3', 'NVQ Level 2'],
    ['C+E licence', 'C licence'],
  ])('%s implies %s', (held, implied) => {
    expect(impliedUkSkills([held])).toEqual([implied]);
  });

  // NEGATIVE — implication runs one way.
  it.each([['NVQ Level 2'], ['C licence'], ['DBS check']])('%s implies nothing', (held) => {
    expect(impliedUkSkills([held])).toEqual([]);
  });

  // BOUNDARY
  it('implies nothing for an empty list, and never repeats a label already held', () => {
    expect(impliedUkSkills([])).toEqual([]);
    expect(impliedUkSkills(['NVQ Level 3', 'NVQ Level 2'])).toEqual([]);
  });

  it('a malformed "implies" is dropped, not thrown', () => {
    expect(readUkTerms({ terms: [{ label: 'X', aliases: [], implies: 'Y' }] })).toEqual([
      { label: 'X', aliases: [], implies: [] },
    ]);
  });

  it('a CV with Level 3 is credited for an advert asking for Level 2', () => {
    const cv = buildCvProfile('Level 3 Diploma in Adult Care, 2024. Care worker, nights.');
    expect(cv.skills).toEqual(expect.arrayContaining(['NVQ Level 3', 'NVQ Level 2']));
  });

  // NEGATIVE — the advert side is never widened.
  it('an advert asking for Level 3 does not also require Level 2', () => {
    const job = buildJobPosting('Senior Carer\n\nEssential: NVQ Level 3 in care.');
    expect(job.keySkills).toContain('NVQ Level 3');
    expect(job.keySkills).not.toContain('NVQ Level 2');
  });

  // NEGATIVE — a negated higher qualification implies nothing (L-283 first).
  it('"No NVQ Level 3" credits neither level', () => {
    const cv = buildCvProfile('No NVQ Level 3 yet. Barista, five years.');
    expect(cv.skills).not.toContain('NVQ Level 3');
    expect(cv.skills).not.toContain('NVQ Level 2');
  });
});
