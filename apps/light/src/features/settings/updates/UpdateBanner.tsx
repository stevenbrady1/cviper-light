import { PRIMARY_BUTTON, QUIET_BUTTON } from '../../../app/buttons';

/**
 * "There is a newer version" — offered, never forced.
 *
 * ============================================================================
 * A STRIP, NOT A MODAL
 * ============================================================================
 * The user opened this app to do something, and it was not this. A modal on
 * launch takes the window away from the thing they came for, and the reliable
 * consequence is that people learn to dismiss it without reading — which makes
 * the one update that actually matters invisible too.
 *
 * So it is a strip above the view: the app is fully usable behind it, there is
 * a dismiss that installs nothing, and the install is one press for the people
 * who want it.
 *
 * ============================================================================
 * THE RELEASE NOTES ARE SHOWN, NOT SUMMARISED
 * ============================================================================
 * "An update is available" tells somebody nothing they can decide on. The
 * version and whatever the release said are what make "not now" an informed
 * answer rather than a reflex.
 */

export interface UpdateBannerProps {
  readonly version: string;
  readonly notes: string | null;
  /** The install is running: the controls are disabled, neither disappears. */
  readonly installing: boolean;
  /** It landed. The strip stays, to say what finishes the job. */
  readonly installed: boolean;
  readonly onInstall: () => void;
  readonly onDismiss: () => void;
}

export function UpdateBanner({
  version,
  notes,
  installing,
  installed,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  return (
    <div
      role="status"
      data-testid="update-banner"
      className="flex flex-wrap items-center gap-3 border-b border-line bg-sunken px-4 py-2 md:px-6"
    >
      <p className="min-w-0 flex-1 text-ink-muted">
        {installed ? (
          <span className="font-medium text-ink">
            Version <span className="font-mono tabular-nums">{version}</span> is installed. Restart
            CViper Light to finish — your data is untouched.
          </span>
        ) : (
          <>
            <span className="font-medium text-ink">
              Version <span className="font-mono tabular-nums">{version}</span> is available.
            </span>
            {notes === null ? null : <span> {notes}</span>}
          </>
        )}
      </p>

      {/*
        Disabled while installing, never hidden. A control that vanishes
        mid-action is a control the user cannot learn. Once it is installed the
        offer is gone, because pressing it again would mean nothing.
      */}
      {installed ? null : (
        <button
          type="button"
          data-testid="update-banner-install"
          data-primary="true"
          disabled={installing}
          onClick={onInstall}
          className={PRIMARY_BUTTON}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      )}

      <button
        type="button"
        data-testid="update-banner-dismiss"
        disabled={installing}
        onClick={onDismiss}
        className={QUIET_BUTTON}
      >
        {installed ? 'Close' : 'Not now'}
      </button>
    </div>
  );
}
