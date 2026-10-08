import { JOB_PROVIDER_IDS, PROVIDER_LABEL, type JobProviderId } from '@cviper/job-apis';

import { QUIET_BUTTON } from '../../app/buttons';
import { Hint } from '../../app/Hint';
import { type KeyState } from '../../status/environment';

import { providerAvailability } from './model';

/**
 * Which boards this search will actually contact.
 *
 * ============================================================================
 * UNTICKING A BOARD REALLY SKIPS IT
 * ============================================================================
 * The ticked set is passed straight to `searchJobs`, which only contacts the
 * providers it is given. A checkbox that filtered the RESULTS afterwards would
 * spend one of Reed's hundred daily requests to fetch a page it then threw
 * away, and the user would have no way to tell.
 *
 * ============================================================================
 * A BOARD WITH NO KEY IS DISABLED AND SAYS WHY, WITH SOMEWHERE TO GO
 * ============================================================================
 * Three different "no"s with three different fixes — no key, half a credential,
 * and a credential store that would not answer — and each one names its own.
 * Every one of them ends at the same place, so the button is right there rather
 * than in a sentence telling somebody to go and find Settings.
 *
 * Disabled, never hidden. A board that vanishes when it is not set up is a
 * board the user never learns exists, and "why can I not search Adzuna" has no
 * answer on a screen that does not mention Adzuna.
 */

interface ProviderTogglesProps {
  readonly keyStates: Readonly<Record<JobProviderId, KeyState>>;
  readonly chosen: ReadonlySet<JobProviderId>;
  readonly onToggle: (provider: JobProviderId, next: boolean) => void;
  readonly onOpenSettings: () => void;
  readonly disabled: boolean;
}

export function ProviderToggles({
  keyStates,
  chosen,
  onToggle,
  onOpenSettings,
  disabled,
}: ProviderTogglesProps) {
  return (
    <fieldset data-testid="provider-toggles" className="min-w-0">
      <legend className="text-xs font-medium text-ink-muted">Job boards with your free key</legend>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {JOB_PROVIDER_IDS.map((provider) => {
          const { usable, reason } = providerAvailability(provider, keyStates[provider]);

          return (
            <div key={provider} className="inline-flex items-center gap-1.5">
              <label className="inline-flex items-center gap-1.5 text-ink">
                <input
                  type="checkbox"
                  data-testid={`provider-${provider}`}
                  data-usable={usable}
                  checked={usable && chosen.has(provider)}
                  disabled={disabled || !usable}
                  onChange={(event) => onToggle(provider, event.currentTarget.checked)}
                  className="size-4 accent-blue"
                />
                {PROVIDER_LABEL[provider]}
              </label>

              {reason === null ? null : (
                <>
                  {/*
                    Not an alert, and one short link rather than a sentence per
                    board (L-219): a board with no key is the default state of a
                    freshly installed app, and the job-board buttons below work
                    perfectly without it. The reason is the link's description.
                  */}
                  <span
                    id={`provider-reason-${provider}`}
                    data-testid={`provider-reason-${provider}`}
                    className="sr-only"
                  >
                    {reason}
                  </span>
                  <Hint text={reason}>
                    {(trigger) => (
                      <button
                        {...trigger}
                        type="button"
                        data-testid={`provider-settings-${provider}`}
                        onClick={onOpenSettings}
                        className={`${QUIET_BUTTON} px-1 text-xs text-blue hover:bg-card hover:text-navy`}
                      >
                        set up in Settings
                      </button>
                    )}
                  </Hint>
                </>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
