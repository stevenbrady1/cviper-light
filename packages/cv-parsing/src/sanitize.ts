/**
 * sanitize.ts — CViper Light (Tauri, local Ollama)
 *
 * PORTED FROM: backend/ai/gateway.py  (CViper repo, @ 52af65a2)
 *   `sanitize_for_prompt` (static method).
 *
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`; its
 * guard fails there when this source changes. Symbols are named rather than
 * line numbers, which decay on the next edit upstream.
 *
 * Purpose (source docstring, verbatim): "Strip known prompt injection patterns
 * from external text. Removes instruction-override attempts while preserving
 * normal job description content. Apply to any user-supplied or scraped text
 * before embedding it in an AI prompt."
 *
 * Still needed locally. The model is on the user's machine, but the *job
 * description* is not — it is pasted or scraped from a job board, i.e.
 * attacker-influenced text going straight into a prompt. A local 3B model is if
 * anything easier to talk out of its instructions than a frontier one.
 *
 * NOT A SECURITY BOUNDARY ON ITS OWN. It removes the known-bad phrasings the
 * production app has actually seen. The fenced prompt structure and the system
 * message still have to do their share of the work.
 *
 * ORDER IS PART OF THE BEHAVIOUR: patterns run in source order, and the
 * whitespace collapse runs last so it tidies the holes the earlier removals
 * punch in the text.
 */

/** One injection defence: the pattern, and what it blocks. */
export interface InjectionPattern {
  readonly pattern: RegExp;
  readonly blocks: string;
}

