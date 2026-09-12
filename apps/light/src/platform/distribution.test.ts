/**
 * Which channel this build came from, and which way an unclear answer resolves.
 *
 * The interesting test is not "the word microsoft-store means the Store". It is
 * what happens when nothing was set — because that is the state every developer
 * build, every test run and every direct download is in, and resolving it the
 * wrong way hides the only update route those builds have.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DISTRIBUTION_ENV, MICROSOFT_STORE, channelOf, distributionChannel } from './distribution';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('channelOf', () => {
  it('recognises the Store', () => {
    expect(channelOf('microsoft-store')).toBe(MICROSOFT_STORE);
  });

  it('tolerates the spellings a workflow can produce', () => {
    expect(channelOf('  microsoft-store  ')).toBe(MICROSOFT_STORE);
    expect(channelOf('Microsoft-Store')).toBe(MICROSOFT_STORE);
  });

  it('negative: nothing set is a direct download, not a Store build', () => {
    // The default has to be the one that SHOWS the update button. A
    // direct-download build wrongly told that a Store updates it has no route
    // to a security fix at all, and nothing on screen would say so.
    expect(channelOf(undefined)).toBe('direct');
    expect(channelOf(null)).toBe('direct');
  });

  it('boundary: an empty or unrecognised value is a direct download', () => {
    expect(channelOf('')).toBe('direct');
    expect(channelOf('   ')).toBe('direct');
    expect(channelOf('store')).toBe('direct');
    expect(channelOf('msix')).toBe('direct');
    expect(channelOf('true')).toBe('direct');
  });
});

describe('distributionChannel', () => {
  it('is a direct download when the build set nothing', () => {
    expect(distributionChannel()).toBe('direct');
  });

  it('reads the real build variable, so the wiring is not decorative', () => {
    // Against the actual `import.meta.env` name, not an injected string: a
    // function that parsed a value nobody ever hands it would pass every test
    // above while the app read a variable that is never set.
    vi.stubEnv(DISTRIBUTION_ENV, 'microsoft-store');
    expect(distributionChannel()).toBe(MICROSOFT_STORE);
  });

  it('negative: a value that is not the Store leaves it a direct download', () => {
    vi.stubEnv(DISTRIBUTION_ENV, 'somewhere-else');
    expect(distributionChannel()).toBe('direct');
  });
});
