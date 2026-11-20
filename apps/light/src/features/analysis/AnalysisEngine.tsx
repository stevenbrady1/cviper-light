import { ChipSelect } from '../../app/ChipSelect';
import { type BrowserPort } from '../../platform/browser';

import { ConsentStatus } from './ConsentGate';
import { type ConsentProviderKind } from './consent';
import { OllamaDownloadLink } from './OllamaDownloadLink';
import { type ProviderOption } from './providers';

export interface AnalysisEngineProps {
  readonly options: readonly ProviderOption[];
  readonly optionKey: string;
  readonly selectedOption: ProviderOption | null;
  readonly onOptionChange: (key: string) => void;
  /** Said when the chosen AI will not read the whole CV (L-302), else `null`. */
  readonly cvCut: string | null;
  readonly localModelHint: string | null;
  readonly browser: BrowserPort;
  readonly grantedConsents: readonly ConsentProviderKind[];
  readonly onWithdrawConsent: (kind: ConsentProviderKind) => void;
}

/** The AI part of the line (L-446): "using" and the AI chip. */
export function AnalysisEngine({
  options,
  optionKey,
  onOptionChange,
}: Pick<AnalysisEngineProps, 'options' | 'optionKey' | 'onOptionChange'>) {
  return (
    <span className="flex max-w-full min-w-0 items-center gap-2">
      <span className="text-ink-muted">using</span>
      <ChipSelect
        id="analysis-provider"
        name="How to check it"
        testId="analysis-provider"
        value={optionKey}
        options={options.map((option) => ({ value: option.key, label: option.label }))}
        onChange={onOptionChange}
      />
    </span>
  );
}

/**
 * Under the box: when the chosen AI will not read the whole CV, when Ollama has
 * no chat model, and what the chosen AI means for the CV, in its own words.
 */
export function AnalysisEngineNotes({
  selectedOption,
  cvCut,
  localModelHint,
  browser,
}: Pick<AnalysisEngineProps, 'selectedOption' | 'cvCut' | 'localModelHint' | 'browser'>) {
  return (
    <>
      {cvCut === null ? null : (
        <p
          data-testid="analysis-cv-cut"
          className="rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {cvCut}
        </p>
      )}

      {/*
        Shown in ONE state only: the daemon answered and nothing in it can
        chat. Not an error — gold, because it is something the user can
        act on — and it says what to do, with a link to Ollama's download
        page (L-240), because "no chat models found" on its own is a dead
        end in an app with no support inbox.
      */}
      {localModelHint === null ? null : (
        <p
          data-testid="analysis-ollama-hint"
          className="rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {localModelHint}
          <OllamaDownloadLink idPrefix="analysis" browser={browser} />
        </p>
      )}

      <p data-testid="analysis-provider-note" className="text-xs text-ink-faint">
        {selectedOption?.note ?? 'Choose how to run this.'}
      </p>
    </>
  );
}

/**
 * Last under the box: every AI the user has agreed to, with Withdraw. Reachable
 * regardless of which option is currently picked — a consent granted earlier
 * must stay visible and revocable even after switching to Ollama or the basic
 * match. See `ConsentGate.tsx` for why this lives here and not in Settings.
 */
export function AnalysisEngineConsents({
  grantedConsents,
  onWithdrawConsent,
}: Pick<AnalysisEngineProps, 'grantedConsents' | 'onWithdrawConsent'>) {
  return <ConsentStatus granted={grantedConsents} onWithdraw={onWithdrawConsent} />;
}
