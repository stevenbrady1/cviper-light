// @vitest-environment jsdom
/**
 * L-150: the privacy screen and the published policy name the AI service a
 * user can add at their own address, say what goes there and when, and stop
 * claiming only two things have no fixed address.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OUTBOUND_CAPABILITIES } from '../../../lib/outbound-hosts';

import { DATA_LOCATIONS } from './dataLocations';
import { PrivacyNotice } from './PrivacyNotice';
import { currentPrivacyPolicy } from './policyDocument';

afterEach(() => {
  cleanup();
});

describe('the AI service you add yourself', () => {
  it('is on the privacy screen, tied to Settings, your agreement, and its own address', () => {
    render(<PrivacyNotice />);
    const item = screen.getByTestId('privacy-capability-your-ai-service');
    const text = item.textContent ?? '';
    expect(text).toContain('only if you add one');
    expect(text).toContain('after you agree');
    expect(text).toContain('https://');
    expect(text).toContain('never sent anywhere else');
  });

  it('is in the published policy too', () => {
    const entry = OUTBOUND_CAPABILITIES.find((candidate) => candidate.id === 'your-ai-service');
    expect(entry).toBeDefined();
    expect(currentPrivacyPolicy()).toContain(entry?.why ?? '<missing>');
  });

  it('negative: neither surface still says only two things have no fixed address', () => {
    render(<PrivacyNotice />);
    const screenText = document.body.textContent ?? '';
    for (const text of [screenText, currentPrivacyPolicy()]) {
      expect(text).not.toContain('Two things below have no fixed address');
      expect(text).toContain('Three things below have no fixed address');
      expect(text).toContain('an AI service you add yourself');
    }
  });

  it('the data list names the remembered model choice among the small conveniences', () => {
    const browser = DATA_LOCATIONS.find((location) =>
      location.what.startsWith('Small conveniences'),
    );
    expect(browser?.what).toContain('which AI model each service uses');
  });

  it('the data list says the address is kept with its key', () => {
    const keys = DATA_LOCATIONS.find((location) => location.erasedBy === 'keys');
    expect(keys?.what).toContain('the address of an AI service you added');
  });
});
