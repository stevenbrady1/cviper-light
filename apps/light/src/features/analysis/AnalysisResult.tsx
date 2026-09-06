import { type CvAnalysis, type SuggestionPriority, type Verdict } from '@cviper/core-types';

import { displayTerms } from './acronyms';
import { BandScale } from './BandScale';
import { providerLabel } from './model';

/**
 * One finished analysis, drawn the same way whichever engine produced it.
 *
 * ============================================================================
 * THE PROVENANCE LINE IS NOT DECORATION. IT IS THE HONEST BIT.
 * ============================================================================
 * `scoreByKeywords` returns exactly the same `CvAnalysis` an AI model returns —
 * that is what lets one component render both — and it is also why this line
 * has to be here and has to be first. A user who believes a model read their CV
 * will act on a 62 very differently from one who knows a word list counted
 * matches, and only one of those beliefs is true on the basic path.
 *
 * So the label sits ABOVE the score, before the number is read, and it says
 * which engine ran in plain words. It is never conditional on anything except
 * which engine ran.
 */

const VERDICT_LABEL: Record<Verdict, string> = {
  strong: 'Strong match',
  possible: 'Possible match',
  weak: 'Weak match',
};

/**
 * The verdict pill's colours.
 *
 * The grammar, unimprovised: teal for a good fit, gold for one that needs work,
 * plain ink for weak. Nothing here is red — red means destructive, and "your CV
 * is not a close fit for this advert" is information, not a rejection the app
 * is entitled to deliver in the colour it uses for deleting things.
 */
const VERDICT_TONE: Record<Verdict, string> = {
  strong: 'bg-teal/10 text-teal',
  possible: 'bg-gold/10 text-gold',
  weak: 'bg-sunken text-ink-muted',
};

const PRIORITY_LABEL: Record<SuggestionPriority, string> = {
  high: 'Do this first',
  medium: 'Worth doing',
  low: 'If you have time',
};

const PRIORITY_TONE: Record<SuggestionPriority, string> = {
  high: 'bg-gold/10 text-gold',
  medium: 'bg-sunken text-ink-muted',
  low: 'bg-sunken text-ink-faint',
};

const PRIORITY_ORDER: readonly SuggestionPriority[] = ['high', 'medium', 'low'];

/** A section heading, in the app's eyebrow style. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-mono text-[11px] font-medium tracking-[0.14em] text-ink-faint uppercase">
      {children}
    </h3>
  );
}

/**
 * A list of terms as chips.
 *
 * An empty list says so rather than rendering nothing: a heading with a blank
 * space under it is indistinguishable from a section that failed to load, and
 * "no gaps found" is a genuinely good result the user should be told about.
 */
function TermChips({
  terms,
  tone,
  emptyText,
  testId,
}: {
  terms: readonly string[];
  tone: string;
  emptyText: string;
  testId: string;
}) {
  if (terms.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} className="mt-1.5 text-ink-faint">
        {emptyText}
      </p>
    );
  }

  return (
    <ul data-testid={testId} className="mt-1.5 flex flex-wrap gap-1.5">
      {/* Cased for display here, never in the scorer — see `acronyms.ts`. */}
      {displayTerms(terms).map((term) => (
        <li key={term} className={`rounded-pill px-2 py-0.5 text-xs ${tone}`}>
          {term}
        </li>
      ))}
    </ul>
  );
}

interface AnalysisResultProps {
  readonly analysis: CvAnalysis;
  /** As stored: `keyword`, `ollama`, `anthropic`, `openai`. */
  readonly provider: string;
  readonly model: string;
  /** True when the model's first answer was unusable and the repair turn worked. */
  readonly retried?: boolean;
  /**
   * Whether ANY AI option exists on this machine.
   *
   * It changes one sentence, and the sentence matters: telling somebody to add
   * an API key when they already have one is advice they have taken, and it
   * makes the app look like it is not paying attention.
   */
  readonly aiAvailable: boolean;
}

