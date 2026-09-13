import { KEYLESS_SOURCE_IDS, KEYLESS_SOURCE_LABEL, type KeylessSourceId } from '@cviper/job-apis';

import { KEYLESS_FILTER_NOTE, KEYLESS_INTRO } from './keylessModel';

/**
 * The two feeds that need no key, and the honest sentence about what they are.
 *
 * ============================================================================
 * NEITHER CHECKBOX IS EVER DISABLED, AND THAT IS THE WHOLE POINT
 * ============================================================================
 * `ProviderToggles` above it has three different reasons a board cannot be
 * ticked, all of them about a key. These have none: there is no credential, no
 * account and nothing to set up, so a machine with an empty credential store
 * gets real job adverts from this section on the day it is installed.
 *
 * ============================================================================
 * THE COPY IS NOT DECORATION
 * ============================================================================
 * "Browse jobs, no key needed" is the claim that sells this and also the claim
 * that would mislead: Arbeitnow is Germany-first with a UK minority, and the
 * Guardian feed is twenty public-sector-weighted items. A reader who is not
 * told that, and who presses the button and sees four adverts, concludes the
 * app is broken. `KEYLESS_INTRO` says it before they press anything, and
 * `keylessModel.test.ts` holds that sentence to naming both feeds and never
 * using the word "search".
 *
 * It is not a search, and nothing in this file calls it one. The feeds accept
 * no query at all — the narrowing happens on the user's own machine, which is
 * what `KEYLESS_FILTER_NOTE` explains where they type the words.
 */

interface KeylessFeedTogglesProps {
  readonly chosen: ReadonlySet<KeylessSourceId>;
  readonly onToggle: (source: KeylessSourceId, next: boolean) => void;
  readonly disabled: boolean;
}

export function KeylessFeedToggles({ chosen, onToggle, disabled }: KeylessFeedTogglesProps) {
  return (
    <fieldset data-testid="keyless-feeds" className="min-w-0">
      <legend className="text-xs font-medium text-ink-muted">
        Browse these free feeds — no key needed
      </legend>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {KEYLESS_SOURCE_IDS.map((source) => (
          <label key={source} className="inline-flex items-center gap-1.5 text-ink">
            <input
              type="checkbox"
              data-testid={`keyless-source-${source}`}
              checked={chosen.has(source)}
              disabled={disabled}
              onChange={(event) => onToggle(source, event.currentTarget.checked)}
              className="size-4 accent-blue"
            />
            {KEYLESS_SOURCE_LABEL[source]}
          </label>
        ))}
      </div>

      <p data-testid="keyless-intro" className="mt-1 text-xs text-ink-faint">
        {KEYLESS_INTRO}
      </p>
      <p data-testid="keyless-filter-note" className="mt-1 text-xs text-ink-faint">
        {KEYLESS_FILTER_NOTE}
      </p>
    </fieldset>
  );
}
