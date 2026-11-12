import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import { updateCheckOnLaunchEnabled } from '../features/settings/updates/launchCheck';
import { nextStateAfterCheck } from '../features/settings/updates/model';
import { createTauriUpdatePort, type UpdatePort } from '../features/settings/updates/port';
import { detectMobileOs } from '../platform/os';

export interface LaunchUpdateInput {
  /** `AppProps.updatePort`. */
  readonly updatePort: UpdatePort | undefined;
  /** `AppProps.readUpdateCheckOnLaunch`. */
  readonly readUpdateCheckOnLaunch: (() => boolean) | undefined;
}

export interface LaunchUpdate {
  /** The one port, shared with Settings. */
  readonly updatePortInstance: UpdatePort;
  readonly offeredUpdate: {
    readonly version: string;
    readonly notes: string | null;
  } | null;
  readonly setOfferedUpdate: Dispatch<
    SetStateAction<{
      readonly version: string;
      readonly notes: string | null;
    } | null>
  >;
  readonly installPhase: 'idle' | 'installing' | 'installed';
  readonly onInstallUpdate: () => Promise<void>;
}

/**
 * The update check on launch, and installing what it offers.
 *
 * Moved word for word out of `App` (L-373). Called where its effect was, so
 * it still runs in the same order among the shell's others.
 */
export function useLaunchUpdate({
  updatePort,
  readUpdateCheckOnLaunch,
}: LaunchUpdateInput): LaunchUpdate {
  /**
   * The update offered by the check on launch, or `null` for the usual case.
   *
   * ============================================================================
   * ONE PORT, SHARED WITH SETTINGS
   * ============================================================================
   * `install` can only install the update the last `check` found, and that
   * handle lives inside the port. A second port here would leave the banner's
   * Install button with nothing to install.
   */
  const updatePortInstance = useMemo(() => updatePort ?? createTauriUpdatePort(), [updatePort]);
  const [offeredUpdate, setOfferedUpdate] = useState<{
    readonly version: string;
    readonly notes: string | null;
  } | null>(null);
  const [installPhase, setInstallPhase] = useState<'idle' | 'installing' | 'installed'>('idle');

  /**
   * Look for a newer version once, at startup, unless the user said not to.
   *
   * ============================================================================
   * THE PREFERENCE IS READ BEFORE ANYTHING IS REQUESTED
   * ============================================================================
   * That ordering is the whole promise. Reading it afterwards would mean the
   * request the user switched off had already been made, and no amount of
   * "we only use the result if..." undoes a packet that has left.
   *
   * It is SILENT about failure. Nobody asked for this check, so a banner saying
   * GitHub could not be reached would be an error message for an action the
   * user did not take. The button in Settings is where a failure is worth
   * reporting, because somebody is waiting for that answer.
   *
   * Once, on mount, and deliberately not on view changes: "check when the user
   * opens a screen" is still a request they did not ask for.
   */
  useEffect(() => {
    const readToggle = readUpdateCheckOnLaunch ?? updateCheckOnLaunchEnabled;
    if (!readToggle()) return;

    // Not on a phone. The store delivers updates there and the updater plugin
    // is not compiled into those builds at all (L-80).
    if (detectMobileOs() !== null) return;

    let cancelled = false;
    void updatePortInstance.check().then((result) => {
      if (cancelled) return;
      const next = nextStateAfterCheck(result);
      if (next.kind === 'available') {
        setOfferedUpdate({ version: next.version, notes: next.notes });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const onInstallUpdate = useCallback(async () => {
    setInstallPhase('installing');

    const installed = await updatePortInstance.install();
    // Never swallowed. A failed install must not leave the strip looking like
    // it worked; it goes back to offering, and Settings is where the reason
    // can be read in full.
    setInstallPhase(installed.ok ? 'installed' : 'idle');
  }, [updatePortInstance]);

  return { updatePortInstance, offeredUpdate, setOfferedUpdate, installPhase, onInstallUpdate };
}
