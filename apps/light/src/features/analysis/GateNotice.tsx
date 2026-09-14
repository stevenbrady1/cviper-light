import { type GateResult, type GateVerdict } from '@cviper/keyword-scoring';

/**
 * The gate verdicts, drawn ABOVE the analysis result (L-156).
 *
 * ============================================================================
 * WHY THIS SITS ABOVE THE SCORE
 * ============================================================================
 * A user reads the big number first and everything else through it. If the
 * advert says "must be a UK citizen" and the profile says "need sponsorship",
 * a 78 underneath a paragraph nobody reads is a trap; the same 78 underneath
 * "Hard stop — the advert says: …" is a number the user can put in context.
 * The gate never changes the score. It changes what the score means.
 *
 * ============================================================================
 * WHY A FAIL IS RED, WHEN "WEAK MATCH" IS NOT
 * ============================================================================
 * `AnalysisResult` keeps red out of the verdict pill on purpose: "your CV is
 * not a close fit" is the APP's opinion, and the app is not entitled to
 * deliver its opinion in the colour it uses for deleting things. A gate fail
 * is different in kind. The bad news comes from the advert, in the advert's
 * own words, quoted underneath — the app is the messenger, and it is only
 * red because the user needs to see it before spending an evening on a form
 * that will be binned unread. A flag is gold: something to check, not a
 * verdict. A pass is teal, and when everything passes the rows collapse to
 * one quiet line, because a list of green ticks is noise above the thing the
 * user came for.
 *
 * Every row quotes the advert when the advert said anything, so the user
 * checks the source, not the label.
 */

const VERDICT_LABEL: Record<GateVerdict, string> = {
  pass: 'Clear',
  flag: 'Check this',
  fail: 'Hard stop',
};

const VERDICT_TONE: Record<GateVerdict, string> = {
  pass: 'bg-teal/10 text-teal',
  flag: 'bg-gold/10 text-gold',
  fail: 'bg-danger/10 text-danger',
};

interface GateNoticeProps {
  readonly results: readonly GateResult[];
}

function labelOf(result: GateResult): string {
  return result.kind === 'language' ? `Language: ${result.language ?? ''}` : 'Eligibility';
}

export function GateNotice({ results }: GateNoticeProps) {
  // `runGates` never returns an empty list; guarded so an empty one cannot
  // render a "nothing stops you" line it has no evidence for.
  if (results.length === 0) return null;

  if (results.every((result) => result.verdict === 'pass')) {
    return (
      <p data-testid="analysis-gates-clear" className="text-ink-faint">
        Eligibility and language: nothing in the advert stops you applying.
      </p>
    );
  }

  // Index per kind, so a second language is `language-1` whatever came first.
  const seen: Record<GateResult['kind'], number> = { eligibility: 0, language: 0 };

  return (
    <ul data-testid="analysis-gates" className="space-y-2">
      {results.map((result) => {
        const index = seen[result.kind];
        seen[result.kind] += 1;
        return (
          <li
            key={`${result.kind}-${index}`}
            data-testid={`analysis-gate-${result.kind}-${index}`}
            data-verdict={result.verdict}
            className="rounded-card border border-line bg-card px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
                {labelOf(result)}
              </h3>
              <span
                data-testid="analysis-gate-verdict"
                className={`rounded-pill px-2 py-0.5 text-xs font-medium ${VERDICT_TONE[result.verdict]}`}
              >
                {VERDICT_LABEL[result.verdict]}
              </span>
            </div>
            <p className="mt-1 text-ink">{result.reason}</p>
            {result.quote === null ? null : (
              <blockquote className="mt-1 border-l-2 border-line pl-3 text-ink-muted">
                {result.quote}
              </blockquote>
            )}
          </li>
        );
      })}
    </ul>
  );
}
