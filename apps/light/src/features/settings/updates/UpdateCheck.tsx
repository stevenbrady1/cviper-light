import { useCallback, useMemo, useState } from 'react';

import { SECONDARY_BUTTON } from '../../../app/buttons';
import { APP_VERSION } from '../backup';

import {
  NO_AUTOMATIC_CHECK_NOTE,
  describeUpdateState,
  nextStateAfterCheck,
  type UpdateState,
} from './model';
import { createTauriUpdatePort, type UpdatePort } from './port';

/**
 * Updates, on a button.
 *
 * ============================================================================
 * THERE IS NO CHECK ON LAUNCH, AND THE COPY SAYS SO.
 * ============================================================================
 * An automatic check would be a network request the user never asked for, made
 * before they have touched anything, in an app whose Settings screen says it
 * collects nothing. However harmless the payload — a version string and an IP
 * address — the promise would be false, and a promise that is false in one
 * small way is one nobody has any reason to believe about anything else.
 *
 * The absence is therefore STATED rather than merely implemented, because a
 * missing feature and a deliberate omission look identical from the outside.
 * `noAutoCheck.test.ts` and `launch.test.tsx` are the two guards that keep it
 * true as the app grows.
 *
 * ============================================================================
 * NEITHER BUTTON HERE IS BLUE.
 * ============================================================================
 * Settings already has its one primary action — Export my data. Checking for
 * updates is housekeeping, and a second blue button on the screen would stop
 * blue meaning anything at all (see `app/buttons.ts`).
 */

export interface UpdateCheckProps {
  /** Injected by tests. The real one talks to the updater plugin. */
  readonly port?: UpdatePort | undefined;
  /** Injected by tests. Defaults to the version this build reports. */
  readonly version?: string | undefined;
}

export function UpdateCheck({ port, version }: UpdateCheckProps = {}) {
  // Created once. A new port every render would drop the handle to the update
  // that `check` found, and `install` would have nothing to install.
  const updatePort = useMemo(() => port ?? createTauriUpdatePort(), [port]);
  const currentVersion = version ?? APP_VERSION;

  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  const onCheck = useCallback(async () => {
    setState({ kind: 'checking' });
    setState(nextStateAfterCheck(await updatePort.check()));
  }, [updatePort]);

  const onInstall = useCallback(async () => {
    setState({ kind: 'installing' });

    const installed = await updatePort.install();
    // Never swallowed. A download that stopped halfway with a silent return
    // leaves the user believing they are updated when they are not.
    setState(
      installed.ok ? { kind: 'installed' } : { kind: 'failed', message: installed.error.message },
    );
  }, [updatePort]);

  const busy = state.kind === 'checking' || state.kind === 'installing';
  const status = describeUpdateState(state, currentVersion);

  return (
    <section>
      <h2 className="font-medium text-ink">Updates</h2>

      <p data-testid="settings-update-note" className="mt-1 text-ink-muted">
        {NO_AUTOMATIC_CHECK_NOTE}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/*
          Disabled while a check or an install is running, never hidden. The
          control the user is looking for must not move.
        */}
        <button
          type="button"
          data-testid="settings-check-updates"
          disabled={busy}
          onClick={() => void onCheck()}
          className={SECONDARY_BUTTON}
        >
          {state.kind === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>

        {state.kind === 'available' || state.kind === 'installing' ? (
          <button
            type="button"
            data-testid="settings-install-update"
            disabled={busy}
            onClick={() => void onInstall()}
            className={SECONDARY_BUTTON}
          >
            {state.kind === 'installing' ? 'Installing…' : `Install ${state.version}`}
          </button>
        ) : null}

        <span className="text-xs text-ink-faint">
          You are on <span className="font-mono tabular-nums">{currentVersion}</span>
        </span>
      </div>

      {status === null ? null : (
        <p
          role="status"
          data-testid="settings-update-status"
          className={
            state.kind === 'failed'
              ? 'mt-2 rounded-control bg-danger/5 px-3 py-2 text-danger'
              : 'mt-2 rounded-control bg-sunken px-3 py-2 text-ink-muted'
          }
        >
          {status}
        </p>
      )}
    </section>
  );
}
