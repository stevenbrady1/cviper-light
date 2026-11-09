// @vitest-environment jsdom
/**
 * L-323: "Requests today" counts requests to the boards that take a key, so it
 * means nothing to somebody with no key. It stays off the screen until a key is
 * saved, and then names only the board that has one.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type JobProviderId } from '@cviper/job-apis';

import { QUOTA_STORAGE_KEY } from '../../jobs/quotaStore';
import { createFakeBrowserPort } from '../../platform/test/fakeBrowserPort';
import { type KeyState } from '../../status/environment';

import { Search } from './Search';
import { createFakeSearchPort } from './test/fakeSearchPort';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';

async function quotaLine(keys: Record<JobProviderId, KeyState>) {
  let answered = false;
  render(
    <Search
      port={createFakeSearchPort()}
      browser={createFakeBrowserPort()}
      readKeyStates={async () => {
        answered = true;
        return await Promise.resolve(keys);
      }}
      now={NOW}
      newId={() => 'generated'}
    />,
  );
  await screen.findByTestId('search-empty');
  // The line depends on the credential store's answer, so wait for it to land.
  // Looking any sooner, "no line" would pass only because nobody had answered.
  await vi.waitFor(() => expect(answered).toBe(true));
  await act(async () => {
    await Promise.resolve();
  });
  return screen.queryByTestId('search-quota');
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the requests line waits for a key (L-323)', () => {
  it('negative: no keys, no line', async () => {
    expect(await quotaLine({ adzuna: 'missing', reed: 'missing' })).toBeNull();
  });

  it('negative: counts left over from today do not bring it back with no key', async () => {
    localStorage.setItem(
      QUOTA_STORAGE_KEY,
      JSON.stringify({ date: TODAY, counts: { reed: 12, adzuna: 3 } }),
    );
    expect(await quotaLine({ adzuna: 'missing', reed: 'missing' })).toBeNull();
  });

  it('edge: a store that cannot be read is not a saved key', async () => {
    expect(await quotaLine({ adzuna: 'unreadable', reed: 'unreadable' })).toBeNull();
  });

  it('boundary: only a Reed key shows only Reed', async () => {
    const line = await quotaLine({ adzuna: 'missing', reed: 'configured' });
    expect(line?.textContent).toBe('Requests today — Reed 0 of 100');
  });

  it('boundary: only an Adzuna key shows only Adzuna', async () => {
    const line = await quotaLine({ adzuna: 'configured', reed: 'missing' });
    expect(line?.textContent).toBe('Requests today — Adzuna 0 (allowance depends on your plan)');
  });

  it('edge: half an Adzuna credential counts, as it does for the row of boards', async () => {
    const line = await quotaLine({ adzuna: 'incomplete', reed: 'missing' });
    expect(line?.textContent).toBe('Requests today — Adzuna 0 (allowance depends on your plan)');
  });

  it('happy path: both keys show both boards, as before', async () => {
    const line = await quotaLine({ adzuna: 'configured', reed: 'configured' });
    expect(line?.textContent).toBe(
      'Requests today — Reed 0 of 100 · Adzuna 0 (allowance depends on your plan)',
    );
  });
});
