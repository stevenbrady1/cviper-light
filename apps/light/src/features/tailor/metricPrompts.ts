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
import { cleanOneLine, promptKeywordGaps } from '@cviper/ai-providers';

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
  /** True when approval changed the words (a phrase the prompt filter removes). */
  readonly cleaned: boolean;
}

/**
 * A Map, not a plain object: a skill called `constructor` or `__proto__` is an
 * ordinary skill, and must not read a property off `Object.prototype`.
 */
export type MetricState = ReadonlyMap<string, MetricEntry>;

export const EMPTY_METRIC_STATE: MetricState = new Map();

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

/**
 * What approval stores: the SAME one-line cleaner the prompt builders use, so
 * the screen shows exactly what is sent. Capped, whitespace collapsed, and
 * stripped of the phrasings and lookalike characters the prompt would drop.
 */
function clean(text: string): string {
  return cleanOneLine(text, MAX_METRIC_CHARS);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function withEntry(state: MetricState, key: string, entry: MetricEntry): MetricState {
  const next = new Map(state);
  next.set(key, entry);
  return next;
}

/** Empty, whitespace-only, or text that cleans to nothing cannot be approved. */
export function canApprove(draft: string): boolean {
  return clean(draft) !== '';
}

/** Typing. Always puts the entry back to `editing`: an edit withdraws approval. */
export function setDraft(state: MetricState, key: string, draft: string): MetricState {
  return withEntry(state, key, { draft, status: 'editing', cleaned: false });
}

/** Explicit approval. A no-op when there is nothing real to approve. */
export function approve(state: MetricState, key: string): MetricState {
  const entry = state.get(key);
  if (entry === undefined || !canApprove(entry.draft)) return state;
  const text = clean(entry.draft);
  return withEntry(state, key, {
    draft: text,
    status: 'approved',
    cleaned: text !== collapse(entry.draft),
  });
}

/** True when approval changed the words, so the screen can say so. */
export function cleanedOnApproval(state: MetricState, key: string): boolean {
  const entry = state.get(key);
  return entry?.status === 'approved' && entry.cleaned;
}

/** "Not now". The draft is kept, but it is never sent. */
export function dismiss(state: MetricState, key: string): MetricState {
  return withEntry(state, key, {
    draft: state.get(key)?.draft ?? '',
    status: 'dismissed',
    cleaned: false,
  });
}

/** Back to editing, e.g. "Change" on an approved entry or "Add a metric" on a skipped one. */
export function reopen(state: MetricState, key: string): MetricState {
  const entry = state.get(key);
  if (entry === undefined) return state;
  return withEntry(state, key, { draft: entry.draft, status: 'editing', cleaned: false });
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
    const entry = state.get(prompt.key);
    if (entry?.status !== 'approved') return [];
    const text = clean(entry.draft);
    return text === '' ? [] : [{ skill: prompt.skill, text }];
  });
}

/**
 * Of the metrics a draft was written with, those still approved NOW with the
 * same skill and the same text. A line the user has since removed, changed or
 * hidden (another CV, another advert) is no longer theirs to rely on, so it is
 * not sent again and not whitelisted by the letter's figure check.
 */
export function stillApproved(
  used: readonly ApprovedMetric[],
  current: readonly ApprovedMetric[],
): ApprovedMetric[] {
  return used.filter((entry) =>
    current.some(
      (now) => now.skill.toLowerCase() === entry.skill.toLowerCase() && now.text === entry.text,
    ),
  );
}

/** True when the approved set is not the one the draft was written with. */
export function metricsChanged(
  used: readonly ApprovedMetric[],
  current: readonly ApprovedMetric[],
): boolean {
  return stillApproved(used, current).length !== used.length || used.length !== current.length;
}