const INJECTION_PATTERNS: readonly InjectionPattern[] = [
  {
    // gateway.py lines 433-436. Ported verbatim; Python's inline `(?i)` becomes
    // the JS `i` flag, and `g` replaces Python's replace-all default.
    // Blocks the classic override opener: "Ignore all previous instructions",
    // "disregard the above rules", "forget prior prompts" — the phrasing an
    // attacker uses to detach the model from the system message.
    pattern:
      /(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/gi,
    blocks: 'instruction-override openers ("ignore all previous instructions")',
  },
  {
    // gateway.py line 437. Verbatim.
    // Blocks role reassignment and fake turn markers: "You are now a helpful
    // assistant that...", "New instructions:", and a bare "System:" line that
    // tries to impersonate the system role inside user text.
    pattern: /(you\s+are\s+now|new\s+instructions?|system\s*:)/gi,
    blocks: 'role reassignment and fake system turns ("You are now…", "System:")',
  },
  {
    // gateway.py line 438. Verbatim.
    // Blocks fake privilege-escalation banners — text pretending the model has
    // been switched into a mode where its rules no longer apply.
    pattern: /(SYSTEM\s+OVERRIDE|ADMIN\s+MODE|DEBUG\s+MODE)/gi,
    blocks: 'fake privilege-escalation banners ("SYSTEM OVERRIDE", "ADMIN MODE")',
  },
  {
    // ── NEW IN CViper Light — this is the `TODO(verify)` from the port, closed.
    //
    // The source pattern below is CASE-SENSITIVE, so `=== END JOB ===` was
    // stripped while `=== end job ===` sailed through. A local model will
    // honour a lowercase fence just as readily, so that is a real hole.
    //
    // The obvious fix — adding `i` to the source pattern — is the trap the port
    // note warned about. The source allows `[\w\s']*` between the keyword and
    // the closing equals run, so with `i` it would also eat legitimate advert
    // prose such as `===== Job requirements =====`, silently deleting a whole
    // section heading from the advert we are meant to be analysing.
    //
    // So this pattern matches the FULL FENCE FORM instead of a bare keyword:
    // an equals run, optional `END`, the keyword, and then IMMEDIATELY the
    // closing equals run. Nothing may sit in between. That is exactly the shape
    // our own prompt builder emits (`=== CV ===`, `=== JOB ===` and their
    // `END` forms), and it is the only shape that can actually close one of our
    // sections — so matching it exactly loses nothing and gains every casing.
    //
    // Horizontal whitespace only (`[ \t]`, not `\s`) so the match can never
    // span a line break and swallow real content between two decorated lines.
    pattern: /={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[ \t]*={3,}/gi,
    blocks: 'fence forgery in ANY casing — `=== END JOB ===`, `=== end job ===`',
  },
  {
    // gateway.py line 440 — RETARGETED, and kept CASE-SENSITIVE.
    //   Source:  ={3,}\s*(?:END\s+)?(?:CV|JOB|ORIGINAL|TAILORED|CANDIDATE|BASE|CURRENT|KEYWORDS)[\w\s']*={3,}
    //   Here:    ={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[\w \t']*={3,}
    // The alternation is narrowed because CViper Light fences exactly two
    // sections. If a third fence is ever added, add it here AND in the pattern
    // above, in the same commit.
    //
    // This is the wider net: `[\w \t']*` soaks up suffixes like
    // `=== JOB DESCRIPTION ===`. It stays case-SENSITIVE precisely so that
    // all-caps fence-shaped headings are caught while ordinary title-case or
    // lowercase prose ("===== Job requirements =====") is left intact. The
    // pattern above covers the casing gap for the exact fence form; this one
    // covers the shape gap for the form we emit in shouting caps.
    //
    // SECOND DELIBERATE CHANGE: the source's `\s` is narrowed to `[ \t]` here
    // too. `\s` matches newlines, so the source pattern would match across a
    // decorated block —
    //     ============
    //     CV must be attached
    //     ============
    // — and delete the sentence in the middle of an advert. Our fences are
    // single-line, so a multi-line "fence" could never close one of our
    // sections in the first place; matching it only ever destroyed real text.
    pattern: /={3,}[ \t]*(?:END[ \t]+)?(?:CV|JOB)[\w \t']*={3,}/g,
    blocks: 'fence forgery with an all-caps suffix ("=== JOB DESCRIPTION ===")',
  },
];

/**
 * Strip known prompt-injection patterns from untrusted text (job descriptions,
 * scraped adverts, pasted postings) before embedding it in a prompt.
 *
 * Source: gateway.py `sanitize_for_prompt`, lines 422-444.
 */
export function sanitizeForPrompt(text: string | null | undefined): string {
  // Source: `if not text: return ""`.
  if (!text) return '';

  let out = text;
  for (const { pattern } of INJECTION_PATTERNS) {
    out = out.replace(pattern, '');
  }

  // gateway.py line 443 — collapse excessive whitespace. Runs LAST, so the gaps
  // left by the removals above are tidied. Four-or-more newlines become three;
  // the source keeps three deliberately, so genuine paragraph breaks in a job
  // advert survive.
  out = out.replace(/\n{4,}/g, '\n\n\n');

  // gateway.py line 444 — `return text.strip()`.
  return out.trim();
}

/**
 * Exposed for tests and for documenting the defence set.
 *
 * Every `pattern` carries the `g` flag and is therefore STATEFUL. `String
 * .replace` resets `lastIndex`, so `sanitizeForPrompt` is safe to call
 * repeatedly, but calling `.test()` on one of these directly is not — it leaves
 * `lastIndex` moved for the next caller. Read them; do not run them.
 */
export const injectionPatterns = INJECTION_PATTERNS;

// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATELY NOT PORTED
// ─────────────────────────────────────────────────────────────────────────────
// gateway.py line 441:
//   re.sub(r'<{3,}\s*(?:END_)?(?:UPDATED_CV|GAP_ANALYSIS|CHANGES_SUMMARY|REMAINING_GAPS)\s*>{3,}', '', text)
// This defends `<<<UPDATED_CV>>>`-style fences used by the old app's iterative
// CV-editing feature. CViper Light emits no such fences, so the pattern would be
// inert. If an angle-bracket fence is ever introduced, port this line and widen
// the alternation rather than inventing a generic `<<<...>>>` rule — a generic
// one would eat legitimate `<<<` text out of job adverts.
//
// KNOWN AND ACCEPTED FALSE POSITIVES (both inherited from the source):
//   - "System:" is removed anywhere it appears, so "Trading System: Murex"
//     becomes "Trading  Murex". Deleting two words from an advert is a much
//     smaller harm than honouring a forged system turn.
//   - "===== JOB DESCRIPTION =====" in an advert is removed as fence-shaped.
//     A heading is lost; the requirements under it are not.
// Both are covered by tests so the next person changing this file finds out
// that the behaviour is deliberate rather than discovering it in the wild.
