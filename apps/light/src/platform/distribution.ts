/**
 * How this copy of CViper Light was delivered, and therefore who updates it.
 *
 * ============================================================================
 * WHY THE WEB LAYER HAS TO KNOW
 * ============================================================================
 * A direct download and a Microsoft Store install are the same code on the same
 * operating system with the same user agent, and they differ in exactly one way
 * that matters on screen: an installed MSIX's files are READ-ONLY, so
 * `tauri-plugin-updater` cannot replace them. The Store replaces the package
 * instead.
 *
 * `platform/os.ts` answers the same question for phones by reading the WebView's
 * user agent. That trick does not work here — there is nothing in a Windows
 * WebView2 user agent that says "packaged" — so the answer comes from the build
 * that produced this bundle.
 *
 * ============================================================================
 * THIS IS THE UI HALF OF A TWO-PART GATE, NOT THE GATE ITSELF
 * ============================================================================
 * Read this before trusting it: an environment variable is a label, and a label
 * cannot keep the updater out of a binary. What keeps it out is the Cargo
 * feature — `src-tauri/Cargo.toml` makes `tauri-plugin-updater` an OPTIONAL
 * dependency behind `default = ["updater"]`, the Store build is compiled with
 * `--no-default-features`, and `src-tauri/src/lib.rs` carries a `compile_error!`
 * that refuses to build a Store flavour with the updater switched on. The plugin
 * is not in the binary; this value only decides what Settings says about it.
 *
 * The two must therefore travel together, and that is not left to anybody
 * remembering: `lib/msix-store-build.contract.test.ts` fails the build if a
 * workflow compiles the Store flavour without also setting this variable, or
 * sets this variable without compiling the Store flavour. A build with the
 * updater compiled out and this label unset would draw a "Check for updates"
 * button that calls a plugin that is not there.
 */

/** Where the app came from. */
export type DistributionChannel = 'microsoft-store' | 'direct';

/** The Microsoft Store channel, named once so tests and guards agree on it. */
export const MICROSOFT_STORE: DistributionChannel = 'microsoft-store';

/**
 * The build-time variable that carries the answer.
 *
 * Exported so the contract test asserts against the real name rather than a
 * copy of it, and so a rename cannot leave the guard checking a string nothing
 * sets any more.
 */
export const DISTRIBUTION_ENV = 'VITE_CVIPER_DISTRIBUTION';

/**
 * A raw value to a channel.
 *
 * ============================================================================
 * ONLY THE EXACT WORD MEANS "STORE". EVERYTHING ELSE IS A DIRECT DOWNLOAD.
 * ============================================================================
 * Resolving an unrecognised value to `microsoft-store` would hide the manual
 * update check from somebody who can still use it — a direct-download build
 * whose only route to a security fix is that button, silently told to go and
 * look in a Store it did not come from. Resolving it to `direct` shows a button
 * that, in the impossible case, reports a failure the user can read.
 *
 * So the unsafe direction is the default, deliberately, and only a deliberate
 * value moves off it.
 */
export function channelOf(raw: string | undefined | null): DistributionChannel {
  return raw?.trim().toLowerCase() === MICROSOFT_STORE ? MICROSOFT_STORE : 'direct';
}

/**
 * The channel this bundle was built for.
 *
 * Wrapped in a `try` because `import.meta.env` does not exist in every runtime
 * this module's siblings are imported from, and an exception here would take
 * out the whole Settings screen over a label.
 */
export function distributionChannel(): DistributionChannel {
  try {
    const environment: unknown = import.meta.env;
    if (typeof environment !== 'object' || environment === null) return 'direct';
    const raw = (environment as Record<string, unknown>)[DISTRIBUTION_ENV];
    return channelOf(typeof raw === 'string' ? raw : undefined);
  } catch {
    return 'direct';
  }
}
