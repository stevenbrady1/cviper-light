/**
 * Is this build running inside a phone's WebView?
 *
 * ============================================================================
 * WHY THE USER AGENT, AND NOT A PLUGIN
 * ============================================================================
 * The one thing the web layer needs to know about the platform is "are updates
 * the App Store's job here" (L-80). WKWebView on an iPhone or iPad says
 * `iPhone` / `iPad` in its user agent, and Android's WebView says `Android`;
 * both are stable and neither needs a Rust command, a plugin, a capability
 * entry, or a network request. The Rust side does not need to be asked.
 *
 * jsdom's user agent says neither, so tests get the desktop answer unless they
 * pass a string in.
 */

export type MobileOs = 'ios' | 'android';

/** `'ios'`, `'android'`, or `null` for a desktop window. */
export function mobileOsOf(userAgent: string): MobileOs | null {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'ios';
  if (/\bAndroid\b/.test(userAgent)) return 'android';
  return null;
}

/** The running platform, from the WebView's own user agent. */
export function detectMobileOs(): MobileOs | null {
  if (typeof navigator === 'undefined') return null;
  return mobileOsOf(navigator.userAgent);
}
