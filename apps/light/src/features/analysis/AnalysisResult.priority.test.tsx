// @vitest-environment jsdom
/**
 * The priority label on a suggestion is the shared small label (L-378).
 *
 * It used to be a hand-built span that copied `StatusPill` class for class,
 * except that "Low" used the faint ink. These pin that each priority now draws
 * EXACTLY the shared label for its tone — compared against a `StatusPill`
 * rendered beside it, so a later change to the shared label is followed here
 * rather than fought — with the same words, the same card test ids, and the
 * same grouping, order and count as before.
 *
 * The negative and boundary cases pin what happens TODAY to a suggestion whose
 * priority is not high, medium or low. The schema in `@cviper/core-types`
 * rejects one before it reaches the screen, so this is only reachable from
 * untyped data; the screen leaves such a suggestion out entirely.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type CvAnalysis, type CvAnalysisSuggestion as Suggestion } from '@cviper/core-types';

import { StatusPill, type PillTone } from '../../ui';
import { AnalysisResult } from './AnalysisResult';

afterEach(() => {
  cleanup();
});

const HIGH: Suggestion = {
  section: 'Skills',
  issue: 'No AWS.',
  recommendation: 'Name it.',
  priority: 'high',
};
const MEDIUM: Suggestion = {
  section: 'Job title',
  issue: 'Titles differ.',
  recommendation: 'Mirror it.',
  priority: 'medium',
};
const LOW: Suggestion = {
  section: 'Wording',
  issue: 'Missing words.',
  recommendation: 'Reuse theirs.',
  priority: 'low',
};

function analysis(suggestions: readonly unknown[]): CvAnalysis {
  return {
    match_score: 62,
    verdict: 'possible',
    summary: 'A summary.',
    matched_skills: [],
    missing_skills: [],
    keyword_gaps: [],
    matched_keywords: [],
    // Untyped on purpose: the negative cases feed values the type forbids.
    suggestions: suggestions as Suggestion[],
    ats_notes: [],
  };
}

function show(suggestions: readonly unknown[]): void {
  render(
    <AnalysisResult
      analysis={analysis(suggestions)}
      provider="keyword"
      model="keyword-v3"
      aiAvailable={false}
    />,
  );
}

/** The class list the shared label draws for `tone`, rendered on its own. */
function sharedLabelClasses(tone: PillTone): string {
  const { container, unmount } = render(<StatusPill tone={tone}>x</StatusPill>);
  const classes = (container.firstElementChild as HTMLElement).className;
  unmount();
  return classes;
}

const CASES = [
  { priority: 'high', words: 'Do this first', tone: 'attention', suggestion: HIGH },
  { priority: 'medium', words: 'Worth doing', tone: 'neutral', suggestion: MEDIUM },
  { priority: 'low', words: 'If you have time', tone: 'neutral', suggestion: LOW },
] as const;

describe('the suggestion priority label is the shared small label (L-378)', () => {
  it.each(CASES)(
    'happy: $priority draws the shared $tone label, saying "$words"',
    ({ priority, words, tone, suggestion }) => {
      const expected = sharedLabelClasses(tone);
      show([suggestion]);

      const card = screen.getByTestId(`analysis-suggestion-${priority}`);
      const label = within(card).getByText(words);
      expect(label.className).toBe(expected);
      expect(label.dataset['tone']).toBe(tone);
      // The words and nothing else: no symbol, no hidden text added.
      expect(label.textContent).toBe(words);
    },
  );

  it('"Low" now reads in the muted ink, one step darker than the faint ink it used', () => {
    show([LOW]);
    const label = within(screen.getByTestId('analysis-suggestion-low')).getByText(
      'If you have time',
    );
    expect(label.className.split(' ')).toContain('text-ink-muted');
    expect(label.className.split(' ')).not.toContain('text-ink-faint');
  });

  it('what a screen reader gets is unchanged: each card reads label, section, issue, advice', () => {
    show([LOW, HIGH, MEDIUM]);
    const items = within(screen.getByTestId('analysis-suggestions')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Do this firstSkillsNo AWS.Name it.',
      'Worth doingJob titleTitles differ.Mirror it.',
      'If you have timeWordingMissing words.Reuse theirs.',
    ]);
    // A plain label: no role or name of its own that would be announced.
    for (const item of items) {
      const label = item.querySelector('[data-tone]') as HTMLElement;
      expect(label.tagName).toBe('SPAN');
      expect(label.getAttribute('role')).toBeNull();
      expect(label.getAttribute('aria-label')).toBeNull();
    }
  });

  it('order and count unchanged: grouped high, medium, low, each group in its given order', () => {
    const secondHigh: Suggestion = { ...HIGH, section: 'Summary' };
    const secondLow: Suggestion = { ...LOW, section: 'Layout' };
    show([LOW, HIGH, secondLow, MEDIUM, secondHigh]);

    const items = within(screen.getByTestId('analysis-suggestions')).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.dataset['testid'])).toEqual([
      'analysis-suggestion-high',
      'analysis-suggestion-high',
      'analysis-suggestion-medium',
      'analysis-suggestion-low',
      'analysis-suggestion-low',
    ]);
    expect(items.map((item) => item.querySelectorAll('[data-tone]').length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(
      items.map(
        (item) => within(item).getByText(/^(Skills|Summary|Job title|Wording|Layout)$/).textContent,
      ),
    ).toEqual(['Skills', 'Summary', 'Job title', 'Wording', 'Layout']);
  });

  it('negative: an unknown priority is left out entirely, as today — no card, no label, no fallback', () => {
    show([HIGH, { ...MEDIUM, section: 'Odd', priority: 'urgent' }]);

    const list = screen.getByTestId('analysis-suggestions');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.dataset['testid'])).toEqual(['analysis-suggestion-high']);
    expect(within(list).queryByText('Odd')).toBeNull();
    expect(list.querySelector('[data-testid="analysis-suggestion-urgent"]')).toBeNull();
    // Not drawn as a neutral label either: one label on screen, the high one.
    expect(list.querySelectorAll('[data-tone]')).toHaveLength(1);
  });

  it('boundary: a suggestion with no priority shows no label (it is left out, as today)', () => {
    const { priority: _dropped, ...noPriority } = LOW;
    show([MEDIUM, { ...noPriority, section: 'Unranked' }]);

    const list = screen.getByTestId('analysis-suggestions');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).queryByText('Unranked')).toBeNull();
    expect(within(list).queryByText('If you have time')).toBeNull();
    expect(list.querySelectorAll('[data-tone]')).toHaveLength(1);
  });

  it('known quirk, pinned as it is today (not fixed here): when EVERY suggestion has a bad priority the list is drawn empty, with no "No specific edits" line', () => {
    show([
      { ...HIGH, priority: 'urgent' },
      { ...LOW, priority: undefined },
    ]);

    const list = screen.getByTestId('analysis-suggestions');
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByTestId('analysis-suggestions-empty')).toBeNull();
  });
});
