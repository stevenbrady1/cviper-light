/**
 * Prompt constants — calibration knowledge, not code.
 *
 * PORTED FROM: c:\Dev\job-match-pro\backend\ai\prompts\constants.py
 *   JSON_ONLY ............ line 9
 *   FAIRNESS_GUARDRAIL ... line 13
 *   FIT_SCORE_ANCHORS .... line 28
 *   FIT_SCORE_WEIGHTS .... line 54
 *   ATS_SCORE_ANCHORS .... line 140
 *
 * ============================================================================
 * THE ANCHORS ARE THE MOST VALUABLE THING IN THIS FILE.
 * ============================================================================
 * Without worked examples a model scores almost everything 75-85, because that
 * is where "reasonable-sounding number" lives. The three scenarios below (84 /
 * 52 / 71) are what pull the distribution apart. If a future edit shortens this
 * file, the anchors are the last thing to go, not the first.
 *
 * The target app returns ONE FLAT JSON object because a 3B quantised local
 * model fails on nested schemas. Every edit recorded below exists to keep the
 * calibration while removing any hint of fields we do not return.
 */

/** All prompt constants are plain prompt text. */
export type PromptFragment = string;

// ─────────────────────────────────────────────────────────────────────────────
// JSON_ONLY — constants.py line 9. Ported verbatim.
// ─────────────────────────────────────────────────────────────────────────────
export const JSON_ONLY: PromptFragment = 'Return ONLY valid JSON.';

// ─────────────────────────────────────────────────────────────────────────────
// FAIRNESS_GUARDRAIL — constants.py lines 13-19. Ported verbatim (the Python
// value is a parenthesised implicit string concat; joined here into one literal
// with the same spacing).
// ─────────────────────────────────────────────────────────────────────────────
export const FAIRNESS_GUARDRAIL: PromptFragment =
  'FAIRNESS CONSTRAINT: Score candidates solely on skills, experience, ' +
  'qualifications, and job-relevant competencies. Do NOT consider or infer ' +
  'age, gender, ethnicity, disability, nationality, religion, marital status, ' +
  'or any other protected characteristic. Treat all candidates equally ' +
  'regardless of name, university prestige, or employment gaps.';

// ─────────────────────────────────────────────────────────────────────────────
// FIT_SCORE_ANCHORS — constants.py lines 28-51.
//
// Changed — ONE deliberate edit, applied three times:
//   Each worked example in the source ends with a literal sub-score list, e.g.
//     "Sub-scores: skills=88, experience=90, seniority=85, industry=75, competency=70."
//   Our flat schema has no sub-scores. Naming them would invite a small model
//   to emit extra keys (or refuse the schema), so each trailing clause has been
//   REWRITTEN AS PROSE preserving the same relative ordering of strong and weak
//   signals. The band definitions, the three scenarios, the scores (84/52/71)
//   and every "Why NN:" rationale are otherwise intact.
//
// The prose mapping used (source numbers -> prose), recorded so a reviewer can
// check the translation without reopening the Python file:
//   Ex.1  skills 88, experience 90, seniority 85, industry 75, competency 70
//         -> experience + skills strongest; competency weakest; industry middling
//   Ex.2  skills 35, experience 40, seniority 55, industry 30, competency 75
//         -> competency strongest; industry + skills weakest; experience next
//   Ex.3  skills 60, experience 65, seniority 75, industry 95, competency 80
//         -> industry overwhelmingly strongest; skills weakest; experience short
// ─────────────────────────────────────────────────────────────────────────────
export const FIT_SCORE_ANCHORS: PromptFragment = `
Score anchors (use these to calibrate your match_score):
- 90-100: Near-perfect match — candidate meets ALL essential requirements and most desirable ones, with strong seniority and industry alignment.
- 75-89: Strong match — meets most essential requirements, missing 1-2 desirable skills, seniority is appropriate.
- 60-74: Moderate match — meets ~60% of essentials, has transferable skills for the rest, minor seniority or industry gap.
- 40-59: Weak match — significant gaps in essential requirements, or notable seniority mismatch (e.g. mid-level candidate for a director role).
- Below 40: Poor match — majority of essential skills missing, severe seniority mismatch, or fundamentally different career track.

Calibration examples (use these to anchor your scoring):

EXAMPLE 1 (score: 84 — strong match):
  Candidate: 8yr Python/Django dev, AWS certified, led team of 4, fintech background.
  Job: Senior Python Engineer at a payments startup. Requires Python, AWS, PostgreSQL, 5+ years.
  Why 84: Meets all essentials (Python expert, AWS cert, 8yr > 5yr required), has relevant fintech industry experience, seniority aligns (senior→senior). Missing: PostgreSQL not listed as a core skill (has it but not highlighted), no mention of their specific payments domain. Depth of experience and raw skill match were the strongest signals here; industry alignment was good but not payments-specific, and evidenced soft-skill competencies were the weakest part of the picture.

EXAMPLE 2 (score: 52 — weak match):
  Candidate: 3yr React/Node.js dev, no cloud experience, startup generalist.
  Job: Senior Python Backend Engineer, requires Python, FastAPI, PostgreSQL, 5+ years, financial services.
  Why 52: Has transferable web dev skills but zero Python experience (critical gap), 3yr vs 5yr required (under-experienced), no financial services background. React/Node shows aptitude but a career change is needed. Generalist adaptability was the one genuinely strong signal; industry alignment and hard-skill match were by far the weakest, with years of experience close behind — seniority was the only middling dimension.

EXAMPLE 3 (score: 71 — moderate match):
  Candidate: 6yr Java/Spring dev, some Python, AWS, banking experience.
  Job: Python Tech Lead at a bank. Requires Python, leadership, cloud, 7+ years.
  Why 71: Strong banking industry fit, has leadership potential (mentored juniors), AWS experience matches cloud requirement. However: Python is secondary skill (intermediate, not expert), 6yr vs 7yr is slightly short, Java-primary is a risk for a Python-focused role. Industry alignment was overwhelmingly the strongest signal; leadership competency and seniority were solid; the hard-skill match was the weakest dimension, with years of experience slightly short of the bar.`;

