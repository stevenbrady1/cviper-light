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
  dismiss,
  metricPromptsForGaps,
  reopen,
  setDraft,
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
    expect(state[bi.key]?.draft).toBe('Saved 3 hours');
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
    expect(before[bi.key]?.status).toBe('editing');
  });
});
