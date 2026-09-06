import { describe, expect, it } from 'vitest';

import { detectMobileOs, mobileOsOf } from './os';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const WEBVIEW2 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';
const MAC_WKWEBVIEW =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('mobileOsOf', () => {
  it('recognises an iPhone and an iPad', () => {
    expect(mobileOsOf(IPHONE)).toBe('ios');
    expect(mobileOsOf(IPAD)).toBe('ios');
  });

  it('recognises Android', () => {
    expect(mobileOsOf(ANDROID)).toBe('android');
  });

  it('negative: the desktop WebViews are not phones', () => {
    // A Mac WKWebView shares its engine with the iPhone's and must not be
    // mistaken for one: on a Mac the updater IS ours to run.
    expect(mobileOsOf(WEBVIEW2)).toBeNull();
    expect(mobileOsOf(MAC_WKWEBVIEW)).toBeNull();
  });

  it('boundary: an empty user agent is a desktop', () => {
    expect(mobileOsOf('')).toBeNull();
  });

  it('edge: the words must stand alone — "iPhoneSimulatorHost" is not an iPhone', () => {
    expect(mobileOsOf('Mozilla/5.0 (X11; iPhoneSimulatorHost) Gecko')).toBeNull();
  });
});

describe('detectMobileOs', () => {
  it('answers desktop where there is no navigator at all', () => {
    // Vitest's node environment: no window, no navigator.userAgent to read.
    expect(detectMobileOs()).toBeNull();
  });
});
