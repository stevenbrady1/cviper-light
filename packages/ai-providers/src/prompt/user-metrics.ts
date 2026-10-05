/**
 * User-supplied achievements (L-205): what the candidate typed against a
 * keyword gap and explicitly approved, as a prompt section shared by the
 * tailor, cover-letter and review prompts so all three treat them the same.
 *
 * ============================================================================
 * FACTS THE USER TYPED - USE THEM, NEVER GROW THEM
 * ============================================================================
 * Everywhere else the prompts say a number may only come from the base CV.
 * This section is the one stated exception, and it is narrow: ONLY NUMBERS,
 * only as the candidate typed them. An employer, date or qualification still
 * comes from the base CV alone. The section is marked USER-SUPPLIED so the
 * model, and anyone reading the payload, can tell it from the CV.
 */
import { cleanOneLine } from './clean-one-line';

/** At most this many entries, one per gap, matching the keyword-gap cap. */
export const MAX_USER_METRICS = 15;
/** Each entry's length. */
export const MAX_USER_METRIC_CHARS = 300;
/** A skill's length - the same as `MAX_KEYWORD_GAP_CHARS`. */
const MAX_SKILL_CHARS = 60;

/**
 * One achievement the candidate typed for one keyword gap AND explicitly
 * approved. Never generated, never pre-filled.
 */
export interface UserSuppliedMetric {
  readonly skill: string;
  readonly text: string;
}

/**
 * The carve-out, as it is added to every base-CV-only rule while a section is
 * present. Pinned by tests: the rules and the section must agree.
 */
export const USER_FACTS_CARVE_OUT =
  'or the CANDIDATE-SUPPLIED ACHIEVEMENTS section, exactly as given (numbers only)';

export const USER_METRICS_HEADING =
  '=== CANDIDATE-SUPPLIED ACHIEVEMENTS (USER-SUPPLIED FACTS, approved by the candidate) ===';
export const USER_METRICS_END = '=== END CANDIDATE-SUPPLIED ACHIEVEMENTS ===';

/**
 * The approved achievements as they go into a prompt: one line each, blank
 * entries dropped, one per skill (first wins, ignoring case), at most
 * `MAX_USER_METRICS`.
 */
export function promptUserMetrics(
  metrics: readonly UserSuppliedMetric[] | null | undefined,
): UserSuppliedMetric[] {
  const kept: UserSuppliedMetric[] = [];
  const seen = new Set<string>();
  for (const metric of metrics ?? []) {
    const skill = cleanOneLine(metric.skill, MAX_SKILL_CHARS, { stripBrackets: true });
    const text = cleanOneLine(metric.text, MAX_USER_METRIC_CHARS);
    const key = skill.toLowerCase();
    if (skill === '' || text === '' || seen.has(key)) continue;
    seen.add(key);
    kept.push({ skill, text });
    if (kept.length === MAX_USER_METRICS) break;
  }
  return kept;
}

/** The section, or `null` when there is nothing approved. */
export function userMetricsSection(
  metrics: readonly UserSuppliedMetric[] | null | undefined,
): string | null {
  const kept = promptUserMetrics(metrics);
  if (kept.length === 0) return null;
  return [
    USER_METRICS_HEADING,
    ...kept.map((metric) => `- [${metric.skill}] ${metric.text}`),
    USER_METRICS_END,
    '',
    'USER-SUPPLIED FACTS: the lines above were typed by the candidate, each against one advert word, and approved for use. They are true statements about the candidate, though not part of the base CV. You MAY use one, exactly as given, in a bullet, the summary or the letter, where the base CV shows related work. Do not embellish them: do not change, round or enlarge a number, and do not add detail, scope, a result or a timeframe they do not state. An employer, date or qualification may come ONLY from the base CV; a number may come ONLY from the base CV or these lines. If a line does not fit anywhere the base CV supports, leave it out.',
  ].join('\n');
}

/**
 * Replace `anchor` in `text` with `replacement`, or throw: a rule whose wording
 * drifted must fail loudly, not silently lose its carve-out.
 */
export function carveOut(text: string, anchor: string, replacement: string): string {
  if (!text.includes(anchor)) throw new Error(`carve-out anchor not found: ${anchor}`);
  return text.replace(anchor, replacement);
}
