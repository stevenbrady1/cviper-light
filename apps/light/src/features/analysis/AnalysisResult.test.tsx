// @vitest-environment jsdom
/**
 * The result panel — and, specifically, the two things a user could be misled
 * by: where the number came from, and how a skill name is spelled.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type CvAnalysis } from '@cviper/core-types';

import { AnalysisResult } from './AnalysisResult';

afterEach(() => {
  cleanup();
});

/** A result shaped exactly as the KEYWORD scorer produces one, mis-casing included. */
function keywordAnalysis(overrides: Partial<CvAnalysis> = {}): CvAnalysis {
  return {
    match_score: 62,
    verdict: 'possible',
    summary: 'Keyword match only — this compared the words on your CV with the advert.',
    matched_skills: ['Sql', 'Python'],
    missing_skills: ['Aws', 'ci/cd'],
    keyword_gaps: ['impairment', 'basel'],
    matched_keywords: ['risk'],
    suggestions: [
      { section: 'Skills', issue: 'No AWS.', recommendation: 'Name it.', priority: 'high' },
      {
        section: 'Wording',
        issue: 'Missing words.',
        recommendation: 'Reuse theirs.',
        priority: 'low',
      },
      {
        section: 'Job title',
        issue: 'Titles differ.',
        recommendation: 'Mirror it.',
        priority: 'medium',
      },
    ],
    ats_notes: ['Applicant tracking system keyword score: 54 out of 100.'],
    ...overrides,
  };
}

describe('provenance — what produced this number', () => {
  it('tells a user with no AI set up that this was a basic match, and what to do', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Basic match — add an AI key for a full analysis.',
    );
  });

  it('does not tell a user who already has a key to add one', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
      />,
    );

    const provenance = screen.getByTestId('analysis-provenance').textContent ?? '';
    expect(provenance).toContain('Basic match');
    expect(provenance).not.toContain('add an AI key');
  });

  it('names the model on the AI path', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis({ summary: 'A close fit.' })}
        provider="ollama"
        model="llama3.2:3b"
        aiAvailable
      />,
    );

    expect(screen.getByTestId('analysis-provenance').textContent).toContain(
      'Read by Ollama · llama3.2:3b',
    );
  });

  it('never labels an AI reading as a basic match', () => {
    // The failure this prevents is the worse of the two directions: a word
    // count sold as a model's opinion.
    for (const provider of ['ollama', 'anthropic', 'openai']) {
      cleanup();
      render(
        <AnalysisResult analysis={keywordAnalysis()} provider={provider} model="m" aiAvailable />,
      );
      expect(screen.getByTestId('analysis-provenance').textContent).not.toContain('Basic match');
    }
  });

  it('says when the model needed a second attempt', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="ollama"
        model="llama3.2:3b"
        retried
        aiAvailable
      />,
    );

    expect(screen.getByTestId('analysis-provenance').textContent).toContain('asked again');
  });
});

describe('skill names', () => {
  it('renders acronyms the way they are actually written', () => {
    // The inherited defect: the scorer hands over `Sql` and `Aws`. The AI path
    // hands over `SQL`. Both must reach the screen as `SQL`.
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    const matched = within(screen.getByTestId('analysis-matched-skills'));
    expect(matched.getByText('SQL')).toBeTruthy();
    // Not an acronym: left exactly as it came.
    expect(matched.getByText('Python')).toBeTruthy();

    const missing = within(screen.getByTestId('analysis-missing-skills'));
    expect(missing.getByText('AWS')).toBeTruthy();
    expect(missing.getByText('CI/CD')).toBeTruthy();
  });

  it('never shows the mis-cased form anywhere on screen', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    expect(screen.queryByText('Sql')).toBeNull();
    expect(screen.queryByText('Aws')).toBeNull();
  });
});

describe('the sections', () => {
  it('shows the score, the verdict and the summary', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    expect(screen.getByTestId('band-scale-score').textContent).toBe('62');
    expect(screen.getByTestId('analysis-verdict').textContent).toBe('Possible match');
    expect(screen.getByTestId('analysis-summary').textContent).toContain('Keyword match only');
  });

  it('groups suggestions by priority, highest first', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    const items = within(screen.getByTestId('analysis-suggestions')).getAllByRole('listitem');
    expect(items.map((item) => item.dataset['testid'])).toEqual([
      'analysis-suggestion-high',
      'analysis-suggestion-medium',
      'analysis-suggestion-low',
    ]);
  });

  it('boundary: an empty section says so rather than rendering a blank', () => {
    // A heading with nothing under it is indistinguishable from a section that
    // failed to load — and "nothing is missing" is a good result worth stating.
    render(
      <AnalysisResult
        analysis={keywordAnalysis({
          matched_skills: [],
          missing_skills: [],
          keyword_gaps: [],
          suggestions: [],
          ats_notes: [],
        })}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    expect(screen.getByTestId('analysis-missing-skills-empty').textContent).toContain(
      'Nothing the advert asks for is missing',
    );
    expect(screen.getByTestId('analysis-keyword-gaps-empty')).toBeTruthy();
    expect(screen.getByTestId('analysis-suggestions-empty')).toBeTruthy();
    expect(screen.getByTestId('analysis-ats-notes-empty')).toBeTruthy();
  });

  it('boundary: a score of 0 renders as a real result, not as an absent one', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis({ match_score: 0, verdict: 'weak' })}
        provider="keyword"
        model="keyword-v3"
        aiAvailable={false}
      />,
    );

    expect(screen.getByTestId('band-scale-score').textContent).toBe('0');
    expect(screen.getByTestId('analysis-verdict').textContent).toBe('Weak match');
  });
});

