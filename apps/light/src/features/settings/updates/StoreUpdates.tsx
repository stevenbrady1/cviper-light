import { APP_VERSION } from '../backup';

import type { MobileOs } from '../../../platform/os';

/**
 * The Updates section on a phone, where updates are not ours to deliver.
 *
 * On iOS the App Store updates the app and Apple's review signs it; on
 * Android, Google Play. The updater plugin is not compiled into those builds
 * at all (Cargo.toml, lib.rs `cfg(desktop)`, `capabilities/desktop.json`), so
 * a "Check for updates" button here would have nothing to call. Rather than a
 * button that cannot work, the section says where updates come from — the
 * same promise as on the desktop, stated for this platform: nothing checks on
 * launch, nothing checks at all, because nothing here can.
 */

const STORE_NAME: Record<MobileOs, string> = {
  ios: 'the App Store',
  android: 'Google Play',
};

export interface StoreUpdatesProps {
  readonly os: MobileOs;
  /** Injected by tests. Defaults to the version this build reports. */
  readonly version?: string | undefined;
}

export function StoreUpdates({ os, version }: StoreUpdatesProps) {
  return (
    <section>
      <h2 className="font-medium text-ink">Updates</h2>

      <p data-testid="settings-store-updates" className="mt-1 text-ink-muted">
        On this device, updates come from {STORE_NAME[os]}. CViper Light does not check for them
        itself — not on launch, not in the background, not at all.
      </p>

      <p className="mt-2 text-xs text-ink-faint">
        You are on <span className="font-mono tabular-nums">{version ?? APP_VERSION}</span>
      </p>
    </section>
  );
}
