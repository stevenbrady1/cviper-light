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

/** Analysis, step 3: how to check it, and what that means for the CV. */
export function AnalysisEngine({
  options,
  optionKey,
  selectedOption,
  onOptionChange,
  cvCut,
  localModelHint,
  browser,
  grantedConsents,
  onWithdrawConsent,
}: AnalysisEngineProps) {
  return (
    <div>
      <label htmlFor="analysis-provider" className="block text-xs font-medium text-ink-muted">
        How to check it
      </label>
      <select
        id="analysis-provider"
        data-testid="analysis-provider"
        value={optionKey}
        onChange={(event) => onOptionChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <p data-testid="analysis-provider-note" className="mt-1 text-xs text-ink-faint">
        {selectedOption?.note ?? 'Choose how to run this.'}
      </p>
      {cvCut === null ? null : (
        <p
          data-testid="analysis-cv-cut"
          className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
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
          className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {localModelHint}
          <OllamaDownloadLink idPrefix="analysis" browser={browser} />
        </p>
      )}

      {/*
        Reachable regardless of which option is currently picked — a
        consent granted earlier must stay visible and revocable even
        after switching to Ollama or the basic match. See
        `ConsentGate.tsx` for why this lives here and not in Settings.
      */}
      <ConsentStatus granted={grantedConsents} onWithdraw={onWithdrawConsent} />
    </div>
  );
}
