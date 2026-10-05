/**
 * Metric prompting (L-205) - the pure half. Keyword gaps in, one gentle
 * question per gap out; what the user typed and whether they approved it in,
 * the approved facts out. No React, no I/O.
 *
 * ============================================================================
 * A QUESTION, NEVER AN ANSWER
 * ============================================================================
 * The text is a single fixed question with the skill substituted. There is no
 * example metric, no suggested number, no template to fill in: anything the
 * tool offered would be an invention the user might accept without thinking.
 * Whatever reaches the model is something the user typed.
 *
 * ============================================================================
 * NOTHING LEAVES WITHOUT AN EXPLICIT APPROVAL
 * ============================================================================
 * `approvedMetrics` is the only way text leaves this module, and it returns an
 * entry only when its status is `approved`. Editing an approved entry
 * withdraws the approval, so what was approved is always what is on screen.
 * A dismissed or merely typed entry is never returned.
 */
import { promptKeywordGaps } from '@cviper/ai-providers';

/** The longest an approved achievement may be. Matches the prompt's own cap. */
export const MAX_METRIC_CHARS = 300;

export interface MetricPrompt {
  /** Lower-cased skill: the identity of the entry, so a repeat is one box. */
  readonly key: string;
  readonly skill: string;
  readonly question: string;
}

export type MetricStatus = 'editing' | 'approved' | 'dismissed';

export interface MetricEntry {
  readonly draft: string;
  readonly status: MetricStatus;
}

export type MetricState = Readonly<Record<string, MetricEntry>>;

export const EMPTY_METRIC_STATE: MetricState = {};

/** An approved achievement, as the rewrite payload carries it. */
export interface ApprovedMetric {
  readonly skill: string;
  readonly text: string;
}

/** The sentence, word for word, with the skill substituted. */
export function metricQuestion(skill: string): string {
  return `We found a keyword/skill gap for ${skill}. Do you have a quantifiable achievement or metric to add?`;
}

/**
 * One prompt per gap. Reuses the L-202 cleaning (`promptKeywordGaps`: cleaned,
 * de-duplicated ignoring case, capped), so the boxes are exactly the words the
 * rewrite prompt already carries - there is no second gap detector.
 */
export function metricPromptsForGaps(gaps: readonly string[] | null | undefined): MetricPrompt[] {
  return promptKeywordGaps(gaps).map((skill) => ({
    key: skill.toLowerCase(),
    skill,
    question: metricQuestion(skill),
  }));
}

/** Trim, collapse runs of whitespace, cap. What gets stored on approval. */
function clean(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_METRIC_CHARS) return collapsed;
  let cut = MAX_METRIC_CHARS;
  const last = collapsed.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1; // never split a surrogate pair
  return collapsed.slice(0, cut).trim();
}

/** Empty or whitespace-only text cannot be approved. */
export function canApprove(draft: string): boolean {
  return clean(draft) !== '';
}

/** Typing. Always puts the entry back to `editing`: an edit withdraws approval. */
export function setDraft(state: MetricState, key: string, draft: string): MetricState {
  return { ...state, [key]: { draft, status: 'editing' } };
}

/** Explicit approval. A no-op when there is nothing real to approve. */
export function approve(state: MetricState, key: string): MetricState {
  const entry = state[key];
  if (entry === undefined || !canApprove(entry.draft)) return state;
  return { ...state, [key]: { draft: clean(entry.draft), status: 'approved' } };
}

/** "Not now". The draft is kept, but it is never sent. */
export function dismiss(state: MetricState, key: string): MetricState {
  const entry = state[key];
  return { ...state, [key]: { draft: entry?.draft ?? '', status: 'dismissed' } };
}

/** Back to editing, e.g. "Change" on an approved entry or "Add one" on a dismissed one. */
export function reopen(state: MetricState, key: string): MetricState {
  const entry = state[key];
  if (entry === undefined) return state;
  return { ...state, [key]: { draft: entry.draft, status: 'editing' } };
}

/**
 * The approved facts, for the gaps still on screen and no others. The ONLY
 * way text leaves this module.
 */
export function approvedMetrics(
  state: MetricState,
  prompts: readonly MetricPrompt[],
): ApprovedMetric[] {
  return prompts.flatMap((prompt) => {
    const entry = state[prompt.key];
    if (entry?.status !== 'approved') return [];
    const text = clean(entry.draft);
    return text === '' ? [] : [{ skill: prompt.skill, text }];
  });
}