// ─────────────────────────────────────────────────────────────────────────────
// FIT_SCORE_WEIGHTS — constants.py lines 54-62.
//
// Changed — ONE deliberate deletion:
//   The source ends with "The match_score MUST equal the weighted sum of
//   sub-scores, rounded to the nearest integer." That sentence is DELETED.
//   Telling a model to sum fields it is not returning is precisely what makes a
//   small quantised model emit extra keys or refuse the schema. The
//   35/25/20/10/10 split and the proficiency ladder are kept verbatim as
//   CALIBRATION GUIDANCE — how to weigh evidence when choosing one integer, not
//   a formula over emitted fields.
//
// Changed — SECOND deliberate edit, taken from the port's own `TODO(verify)`:
//   the source heading read "Sub-score weights (use these to compute the final
//   match_score)" and the bullets were keyed `skills_match`, `experience_fit`,
//   `seniority_match`, `industry_alignment`, `competency_match`. Those five
//   snake_case names read as a FIELD LIST to a 3B model — the last place in the
//   prompt that could invite a stray `sub_scores` object. The port left them
//   in only because its brief was scoped to the deletion above; this file is
//   where the reword lands. The percentages and the ladder are untouched.
// ─────────────────────────────────────────────────────────────────────────────
export const FIT_SCORE_WEIGHTS: PromptFragment = `
Evidence weighting (guidance only — you return a single match_score, not these):
- Skills match: 35% — weighted by proficiency (expert=100%, advanced=80%, intermediate=50%, basic=25%, missing=0%)
- Experience fit: 25% — years of experience relative to role requirements
- Seniority match: 20% — alignment between candidate level and role level
- Industry alignment: 10% — relevance of candidate's sector experience
- Competency match: 10% — soft skills and leadership competencies (weight higher for senior/lead roles)`;

// ─────────────────────────────────────────────────────────────────────────────
// ATS_SCORE_ANCHORS — constants.py lines 140-143. Ported verbatim.
//
// In the source app this anchored a SEPARATE `ats_score` integer returned by a
// second AI call. The flat schema has no `ats_score`, so these bands are reused
// as the SEVERITY LADDER behind `ats_notes[]` — see `build-prompt.ts`, which
// wraps them in an explicit "do NOT output a number for it".
// ─────────────────────────────────────────────────────────────────────────────
export const ATS_SCORE_ANCHORS: PromptFragment =
  'Score anchors: 90+ = strong keyword overlap, quantified bullets, perfect structure. ' +
  '60-70 = moderate gaps, some missing keywords. Below 50 = major structural or keyword issues.';

// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATELY NOT PORTED (each with its one-line reason)
// ─────────────────────────────────────────────────────────────────────────────
// _SENIORITY_WEIGHTS (constants.py 69-75) — dynamic per-seniority weight table;
//   the flat schema takes no seniority input, so only the static "mid" row applies.
// _resolve_fit_key / resolve_fit_weights / get_fit_score_weights (78-118) —
//   helpers for the above table plus server-side drift telemetry; both moot here.
// detect_locale / _UK_PATTERNS / _US_PATTERNS / get_locale_instruction (155-209) —
//   UK-vs-US CV convention switching; no locale-dependent output in the flat schema.
// LOCALE_INSTRUCTIONS (171-187) — the text those helpers inject; unused without them.
// CANDIDATE_FIT_WEIGHTS / CANDIDATE_FIT_ANCHORS (121-137) — reverse "does this job
//   suit the candidate" scoring; a nested `candidate_fit` block the flat schema omits.
// HEALTH_SCORE_ANCHORS (146-151) — anchors for the standalone CV health check, a
//   different feature from CV-vs-job matching.
// NO_FABRICATION (22-25) — guards CV *generation*/tailoring; CViper Light only
//   analyses, it never writes CV content, so there is nothing to fabricate.
// JSON_ARRAY_ONLY (10) — for prompts returning a bare array; the flat schema is
//   a single object.
