/**
 * L-205: the pure half of metric prompting — gaps in, questions out; typed
 * text and approval in, the approved facts out. No React here.
 *
 * The contract: NOTHING typed leaves this module unless it was explicitly
 * approved, and the question never carries an example number.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_METRIC_STATE,
  MAX_METRIC_CHARS,
  approve,
  approvedMetrics,
  canApprove,
  cleanedOnApproval,
  dismiss,
  metricPromptsForGaps,
  reopen,
  metricsChanged,
  setDraft,
  stillApproved,
} from './metricPrompts';

const prompts = metricPromptsForGaps(['Power BI', 'dbt']);

describe('metricPromptsForGaps', () => {
  it('happy: one prompt per gap, with the exact sentence', () => {
    expect(prompts.map((p) => p.question)).toEqual([
      'We found a keyword/skill gap for Power BI. Do you have a quantifiable achievement or metric to add?',
      'We found a keyword/skill gap for dbt. Do you have a quantifiable achievement or metric to add?',
    ]);
    expect(prompts.map((p) => p.skill)).toEqual(['Power BI', 'dbt']);
  });

  it('negative: no gaps, no prompts (null, undefined, empty, blank)', () => {
    expect(metricPromptsForGaps(null)).toEqual([]);
    expect(metricPromptsForGaps(undefined)).toEqual([]);
    expect(metricPromptsForGaps([])).toEqual([]);
    expect(metricPromptsForGaps(['  ', ''])).toEqual([]);
  });

  it('boundary: duplicate skills (any case, extra spaces) get one prompt', () => {
    const got = metricPromptsForGaps(['Power BI', 'power  bi', ' POWER BI ']);
    expect(got).toHaveLength(1);
    expect(got[0]?.skill).toBe('Power BI');
  });

  it('never suggests a number: the question carries no digit but the skill own', () => {
    for (const p of prompts) expect(p.question).not.toMatch(/\d|%|£|\$/);
  });
});

describe('approval state', () => {
  const [bi, dbt] = prompts as [(typeof prompts)[number], (typeof prompts)[number]];

  it('happy: typed then approved text is returned, with its skill', () => {
    let state = setDraft(EMPTY_METRIC_STATE, bi.key, 'Cut reporting from 5 days to 2');
    state = approve(state, bi.key);
    expect(approvedMetrics(state, prompts)).toEqual([
      { skill: 'Power BI', text: 'Cut reporting from 5 days to 2' },
    ]);
  });

  it('negative: typed but not approved is excluded', () => {
    const state = setDraft(EMPTY_METRIC_STATE, bi.key, 'Cut reporting from 5 days to 2');
    expect(approvedMetrics(state, prompts)).toEqual([]);
  });

  it('negative: dismissed is excluded, even if it was approved first', () => {
    let state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, 'Saved 3 hours'), bi.key);
    state = dismiss(state, bi.key);
    expect(approvedMetrics(state, prompts)).toEqual([]);
  });

  it('negative: empty and whitespace-only input cannot be approved', () => {
    expect(canApprove('')).toBe(false);
    expect(canApprove('   \n\t ')).toBe(false);
    expect(canApprove('Saved 3 hours')).toBe(true);
    const state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, '   '), bi.key);
    expect(approvedMetrics(state, prompts)).toEqual([]);
    expect(approve(EMPTY_METRIC_STATE, bi.key)).toEqual(EMPTY_METRIC_STATE);
  });

  it('editing an approved entry withdraws the approval until it is approved again', () => {
    let state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, 'Saved 3 hours'), bi.key);
    state = setDraft(state, bi.key, 'Saved 30 hours');
    expect(approvedMetrics(state, prompts)).toEqual([]);
    state = approve(state, bi.key);
    expect(approvedMetrics(state, prompts)[0]?.text).toBe('Saved 30 hours');
  });

  it('reopen withdraws an approval and keeps the draft', () => {
    let state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, 'Saved 3 hours'), bi.key);
    state = reopen(state, bi.key);
    expect(approvedMetrics(state, prompts)).toEqual([]);
    expect(state.get(bi.key)?.draft).toBe('Saved 3 hours');
  });

  it('boundary: very long input is cut to MAX_METRIC_CHARS on approval', () => {
    const state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, 'x'.repeat(10_000)), bi.key);
    expect(approvedMetrics(state, prompts)[0]?.text).toHaveLength(MAX_METRIC_CHARS);
  });

  it('boundary: whitespace is collapsed and trimmed on approval', () => {
    const state = approve(setDraft(EMPTY_METRIC_STATE, bi.key, '  Saved \n 3   hours '), bi.key);
    expect(approvedMetrics(state, prompts)[0]?.text).toBe('Saved 3 hours');
  });

  it('boundary: only entries for gaps still on screen are returned', () => {
    const state = approve(setDraft(EMPTY_METRIC_STATE, dbt.key, 'Migrated 40 models'), dbt.key);
    expect(approvedMetrics(state, metricPromptsForGaps(['Power BI']))).toEqual([]);
    expect(approvedMetrics(state, prompts)).toHaveLength(1);
  });

  it('boundary: duplicate skills share one entry, so one metric goes out once', () => {
    const dup = metricPromptsForGaps(['dbt', 'DBT']);
    const state = approve(
      setDraft(EMPTY_METRIC_STATE, dup[0]!.key, 'Migrated 40 models'),
      dup[0]!.key,
    );
    expect(approvedMetrics(state, dup)).toHaveLength(1);
  });

  it('does not mutate the previous state', () => {
    const before = setDraft(EMPTY_METRIC_STATE, bi.key, 'a');
    approve(before, bi.key);
    expect(before.get(bi.key)?.status).toBe('editing');
  });
});

describe('what is shown approved is exactly what is sent (C6)', () => {
  const [p] = metricPromptsForGaps(['Murex']) as [ReturnType<typeof metricPromptsForGaps>[number]];
  const typed = 'Migrated Trading System: Murex, cut latency 40%';

  it('approval stores the cleaned text, so the screen shows what the model gets', () => {
    const state = approve(setDraft(EMPTY_METRIC_STATE, p.key, typed), p.key);
    const shown = state.get(p.key)?.draft;
    expect(shown).not.toMatch(/system\s*:/i);
    expect(shown).toContain('cut latency 40%');
    expect(approvedMetrics(state, [p])[0]?.text).toBe(shown);
  });

  it('says so when cleaning changed the text, and not when it did not', () => {
    const changed = approve(setDraft(EMPTY_METRIC_STATE, p.key, typed), p.key);
    expect(cleanedOnApproval(changed, p.key)).toBe(true);
    const same = approve(setDraft(EMPTY_METRIC_STATE, p.key, 'Cut latency 40%'), p.key);
    expect(cleanedOnApproval(same, p.key)).toBe(false);
    expect(cleanedOnApproval(EMPTY_METRIC_STATE, p.key)).toBe(false);
  });

  it('negative: text that cleans to nothing cannot be approved', () => {
    const state = approve(setDraft(EMPTY_METRIC_STATE, p.key, 'System:'), p.key);
    expect(approvedMetrics(state, [p])).toEqual([]);
    expect(canApprove('System:')).toBe(false);
  });
});

describe('keys that are object-prototype names (C7)', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    '%s is an ordinary skill',
    (skill) => {
      const [p] = metricPromptsForGaps([skill]) as [
        ReturnType<typeof metricPromptsForGaps>[number],
      ];
      expect(() => approve(EMPTY_METRIC_STATE, p.key)).not.toThrow();
      expect(approve(EMPTY_METRIC_STATE, p.key)).toEqual(EMPTY_METRIC_STATE);
      let state = setDraft(EMPTY_METRIC_STATE, p.key, 'Saved 3 hours');
      expect(approvedMetrics(state, [p])).toEqual([]);
      state = approve(state, p.key);
      expect(approvedMetrics(state, [p])).toEqual([{ skill: p.skill, text: 'Saved 3 hours' }]);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );
});

describe('what a draft was written with versus what is approved now (re-review C2)', () => {
  const used = [
    { skill: 'Power BI', text: 'Cut reporting from 5 days to 2' },
    { skill: 'dbt', text: 'Migrated 40 models' },
  ];

  it('keeps only entries still approved with the same skill and text', () => {
    const now = [{ skill: 'power bi', text: 'Cut reporting from 5 days to 2' }];
    expect(stillApproved(used, now)).toEqual([used[0]]);
  });

  it('negative: a changed text, a removed entry or nothing approved drops it', () => {
    expect(stillApproved(used, [{ skill: 'dbt', text: 'Migrated 400 models' }])).toEqual([]);
    expect(stillApproved(used, [])).toEqual([]);
    expect(stillApproved([], used)).toEqual([]);
  });

  it('metricsChanged is false only when the two sets are the same', () => {
    expect(metricsChanged(used, [...used].reverse())).toBe(false);
    expect(metricsChanged(used, [used[0]!])).toBe(true);
    expect(metricsChanged([], used)).toBe(true);
    expect(metricsChanged([], [])).toBe(false);
    expect(metricsChanged(used, [used[0]!, { skill: 'dbt', text: 'Other' }])).toBe(true);
  });
});