describe('layout (L-181)', () => {
  it('lets the score scale grow beside the verdict badge instead of shrinking to its numeral', () => {
    render(
      <AnalysisResult analysis={keywordAnalysis()} provider="ollama" model="qwen" aiAvailable />,
    );
    const holder = screen.getByTestId('band-scale').parentElement;
    expect(holder?.className).toContain('flex-1');
  });

  it('drops the verdict badge below the scale when the row is too narrow for both', () => {
    render(
      <AnalysisResult analysis={keywordAnalysis()} provider="ollama" model="qwen" aiAvailable />,
    );
    const holder = screen.getByTestId('band-scale').parentElement;
    // 18rem (288px) is the narrowest scale whose three labels stay apart:
    // measured, they need about 256px. Below that the row wraps instead.
    expect(holder?.className).toContain('min-w-72');
    expect(holder?.parentElement?.className).toContain('flex-wrap');
  });
});

describe('the ATS keyword number (L-196)', () => {
  it('shows the number and its band beside the match score on a keyword run', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
        atsKeywordScore={54}
      />,
    );

    const ats = screen.getByTestId('analysis-ats-score');
    expect(ats.getAttribute('data-band')).toBe('low');
    expect(screen.getByTestId('analysis-ats-score-value').textContent).toBe('54');
    expect(screen.getByTestId('analysis-ats-band').textContent).toBe('Needs work');
    // The match score is still there, untouched and unaveraged.
    expect(screen.getByTestId('band-scale-score').textContent).toBe('62');
  });

  it('calls it a keyword estimate, not an AI judgement, on a keyword run', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
        atsKeywordScore={54}
      />,
    );

    const source = screen.getByTestId('analysis-ats-source').textContent ?? '';
    expect(source).toContain('keyword estimate');
    expect(source).not.toContain('Claude');
  });

  it('on an AI run, says the number comes from the keyword check and not the AI', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis({ match_score: 81, verdict: 'strong' })}
        provider="ollama"
        model="qwen"
        aiAvailable
        atsKeywordScore={83}
      />,
    );

    expect(screen.getByTestId('analysis-ats-score-value').textContent).toBe('83');
    const source = screen.getByTestId('analysis-ats-source').textContent ?? '';
    expect(source).toContain('keyword check');
    expect(source).toContain('not from the AI');
    // The AI's own match score is shown as the AI gave it.
    expect(screen.getByTestId('band-scale-score').textContent).toBe('81');
  });

  it.each([
    [0, 'low', 'Needs work'],
    [59, 'low', 'Needs work'],
    [60, 'fair', 'Getting there'],
    [79, 'fair', 'Getting there'],
    [80, 'good', 'Reads well'],
    [100, 'good', 'Reads well'],
  ] as const)('boundary: %i falls in the %s band', (score, band, word) => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
        atsKeywordScore={score}
      />,
    );

    expect(screen.getByTestId('analysis-ats-score').getAttribute('data-band')).toBe(band);
    expect(screen.getByTestId('analysis-ats-band').textContent).toBe(word);
  });

  it('old result with no stored number: renders everything else and hides the ATS block', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v2"
        aiAvailable
      />,
    );

    expect(screen.queryByTestId('analysis-ats-score')).toBeNull();
    expect(screen.getByTestId('analysis-result')).toBeTruthy();
    expect(screen.getByTestId('analysis-ats-notes')).toBeTruthy();
  });

  it('negative: a number outside 0-100 or not finite is not drawn', () => {
    for (const bad of [Number.NaN, -1, 101]) {
      const { unmount } = render(
        <AnalysisResult
          analysis={keywordAnalysis()}
          provider="keyword"
          model="keyword-v3"
          aiAvailable
          atsKeywordScore={bad}
        />,
      );
      expect(screen.queryByTestId('analysis-ats-score')).toBeNull();
      unmount();
    }
  });

  it('keeps the block free of rigid widths so it stacks on a phone', () => {
    render(
      <AnalysisResult
        analysis={keywordAnalysis()}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
        atsKeywordScore={70}
      />,
    );
    const block = screen.getByTestId('analysis-ats-score');
    expect(block.className).not.toMatch(/\b(w|min-w)-\d/);
    expect(block.getAttribute('style')).toBeNull();
  });
});
