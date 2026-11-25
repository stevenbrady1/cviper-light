// @vitest-environment jsdom
/**
 * The last labels are words in Inter, not small mono capitals (L-456).
 *
 * L-432 moved the Tracker's labels and listed eight more in
 * `monoCapitals.contract.test.ts`. These render those eight, so the proof is
 * the class a user's screen gets, not only the source text. The numbers beside
 * them stay mono: that is a different decision and not part of this one.
 */
import { type CvAnalysis } from '@cviper/core-types';
import { type GateResult } from '@cviper/keyword-scoring';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnalysisResult } from '../features/analysis/AnalysisResult';
import { BandScale } from '../features/analysis/BandScale';
import { GateNotice } from '../features/analysis/GateNotice';
import { type Availability } from '../features/analysis/providers';
import { ResultCard } from '../features/search/ResultCard';
import { REED_DAY_RATE, entry } from '../features/search/test/fixtures';
import { AtsStep } from '../features/tailor/AtsStep';
import { InterviewPanel } from '../features/tracker/InterviewPanel';
import { NewApplicationForm } from '../features/tracker/NewApplicationForm';
import { createEntry, EMPTY_DRAFT } from '../features/tracker/model';
import { createFakeTrackerPort } from '../features/tracker/test/fakePort';

afterEach(cleanup);

function expectInter(element: Element | null, text: string): void {
  expect(element?.textContent).toBe(text);
  const classes = element?.className ?? '';
  expect(classes).not.toMatch(/(?<![\w-])font-mono(?![\w-])/);
  expect(classes).not.toMatch(/(?<![\w-])uppercase(?![\w-])/);
  expect(classes).not.toMatch(/tracking-\[/);
  expect(classes).toContain('text-xs');
}

const ANALYSIS: CvAnalysis = {
  match_score: 62,
  verdict: 'possible',
  summary: 'Keyword match only.',
  matched_skills: ['Sql'],
  missing_skills: ['Aws'],
  keyword_gaps: ['impairment'],
  matched_keywords: ['risk'],
  suggestions: [
    { section: 'Skills', issue: 'No AWS.', recommendation: 'Name it.', priority: 'high' },
  ],
  ats_notes: ['Applicant tracking system keyword score: 54 out of 100.'],
};

const COMPARISON = {
  keyword: { before: 50, after: 47, delta: -3, beforeReason: null, afterReason: null },
  bullets: { before: 0, after: 30, delta: 30, totalBefore: 0, totalAfter: 5 },
  checks: [],
  stillMissing: [],
  wordsAfter: 640,
};

const CARD = {
  today: '2026-09-29',
  clusterSize: null,
  tracked: false,
  busy: false,
  note: null,
  problem: null,
  rank: null,
  dealBreakers: [],
};

describe('the eight labels are Inter, normal case', () => {
  it('the Analysis result headings', () => {
    render(
      <AnalysisResult analysis={ANALYSIS} provider="keyword" model="keyword-v3" aiAvailable />,
    );
    for (const name of ['What you have', 'What to change']) {
      expectInter(screen.getByRole('heading', { name }), name);
    }
  });

  it('the match-scale band names', () => {
    render(<BandScale score={62} verdict="possible" />);
    expectInter(screen.getByTestId('band-scale-label-weak'), 'Weak');
    expectInter(screen.getByTestId('band-scale-label-possible'), 'Possible');
    expectInter(screen.getByTestId('band-scale-label-strong'), 'Strong');
  });

  it('the cloud-check notice heading', () => {
    const language: GateResult = {
      kind: 'language',
      verdict: 'fail',
      quote: 'Fluent German is essential.',
      language: 'German',
      reason: 'The advert requires German.',
    };
    render(<GateNotice results={[language]} />);
    expectInter(
      within(screen.getByTestId('analysis-gates')).getByRole('heading', { level: 3 }),
      'Language: German',
    );
  });

  it('the ATS step heading', () => {
    render(<AtsStep comparison={COMPARISON} fabrication={{ clean: true, flagged: 0 }} />);
    expectInter(document.getElementById('tailor-ats-heading'), 'ATS score');
  });

  it('the interview panel heading', () => {
    const availability: Availability = {
      ollamaRunning: true,
      ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
      anthropicKey: false,
      openaiKey: false,
    };
    const tracked = createEntry(
      { ...EMPTY_DRAFT, title: 'Analyst', company: 'Lloyds', description: 'Credit risk.' },
      { jobId: 'job-1', applicationId: 'app-1' },
      '2026-09-01T09:00:00.000Z',
    );
    render(
      <InterviewPanel
        entry={tracked}
        port={createFakeTrackerPort([tracked])}
        availability={availability}
        createTransport={vi.fn()}
        now={new Date(2026, 8, 14, 9, 0, 0)}
      />,
    );
    expectInter(screen.getByRole('heading', { name: 'Interview' }), 'Interview');
  });

  it('the new-application form label', () => {
    render(<NewApplicationForm onCreate={vi.fn()} onCancel={vi.fn()} />);
    expectInter(screen.getByText('From the advert'), 'From the advert');
  });

  it('the search result source chip, plain and as a link', () => {
    const props = { ...CARD, onSave: vi.fn(), onOpen: vi.fn() };
    render(<ResultCard entry={REED_DAY_RATE} {...props} />);
    expectInter(screen.getByTestId(`result-source-${REED_DAY_RATE.job.id}`), 'Reed');
    cleanup();

    const adzuna = entry({ id: 'job-az', source: 'adzuna', external_id: '1' });
    render(<ResultCard entry={adzuna} {...props} onOpenSource={vi.fn()} />);
    const link = screen.getByTestId('result-source-job-az');
    expect(link.tagName).toBe('BUTTON');
    expectInter(link, 'Adzuna');
    // The source's terms ask for a link of at least 116 x 23 pixels.
    expect(link.className).toContain('min-w-[116px]');
    expect(link.className).toContain('min-h-[23px]');
    expect(link.className).toContain('underline');
  });
});

describe('numbers beside the labels stay mono (not part of this change)', () => {
  it('a salary on a result card', () => {
    render(<ResultCard entry={REED_DAY_RATE} {...CARD} onSave={vi.fn()} onOpen={vi.fn()} />);
    const salary = screen.getByTestId(`result-salary-${REED_DAY_RATE.job.id}`);
    expect(salary.className).toContain('font-mono');
    expect(salary.className).toContain('tabular-nums');
  });

  it('the ATS score numbers', () => {
    render(<AtsStep comparison={COMPARISON} fabrication={{ clean: true, flagged: 0 }} />);
    const numbers = screen.getByTestId('tailor-ats').querySelectorAll('span.font-mono');
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect(number.className).toContain('tabular-nums');
  });
});

describe('boundary: the band words', () => {
  it('read exactly Weak, Possible, Strong, from the lowest score', () => {
    render(<BandScale score={0} verdict="weak" />);
    const words = ['weak', 'possible', 'strong'].map(
      (verdict) => screen.getByTestId(`band-scale-label-${verdict}`).textContent,
    );
    expect(words).toEqual(['Weak', 'Possible', 'Strong']);
  });
});
