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
 * Disabled, never hidden — ONCE THIS ROW IS SHOWN. A board that vanishes
 * when it is not set up is a board the user never learns exists, so with one
 * key saved the other board stays here with its reason and its link.
 *
 * The row as a whole is not shown until a job-board key exists (L-276,
 * `hasAnyJobBoardKey`). Asking a first-time user to register on two other
 * sites is the clutter that decision removed; the keys are still one fold
 * down in Settings, under "Job-board keys (optional)".
 */

interface ProviderTogglesProps {
  readonly keyStates: Readonly<Record<JobProviderId, KeyState>>;
  readonly chosen: ReadonlySet<JobProviderId>;
  readonly onToggle: (provider: JobProviderId, next: boolean) => void;
  readonly onOpenSettings: () => void;
  readonly disabled: boolean;
  /**
   * Why a board cannot search the chosen country, or `null` (L-417). It comes
   * before the key's own reason: setting up a key would not change it, so
   * there is no link to Settings beside it.
   */
  readonly blocked: (provider: JobProviderId) => string | null;
}

export function ProviderToggles({
  keyStates,
  chosen,
  onToggle,
  onOpenSettings,
  disabled,
  blocked,
}: ProviderTogglesProps) {
  return (
    <fieldset data-testid="provider-toggles" className="min-w-0">
      <legend className="text-xs font-medium text-ink-muted">Job boards with your free key</legend>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {JOB_PROVIDER_IDS.map((provider) => {
          const noList = blocked(provider);
          const { usable, reason } =
            noList === null
              ? providerAvailability(provider, keyStates[provider])
              : { usable: false, reason: null };

          return (
            <div key={provider} className="inline-flex items-center gap-1.5">
              <label className="inline-flex min-h-11 items-center gap-1.5 text-ink md:min-h-0">
                <input
                  type="checkbox"
                  data-testid={`provider-${provider}`}
                  data-usable={usable}
                  checked={usable && chosen.has(provider)}
                  disabled={disabled || !usable}
                  aria-describedby={noList === null ? undefined : `provider-blocked-${provider}`}
                  onChange={(event) => onToggle(provider, event.currentTarget.checked)}
                  className="size-4 accent-blue"
                />
                {PROVIDER_LABEL[provider]}
              </label>

              {noList === null ? null : (
                <span
                  id={`provider-blocked-${provider}`}
                  data-testid={`provider-blocked-${provider}`}
                  className="text-xs text-ink-muted"
                >
                  {noList}
                </span>
              )}

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
                        className={`${QUIET_BUTTON} text-xs hover:text-navy`}
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
