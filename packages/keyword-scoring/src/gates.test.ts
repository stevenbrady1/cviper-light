/**
 * The two gates that run BEFORE the score (L-156).
 *
 * Every branch in `gates.ts` has a happy, a negative and a boundary case
 * here, because the gate is the one place the app is allowed to say "hard
 * stop" — and a "hard stop" on a false positive is a job the user did not
 * apply for. Silence in either document is never a fail; that rule gets its
 * own tests.
 */
import { describe, expect, it } from 'vitest';

import { type ProfileLanguage } from '@cviper/core-types';

import { runGates, type GateResult } from './gates';

const NONE: readonly ProfileLanguage[] = [];

function eligibility(results: readonly GateResult[]): GateResult {
  const found = results.filter((result) => result.kind === 'eligibility');
  expect(found).toHaveLength(1);
  return found[0] as GateResult;
}

function languages(results: readonly GateResult[]): GateResult[] {
  return results.filter((result) => result.kind === 'language');
}

describe('shape', () => {
  it('always returns exactly one eligibility result and no language result for a silent advert', () => {
    const results = runGates({
      advertText: 'Credit risk analyst. SQL and Python. Hybrid, two days in the office.',
      languages: NONE,
      workRights: null,
    });
    expect(results.filter((result) => result.kind === 'eligibility')).toHaveLength(1);
    expect(languages(results)).toEqual([]);
  });

  // BOUNDARY — nothing to read at all.
  it.each(['', '   \n\t  '])(
    'an empty or whitespace advert (%j) passes eligibility and asks no language',
    (text) => {
      const results = runGates({
        advertText: text,
        languages: NONE,
        workRights: 'Need sponsorship',
      });
      expect(results).toHaveLength(1);
      expect(eligibility(results)).toEqual({
        kind: 'eligibility',
        verdict: 'pass',
        quote: null,
        language: null,
        reason: 'The advert states no citizenship, residency or clearance requirement.',
      });
    },
  );

  it('is deterministic', () => {
    const input = {
      advertText: 'Must be a UK citizen. Fluent Polish is essential.',
      languages: [{ name: 'Polish', level: 'B1' }],
      workRights: 'UK citizen',
    };
    expect(runGates(input)).toEqual(runGates(input));
  });
});

