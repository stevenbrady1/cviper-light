// @vitest-environment jsdom
/**
 * The privacy notice renders the registry — all of it — and every place data
 * lives. If a host is in `outbound-hosts.ts` it is on this screen, because the
 * screen is built from that list and this test proves nothing filters it out.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS } from '../../../lib/outbound-hosts';

import { DATA_LOCATIONS } from './dataLocations';
import { GROUPS, PrivacyNotice } from './PrivacyNotice';

afterEach(() => {
  cleanup();
});

describe('the privacy notice', () => {
  it('names every registered host with its reason', () => {
    render(<PrivacyNotice />);

    // Anti-inert: the registry is not empty, so an empty render cannot pass.
    expect(OUTBOUND_HOSTS.length).toBeGreaterThan(10);

    for (const entry of OUTBOUND_HOSTS) {
      const item = screen.getByTestId(`privacy-host-${entry.host}`);
      expect(item.textContent, entry.host).toContain(entry.host);
      expect(item.textContent, entry.host).toContain(entry.why);
    }
  });

  it('has a heading for every purpose the registry uses, and no purpose without a heading', () => {
    render(<PrivacyNotice />);

    const used = new Set(OUTBOUND_HOSTS.map((entry) => entry.purpose));
    for (const purpose of used) {
      const group = GROUPS.find((candidate) => candidate.purpose === purpose);
      expect(group, purpose).toBeDefined();
      expect(screen.getByText(group?.heading ?? '')).toBeTruthy();
    }
  });

  it('lists every place data lives', () => {
    render(<PrivacyNotice />);

    const text = screen.getByTestId('privacy-notice').textContent ?? '';
    for (const location of DATA_LOCATIONS) {
      expect(text, location.what).toContain(location.what);
      expect(text, location.what).toContain(location.where);
    }
  });

  it('says the list is exact, not a summary', () => {
    render(<PrivacyNotice />);
    expect(screen.getByTestId('privacy-notice').textContent).toContain('not a summary');
  });
});
