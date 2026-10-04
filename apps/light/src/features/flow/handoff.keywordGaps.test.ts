/**
 * L-202: which of the Analysis result's words travel to Tailor, and when they
 * still apply.
 *
 * `keyword_gaps` are words the candidate probably CAN back up but did not
 * write; `missing_skills` are things they cannot do. Only the first kind may
 * reach the Tailor prompt, so a word an AI analysis put in BOTH lists is
 * dropped: it has told us the candidate lacks it.
 */
import { describe, expect, it } from 'vitest';

import { type CvAnalysis } from '@cviper/core-types';

import { EMPTY_ANALYSIS_SESSION, type AnalysisSessionState } from '../analysis/session';
import { gapsForTailor, gapsFromAnalysis, gapsFromSession } from './handoff';

const ADVERT = 'Data analyst. Power BI, dbt and Kubernetes. Stakeholder management.';

function analysis(overrides: Partial<CvAnalysis> = {}): CvAnalysis {
  return {
    matched_skills: ['sql'],
    missing_skills: ['Kubernetes'],
    matched_keywords: ['data'],
    keyword_gaps: ['Power BI', 'dbt', 'stakeholder management'],
    ats_notes: [],
    suggestions: [],
    summary: 'A fair fit.',
    match_score: 64,
    verdict: 'possible',
    ...overrides,
  } as CvAnalysis;
}

function session(overrides: Partial<AnalysisSessionState> = {}): AnalysisSessionState {
  return {
    ...EMPTY_ANALYSIS_SESSION,
    selectedCvId: 'cv-1',
    jobText: ADVERT,
    checkedAdvert: ADVERT,
    result: { analysis: analysis(), provider: 'keyword', model: 'keyword', retried: false },
    ...overrides,
  };
}

describe('gapsFromAnalysis', () => {
  it('happy: carries the keyword gaps with the CV and advert they were found for', () => {
    expect(gapsFromAnalysis(analysis(), 'cv-1', ADVERT)).toEqual({
      cvId: 'cv-1',
      advert: ADVERT,
      gaps: ['Power BI', 'dbt', 'stakeholder management'],
    });
  });

  it('negative: never carries a missing skill, even one the analysis also called a gap', () => {
    const handed = gapsFromAnalysis(
      analysis({
        missing_skills: ['Kubernetes', 'COBOL'],
        keyword_gaps: ['Power BI', 'kubernetes', ' COBOL ', 'dbt'],
      }),
      'cv-1',
      ADVERT,
    );
    expect(handed?.gaps).toEqual(['Power BI', 'dbt']);
  });

  it('negative: no CV, no advert, or no gaps left means nothing to hand over', () => {
    expect(gapsFromAnalysis(analysis(), null, ADVERT)).toBeNull();
    expect(gapsFromAnalysis(analysis(), 'cv-1', null)).toBeNull();
    expect(gapsFromAnalysis(analysis(), 'cv-1', '   ')).toBeNull();
    expect(gapsFromAnalysis(analysis({ keyword_gaps: [] }), 'cv-1', ADVERT)).toBeNull();
    expect(
      gapsFromAnalysis(
        analysis({ keyword_gaps: ['Kubernetes', '  '], missing_skills: ['Kubernetes'] }),
        'cv-1',
        ADVERT,
      ),
    ).toBeNull();
  });
});

describe('gapsFromSession', () => {
  it('happy: a finished result hands over its gaps for the advert it CHECKED', () => {
    // The box was edited after the run: the gaps belong to the checked text.
    const handed = gapsFromSession(session({ jobText: `${ADVERT} Edited.` }));
    expect(handed?.advert).toBe(ADVERT);
    expect(handed?.cvId).toBe('cv-1');
  });

  it('negative: no result yet means no gaps', () => {
    expect(gapsFromSession(session({ result: null, checkedAdvert: null }))).toBeNull();
    expect(gapsFromSession(EMPTY_ANALYSIS_SESSION)).toBeNull();
  });
});

describe('gapsForTailor — do the handed gaps still apply?', () => {
  const handed = gapsFromAnalysis(analysis(), 'cv-1', ADVERT);

  it('happy: same CV, same advert', () => {
    expect(gapsForTailor(handed, 'cv-1', ADVERT)).toEqual([
      'Power BI',
      'dbt',
      'stakeholder management',
    ]);
  });

  it('edge: surrounding whitespace on the advert does not count as a change', () => {
    expect(gapsForTailor(handed, 'cv-1', `\n  ${ADVERT}  \n`)).not.toBeNull();
  });

  it('negative: another CV, or an edited advert, and the gaps no longer describe it', () => {
    expect(gapsForTailor(handed, 'cv-2', ADVERT)).toBeNull();
    expect(gapsForTailor(handed, null, ADVERT)).toBeNull();
    expect(gapsForTailor(handed, 'cv-1', `${ADVERT} Also Tableau.`)).toBeNull();
  });

  it('negative: nothing handed over', () => {
    expect(gapsForTailor(null, 'cv-1', ADVERT)).toBeNull();
    expect(gapsForTailor(undefined, 'cv-1', ADVERT)).toBeNull();
  });
});