describe('eligibility — what the advert says', () => {
  it.each([
    'Applicants must be a UK citizen.',
    'British citizens only.',
    'US citizenship required for this role.',
    'You must hold indefinite leave to remain or settled status.',
    'Permanent residency is required.',
    'We cannot offer visa sponsorship for this position.',
    'No sponsorship available.',
    'Candidates must have the right to work in the UK without restriction.',
    'You will need to hold or be eligible for SC clearance.',
    'Active DV clearance is essential.',
    'Must be willing to undergo security clearance.',
    'BPSS required before start.',
  ])('flags a silent profile on: %s', (sentence) => {
    const result = eligibility(
      runGates({
        advertText: `Great team. ${sentence} Apply now.`,
        languages: NONE,
        workRights: null,
      }),
    );
    expect(result.verdict).toBe('flag');
    expect(result.quote).toBe(sentence);
    expect(result.reason).toContain('does not say what your work rights are');
  });

  // NEGATIVE — words that look like requirements but are not.
  it.each([
    'We welcome applications from citizens of every country.',
    'Visa sponsorship is available for the right candidate.',
    'Customs clearance experience is a plus.',
    'Our warehouse clearance sale runs all week.',
    'The sc team meets weekly.',
  ])('does not treat "%s" as a requirement', (sentence) => {
    const result = eligibility(
      runGates({ advertText: sentence, languages: NONE, workRights: 'Need sponsorship' }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.quote).toBeNull();
  });

  // BOUNDARY — the quote is capped, and says so.
  it('caps the quoted sentence at 200 characters with an ellipsis', () => {
    const long =
      'Must be a UK citizen because ' + 'this role is regulated and '.repeat(20) + 'so on';
    const result = eligibility(runGates({ advertText: long, languages: NONE, workRights: null }));
    expect(result.quote).not.toBeNull();
    expect(result.quote?.length).toBe(200);
    expect(result.quote?.endsWith('…')).toBe(true);
  });
});

describe('eligibility — against the profile', () => {
  const CITIZEN_ADVERT = 'Detail here. Applicants must be a UK citizen. More detail.';
  const CLEARANCE_ADVERT = 'Detail here. You must be eligible for SC clearance. More detail.';

  it('fails when the profile says sponsorship is needed', () => {
    for (const rights of [
      'Need sponsorship',
      'Tier 2 visa holder',
      'On a Skilled Worker visa',
      'Student visa, would require sponsorship',
    ]) {
      const result = eligibility(
        runGates({ advertText: CITIZEN_ADVERT, languages: NONE, workRights: rights }),
      );
      expect(result.verdict, rights).toBe('fail');
      expect(result.quote).toBe('Applicants must be a UK citizen.');
      expect(result.reason).toContain('sponsorship');
    }
  });

  it('passes a citizenship or residency requirement when the profile holds the right', () => {
    for (const rights of [
      'UK citizen',
      'ILR',
      'Settled status',
      'Right to work, no restrictions',
      'British, no visa needed',
    ]) {
      const result = eligibility(
        runGates({ advertText: CITIZEN_ADVERT, languages: NONE, workRights: rights }),
      );
      expect(result.verdict, rights).toBe('pass');
      expect(result.quote).toBe('Applicants must be a UK citizen.');
    }
  });

  // Clearance is granted, never held by right — a citizen is still only eligible.
  it('still flags a clearance requirement for a citizen', () => {
    const result = eligibility(
      runGates({ advertText: CLEARANCE_ADVERT, languages: NONE, workRights: 'UK citizen' }),
    );
    expect(result.verdict).toBe('flag');
    expect(result.reason).toContain('clearance');
  });

  it('fails a clearance requirement when the profile needs sponsorship', () => {
    const result = eligibility(
      runGates({ advertText: CLEARANCE_ADVERT, languages: NONE, workRights: 'need sponsorship' }),
    );
    expect(result.verdict).toBe('fail');
  });

  // BOUNDARY — a blank profile is silence, not evidence.
  it.each([null, '', '   '])('flags, never fails, when work rights are %j', (rights) => {
    const result = eligibility(
      runGates({ advertText: CITIZEN_ADVERT, languages: NONE, workRights: rights }),
    );
    expect(result.verdict).toBe('flag');
  });

  it('flags a profile whose work rights it cannot read', () => {
    const result = eligibility(
      runGates({ advertText: CITIZEN_ADVERT, languages: NONE, workRights: 'Ask me' }),
    );
    expect(result.verdict).toBe('flag');
    expect(result.reason).toContain('Ask me');
  });

  it('never fails on advert silence, whatever the profile says', () => {
    const result = eligibility(
      runGates({
        advertText: 'A plain advert with no requirements.',
        languages: NONE,
        workRights: 'need sponsorship',
      }),
    );
    expect(result.verdict).toBe('pass');
  });
});

describe('language — what the advert requires', () => {
  const DANISH = [{ name: 'Danish', level: 'Native' }];

  it('a Danish advert requiring fluent Danish passes a native speaker', () => {
    const [result] = languages(
      runGates({
        advertText: 'Fluent Danish is required for this role.',
        languages: DANISH,
        workRights: null,
      }),
    );
    expect(result).toEqual({
      kind: 'language',
      verdict: 'pass',
      language: 'Danish',
      quote: 'Fluent Danish is required for this role.',
      reason: expect.stringContaining('Native') as string,
    });
  });

  it('flags a B1 speaker against a fluent bar', () => {
    const [result] = languages(
      runGates({
        advertText: 'Fluent Danish is required for this role.',
        languages: [{ name: 'danish', level: 'B1' }],
        workRights: null,
      }),
    );
    expect(result?.verdict).toBe('flag');
    expect(result?.reason).toContain('B1');
  });

  it('passes a B1 speaker when the bar is only "required"', () => {
    const [result] = languages(
      runGates({
        advertText: 'Danish is required for this role.',
        languages: [{ name: 'Danish', level: 'B1' }],
        workRights: null,
      }),
    );
    expect(result?.verdict).toBe('pass');
  });

  it('fails a profile that does not list the required language', () => {
    const [result] = languages(
      runGates({
        advertText: 'Fluent Danish is required for this role.',
        languages: [{ name: 'Swedish', level: 'Native' }],
        workRights: null,
      }),
    );
    expect(result?.verdict).toBe('fail');
    expect(result?.quote).toBe('Fluent Danish is required for this role.');
    expect(result?.reason).toContain('does not list');
  });

  // BOUNDARY — an empty profile list is silence, not a missing language.
  it('flags every requirement when the profile lists no languages', () => {
    const results = languages(
      runGates({
        advertText: 'Fluent French and native German are essential.',
        languages: NONE,
        workRights: null,
      }),
    );
    expect(results.map((result) => [result.language, result.verdict])).toEqual([
      ['French', 'flag'],
      ['German', 'flag'],
    ]);
  });

  it('is flag-at-most for a language that is only nice to have', () => {
    for (const advert of [
      'Spanish would be a plus.',
      'Fluent Italian is desirable.',
      'Portuguese is advantageous but not essential.',
    ]) {
      const [result] = languages(
        runGates({ advertText: advert, languages: NONE, workRights: null }),
      );
      expect(result?.verdict, advert).toBe('flag');
      const [absent] = languages(
        runGates({
          advertText: advert,
          languages: [{ name: 'Welsh', level: 'Native' }],
          workRights: null,
        }),
      );
      expect(absent?.verdict, advert).toBe('flag');
    }
  });

  it('a nice-to-have language the profile holds passes', () => {
    const [result] = languages(
      runGates({
        advertText: 'Spanish would be a plus.',
        languages: [{ name: 'Spanish', level: 'C1' }],
        workRights: null,
      }),
    );
    expect(result?.verdict).toBe('pass');
  });

  it('a hard requirement elsewhere in the advert outranks a nice-to-have mention', () => {
    const [result] = languages(
      runGates({
        advertText: 'German is a plus. Later on: fluent German is essential for client calls.',
        languages: NONE,
        workRights: null,
      }),
    );
    expect(result?.quote).toBe('Later on: fluent German is essential for client calls.');
  });

  // NEGATIVE — a language named without a bar is not a requirement.
  it.each([
    'All documentation is in English.',
    'You will work with our Polish office.',
    'The team speaks French over lunch.',
  ])('does not require a language from "%s"', (advert) => {
    expect(languages(runGates({ advertText: advert, languages: NONE, workRights: null }))).toEqual(
      [],
    );
  });

  // NEGATIVE — "polish" the verb, capitalised or not, with or without a bar word.
  it.each([
    'You must polish the deliverables before handover.',
    'Polish the deliverables — this is essential.',
    'polish your writing until it is fluent.',
  ])('does not mistake the verb in "%s" for the language', (advert) => {
    expect(languages(runGates({ advertText: advert, languages: NONE, workRights: null }))).toEqual(
      [],
    );
  });

  it('reads an all-caps requirement', () => {
    const [result] = languages(
      runGates({ advertText: 'FLUENT POLISH REQUIRED.', languages: NONE, workRights: null }),
    );
    expect(result?.language).toBe('Polish');
  });

  it('returns one result per language, in advert order, across sentences', () => {
    const results = languages(
      runGates({
        advertText:
          'Native Japanese required. Business-level Korean essential. Japanese again: must be fluent.',
        languages: NONE,
        workRights: null,
      }),
    );
    expect(results.map((result) => result.language)).toEqual(['Japanese', 'Korean']);
  });

  it('never touches the eligibility result', () => {
    const results = runGates({
      advertText: 'Fluent Polish is essential.',
      languages: NONE,
      workRights: 'need sponsorship',
    });
    expect(eligibility(results).verdict).toBe('pass');
    expect(languages(results)).toHaveLength(1);
  });
});
