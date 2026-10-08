// @vitest-environment jsdom
/**
 * L-215 beyond the ATS score: the rail's shortcuts, status dots and request
 * count, the step bar's marks and links, and the Analysis verdict and band
 * each carry their explanation.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { type CvAnalysis } from '@cviper/core-types';

import { AnalysisResult } from '../features/analysis/AnalysisResult';
import { JobStepBar } from '../features/flow/JobStepBar';
import { NO_AI_KEYS } from '../status/environment';

import {
  ATS_BAND_HINT,
  FLOW_HINT,
  RAIL_HINT,
  STEP_HINT,
  VERDICT_HINT,
  shortcutHint,
  statusDotHint,
} from './hints';
import { Sidebar } from './Sidebar';

afterEach(cleanup);

function describedBy(element: Element | null): string | null {
  // The description may sit on the element or on a wrapper around it.
  for (let current = element; current !== null; current = current.parentElement) {
    const id = current.getAttribute('aria-describedby');
    if (id !== null) return document.getElementById(id)?.textContent ?? null;
  }
  return null;
}

describe('the rail', () => {
  function renderRail() {
    render(
      <Sidebar
        activeView="tailor"
        onSelect={() => undefined}
        status={{
          ollama: 'running',
          adzuna: 'missing',
          reed: 'missing',
          ai: { ...NO_AI_KEYS, google: 'configured' },
          requestsToday: 3,
        }}
      />,
    );
  }

  it('each item with a shortcut explains it', () => {
    renderRail();
    const tailor = screen.getByTestId('nav-tailor');
    expect(describedBy(tailor)).toBe(shortcutHint('Tailor', '5'));
  });

  it('negative: an item without a shortcut has no shortcut hint', () => {
    renderRail();
    expect(describedBy(screen.getByTestId('nav-settings'))).toBeNull();
  });

  it('each status dot says what it is and what its colour means', () => {
    renderRail();
    expect(describedBy(screen.getByTestId('status-ollama'))).toBe(
      statusDotHint('Ollama', 'running on this machine'),
    );
  });

  it('"Requests today" explains what it counts', () => {
    renderRail();
    expect(describedBy(screen.getByText('Requests today'))).toBe(RAIL_HINT.requests);
  });

  it('keyboard: focus on a rail item shows its shortcut on screen; Escape hides it', async () => {
    const user = userEvent.setup();
    renderRail();
    const shown = () =>
      screen
        .getAllByRole('tooltip', { hidden: true })
        .filter((tip) => !tip.hidden)
        .map((tip) => tip.textContent);
    await user.click(screen.getByTestId('nav-tailor'));
    expect(shown()).toEqual([shortcutHint('Tailor', '5')]);
    await user.keyboard('{Escape}');
    expect(shown()).toEqual([]);
  });
});

describe('the step bar', () => {
  it('each step explains its mark; the Tracker link and the CV/engine line too', () => {
    render(
      <JobStepBar
        title="Business Analyst"
        company="CMC Markets"
        location="London"
        current="tailor"
        progress={{ analysed: false, tailored: false, exported: false }}
        onStep={() => undefined}
        onTracker={() => undefined}
        choice={{ cv: 'CV.docx', engine: 'Gemini' }}
      />,
    );
    expect(describedBy(screen.getByTestId('job-step-find'))).toBe(STEP_HINT.done);
    expect(describedBy(screen.getByTestId('job-step-analyse'))).toBe(STEP_HINT.skipped);
    expect(describedBy(screen.getByTestId('job-step-tailor'))).toBe(STEP_HINT.current);
    expect(describedBy(screen.getByTestId('job-step-export'))).toBe(STEP_HINT.todo);
    expect(describedBy(screen.getByTestId('job-steps-tracker'))).toBe(FLOW_HINT.tracker);
    expect(describedBy(screen.getByText('CV.docx'))).toBe(FLOW_HINT.choice);
  });
});

describe('Analysis', () => {
  const analysis: CvAnalysis = {
    match_score: 62,
    verdict: 'possible',
    summary: 'Summary.',
    matched_skills: ['SQL'],
    missing_skills: ['AWS'],
    keyword_gaps: ['basel'],
    matched_keywords: ['risk'],
    suggestions: [],
    ats_notes: [],
  };

  it('the verdict badge and the ATS band word say what they mean', () => {
    render(
      <AnalysisResult
        analysis={analysis}
        provider="keyword"
        model="keyword-v3"
        aiAvailable
        atsKeywordScore={54}
      />,
    );
    expect(describedBy(screen.getByText('Possible match'))).toBe(VERDICT_HINT.possible);
    expect(describedBy(screen.getByText('Needs work'))).toBe(ATS_BAND_HINT.low);
  });
});