export function AnalysisResult({
  analysis,
  provider,
  model,
  retried = false,
  aiAvailable,
}: AnalysisResultProps) {
  const isKeyword = provider === 'keyword';

  const provenance = isKeyword
    ? aiAvailable
      ? 'Basic match — a word-list scan, not an AI reading of your CV.'
      : 'Basic match — add an AI key for a full analysis.'
    : `Read by ${providerLabel(provider)} · ${model}`;

  return (
    <section data-testid="analysis-result" className="space-y-5">
      {/*
        Above the score, deliberately. The user must know what produced the
        number before they read it. Gold rather than a neutral grey on the basic
        path because it is genuinely "attention" — there is something better
        available — and plain ink on the AI paths, which need no caveat.
      */}
      <p
        data-testid="analysis-provenance"
        data-provider={provider}
        className={`rounded-control px-3 py-2 ${
          isKeyword ? 'bg-gold/10 text-gold' : 'bg-sunken text-ink-muted'
        }`}
      >
        {provenance}
        {retried ? (
          <span className="block text-ink-muted">
            The model&rsquo;s first answer could not be read, and it was asked again. The result
            below is from the second attempt.
          </span>
        ) : null}
      </p>

      <div className="flex items-start justify-between gap-4">
        <BandScale score={analysis.match_score} verdict={analysis.verdict} />
        <span
          data-testid="analysis-verdict"
          className={`rounded-pill px-2.5 py-1 font-medium ${VERDICT_TONE[analysis.verdict]}`}
        >
          {VERDICT_LABEL[analysis.verdict]}
        </span>
      </div>

      <p data-testid="analysis-summary" className="text-ink">
        {analysis.summary}
      </p>

      {/*
        Side by side, because the comparison IS the information: what you have
        against what they asked for. Stacked, the user has to hold the first
        list in their head while reading the second. A phone has no room for
        two columns, so there — and only there — they stack (L-81).
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Eyebrow>What you have</Eyebrow>
          <TermChips
            terms={analysis.matched_skills}
            tone="bg-teal/10 text-teal"
            emptyText="None of the advert&rsquo;s skills were found on your CV."
            testId="analysis-matched-skills"
          />
        </div>
        <div>
          <Eyebrow>What they asked for and could not find</Eyebrow>
          <TermChips
            terms={analysis.missing_skills}
            tone="bg-gold/10 text-gold"
            emptyText="Nothing the advert asks for is missing."
            testId="analysis-missing-skills"
          />
        </div>
      </div>

      <div>
        <Eyebrow>Words a screening system looks for</Eyebrow>
        <p className="mt-1 text-ink-muted">
          These are wording gaps, not skill gaps. Where you have done the work, use the
          advert&rsquo;s own word for it.
        </p>
        <TermChips
          terms={analysis.keyword_gaps}
          tone="bg-sunken text-ink-muted"
          emptyText="Your CV already uses the advert&rsquo;s wording."
          testId="analysis-keyword-gaps"
        />
      </div>

      <div>
        <Eyebrow>What to change</Eyebrow>
        {analysis.suggestions.length === 0 ? (
          <p data-testid="analysis-suggestions-empty" className="mt-1.5 text-ink-faint">
            No specific edits were suggested.
          </p>
        ) : (
          <ol data-testid="analysis-suggestions" className="mt-2 space-y-2">
            {/*
              Grouped by priority rather than sorted by it, so the user can see
              that three things matter most and four are optional — an ordered
              list alone hides where the drop-off is.
            */}
            {PRIORITY_ORDER.flatMap((priority) =>
              analysis.suggestions
                .filter((suggestion) => suggestion.priority === priority)
                .map((suggestion, index) => (
                  <li
                    key={`${priority}-${index}-${suggestion.section}`}
                    data-testid={`analysis-suggestion-${priority}`}
                    className="rounded-card border border-line bg-card p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-pill px-2 py-0.5 text-xs font-medium ${PRIORITY_TONE[priority]}`}
                      >
                        {PRIORITY_LABEL[priority]}
                      </span>
                      <span className="font-medium text-ink">{suggestion.section}</span>
                    </div>
                    <p className="mt-1.5 text-ink-muted">{suggestion.issue}</p>
                    <p className="mt-1 text-ink">{suggestion.recommendation}</p>
                  </li>
                )),
            )}
          </ol>
        )}
      </div>

      <div>
        <Eyebrow>Applicant tracking system notes</Eyebrow>
        {analysis.ats_notes.length === 0 ? (
          <p data-testid="analysis-ats-notes-empty" className="mt-1.5 text-ink-faint">
            Nothing was flagged about how your CV would be read by screening software.
          </p>
        ) : (
          <ul data-testid="analysis-ats-notes" className="mt-1.5 space-y-1 text-ink-muted">
            {analysis.ats_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
