import { APP_VERSION } from '../backup';

import type { MobileOs } from '../../../platform/os';

/**
 * The Updates section wherever updates are not ours to deliver.
 *
 * On iOS the App Store updates the app and Apple's review signs it; on
 * Android, Google Play; and since L-93 on a Windows copy installed from the
 * Microsoft Store, which replaces the whole package. In all three the updater
 * plugin is not compiled into the build at all — on the phones because the
 * Cargo dependency is desktop-only (`Cargo.toml`, lib.rs `cfg(desktop)`,
 * `capabilities/desktop.json`), and in the Store flavour because it is built
 * with `--no-default-features`, which drops the `updater` feature and the crate
 * with it.
 *
 * So a "Check for updates" button here would have nothing to call. Rather than
 * a button that cannot work, the section says where updates come from — the
 * same promise as on a direct-download desktop build, stated for this channel:
 * nothing checks on launch, nothing checks at all, because nothing here can.
 */

/**
 * Everywhere an app store owns the update, not this app.
 *
 * `windows` is not an operating system in the sense `MobileOs` is — a Windows
 * copy downloaded from the releases page updates itself perfectly well. It is a
 * DISTRIBUTION CHANNEL, and it is only ever passed when
 * `platform/distribution.ts` says this bundle was built for the Store.
 */
export type StorePlatform = MobileOs | 'windows';

const STORE_NAME: Record<StorePlatform, string> = {
  ios: 'the App Store',
  android: 'Google Play',
  windows: 'the Microsoft Store',
};

export interface StoreUpdatesProps {
  readonly os: StorePlatform;
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
