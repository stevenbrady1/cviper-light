import { KEYWORD_SCORING_VERSION } from '@cviper/keyword-scoring';

import { SECONDARY_BUTTON } from '../../app/buttons';

import { AnalysisResult } from './AnalysisResult';
import { SAMPLE_ADVERT_TEXT, SAMPLE_CV_TEXT, type SampleResult } from './sample';

export interface AnalysisSampleProps {
  readonly sample: SampleResult;
  readonly aiAvailable: boolean;
  readonly onHide: () => void;
}

/** The one-click sample check (L-277): a made-up CV and advert, shown and never saved. */
export function AnalysisSample({ sample, aiAvailable, onHide }: AnalysisSampleProps) {
  return (
    <section
      data-testid="analysis-sample"
      aria-label="Sample check"
      className="space-y-4 rounded-card border border-line bg-sunken p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-ink-muted">
          <span className="font-medium text-ink">A sample check.</span> A made-up data
          analyst&rsquo;s CV against a made-up advert, using the basic match. Nothing was saved. Add
          your own CV above to check it for real.
        </p>
        <button
          type="button"
          data-testid="analysis-sample-hide"
          onClick={onHide}
          className={SECONDARY_BUTTON}
        >
          Hide the sample
        </button>
      </div>
      <AnalysisResult
        analysis={sample.analysis}
        provider="keyword"
        model={`keyword-v${KEYWORD_SCORING_VERSION}`}
        aiAvailable={aiAvailable}
        atsKeywordScore={sample.atsKeywordScore}
        cvText={SAMPLE_CV_TEXT}
        advertText={SAMPLE_ADVERT_TEXT}
      />
    </section>
  );
}
