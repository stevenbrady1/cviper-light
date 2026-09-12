import { useCallback, useMemo, useState } from 'react';

import { SECONDARY_BUTTON } from '../../../app/buttons';
import { APP_VERSION } from '../backup';

import { setUpdateCheckOnLaunch, updateCheckOnLaunchEnabled } from './launchCheck';
import {
  UPDATE_CHECK_TOGGLE_LABEL,
  describeUpdateState,
  nextStateAfterCheck,
  updateCheckNote,
  type UpdateState,
} from './model';
import { createTauriUpdatePort, type UpdatePort } from './port';

/**
 * Updates: a switch, and a button that works whatever the switch says.
 *
 * ============================================================================
 * THE LAUNCH CHECK IS A CHOICE, AND THE COPY SAYS WHICH ONE IS IN FORCE.
 * ============================================================================
 * This app used to check only when the button was pressed, and said so. That
 * changed in L-92: a direct-download build has no store behind it, so nothing
 * else can tell somebody that a version with a security fix exists, and an app
 * that is only updated by users who think to go looking is an app most people
 * never update.
 *
 * What keeps that honest is that the switch is real. OFF means ZERO requests —
 * not a smaller one, not an anonymous one — and the note above it changes to
 * whichever sentence is TRUE of the current setting. A screen that said "never
 * checks on its own" while a launch check was running would teach the reader
 * that nothing else on this screen can be trusted either.
 *
 * `launch.test.tsx` pins the two things that make the switch worth having:
 * off means no request at all, and the preference is READ BEFORE anything is
 * requested. `noAutoCheck.test.ts` still pins the structural half — the updater
 * plugin has exactly one import site, so the claim stays auditable by reading
 * one short module.
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
  // Read once, from the real preference store. The switch is the component's
  // state from then on, so it still moves on a machine whose storage cannot be
  // written — it simply will not survive a restart there.
  const [checksOnLaunch, setChecksOnLaunch] = useState(() => updateCheckOnLaunchEnabled());

  const onToggleLaunchCheck = useCallback((enabled: boolean) => {
    setChecksOnLaunch(enabled);
    setUpdateCheckOnLaunch(enabled);
  }, []);

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
        {updateCheckNote(checksOnLaunch)}
      </p>

      <label className="mt-2 flex items-start gap-2">
        <input
          type="checkbox"
          data-testid="settings-update-on-launch"
          checked={checksOnLaunch}
          onChange={(event) => onToggleLaunchCheck(event.target.checked)}
          className="mt-1"
        />
        <span className="text-ink-muted">{UPDATE_CHECK_TOGGLE_LABEL}</span>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/*
          Disabled while a check or an install is running, never hidden. The
          control the user is looking for must not move. It works whatever the
          switch says: turning the launch check off is not a reason to stop
          somebody asking.
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
