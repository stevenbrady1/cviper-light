import { type BrowserPort } from '../../platform/browser';
import { ConsentStatus } from '../analysis/ConsentGate';
import { type ConsentProviderKind } from '../analysis/consent';
import { OllamaDownloadLink } from '../analysis/OllamaDownloadLink';
import { type ProviderOption } from '../analysis/providers';

export interface TailorEngineProps {
  readonly options: readonly ProviderOption[];
  readonly optionKey: string;
  readonly selectedOption: ProviderOption | null;
  readonly onOptionChange: (key: string) => void;
  readonly aiAvailable: boolean;
  readonly availabilityRead: boolean;
  /** Said when the chosen AI will not read the whole CV (L-302), else `null`. */
  readonly cvCut: string | null;
  readonly localModelHint: string | null;
  readonly browser: BrowserPort;
  readonly grantedConsents: readonly ConsentProviderKind[];
  readonly onWithdrawConsent: (kind: ConsentProviderKind) => void;
}

/** Tailor, step 3: which AI writes it, and what that means for the CV. */
export function TailorEngine({
  options,
  optionKey,
  selectedOption,
  onOptionChange,
  aiAvailable,
  availabilityRead,
  cvCut,
  localModelHint,
  browser,
  grantedConsents,
  onWithdrawConsent,
}: TailorEngineProps) {
  return (
    <div>
      <label htmlFor="tailor-provider" className="block text-xs font-medium text-ink-muted">
        How to write it
      </label>
      <select
        id="tailor-provider"
        data-testid="tailor-provider"
        value={optionKey}
        disabled={!aiAvailable}
        onChange={(event) => onOptionChange(event.currentTarget.value)}
        className="mt-1 w-full rounded-control border border-field-line bg-card px-2.5 py-1.5 text-ink"
      >
        {aiAvailable ? null : (
          <option value="">
            {availabilityRead ? 'No AI set up yet' : 'Checking what is set up…'}
          </option>
        )}
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <p data-testid="tailor-provider-note" className="mt-1 text-xs text-ink-faint">
        {selectedOption?.note ??
          'Writing needs AI. AI on this PC keeps your CV here; AI from a company sends it to that company.'}
      </p>
      {cvCut === null ? null : (
        <p
          data-testid="tailor-cv-cut"
          className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {cvCut}
        </p>
      )}

      {localModelHint === null ? null : (
        <p
          data-testid="tailor-ollama-hint"
          className="mt-2 rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {localModelHint}
          <OllamaDownloadLink idPrefix="tailor" browser={browser} />
        </p>
      )}

      <ConsentStatus granted={grantedConsents} onWithdraw={onWithdrawConsent} />
    </div>
  );
}
