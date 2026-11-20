import { ChipSelect } from '../../app/ChipSelect';
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

/** "… using [How to write it]": the AI chip in Tailor's line of choices (L-445). */
export function TailorEngineChip({
  options,
  optionKey,
  onOptionChange,
  aiAvailable,
  availabilityRead,
}: Pick<
  TailorEngineProps,
  'options' | 'optionKey' | 'onOptionChange' | 'aiAvailable' | 'availabilityRead'
>) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2">
      <span className="text-ink-muted">using</span>
      <ChipSelect
        id="tailor-provider"
        name="How to write it"
        testId="tailor-provider"
        value={optionKey}
        disabled={!aiAvailable}
        onChange={onOptionChange}
        empty={
          aiAvailable
            ? undefined
            : availabilityRead
              ? 'No AI set up yet'
              : 'Checking what is set up…'
        }
        options={options.map((option) => ({ value: option.key, label: option.label }))}
      />
    </span>
  );
}

/**
 * Under the advert box: what the chosen AI means for the CV — the gold notes
 * first, then the AI's own note, then what the user has agreed to (L-445).
 */
export function TailorEngineNotes({
  selectedOption,
  cvCut,
  localModelHint,
  browser,
  grantedConsents,
  onWithdrawConsent,
}: Pick<
  TailorEngineProps,
  | 'selectedOption'
  | 'cvCut'
  | 'localModelHint'
  | 'browser'
  | 'grantedConsents'
  | 'onWithdrawConsent'
>) {
  return (
    <>
      {cvCut === null ? null : (
        <p
          data-testid="tailor-cv-cut"
          className="rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {cvCut}
        </p>
      )}

      {localModelHint === null ? null : (
        <p
          data-testid="tailor-ollama-hint"
          className="rounded-control bg-gold/10 px-3 py-2 text-xs text-gold-ink"
        >
          {localModelHint}
          <OllamaDownloadLink idPrefix="tailor" browser={browser} />
        </p>
      )}

      <p data-testid="tailor-provider-note" className="text-xs text-ink-faint">
        {selectedOption?.note ??
          'Writing needs AI. AI on this PC keeps your CV here; AI from a company sends it to that company.'}
      </p>

      <ConsentStatus granted={grantedConsents} onWithdraw={onWithdrawConsent} />
    </>
  );
}
