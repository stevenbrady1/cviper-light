// @vitest-environment jsdom
/**
 * The privacy copy: the owner's paragraph, and a host list that is COMPLETE.
 *
 * ============================================================================
 * WHY THE PARAGRAPH IS PINNED WORD FOR WORD
 * ============================================================================
 * Normally this repo forbids pinning copy — `privacy-promise.contract.test.ts`
 * explains at length why an allow-list of blessed sentences rots. This is the
 * exception, and the reason is the edit history of this particular paragraph.
 *
 * The owner's first draft ended "...except to reach OpenAI", naming OpenAI as
 * the only destination. It is not: the app also reaches Adzuna and Reed with
 * the user's own keys, GitHub for an update check, and whichever advert page
 * the user presses Fetch on. The owner amended it themselves. A paragraph that
 * has already drifted once into a claim that was too strong is a paragraph
 * worth holding still, and the forbid-list guard cannot catch this class:
 * "except to reach OpenAI" makes no absolute claim and walks straight through.
 *
 * ============================================================================
 * AND WHY THE HOST LIST IS CHECKED FOR COMPLETENESS, NOT CORRECTNESS
 * ============================================================================
 * `outbound-hosts.contract.test.ts` already proves no shipped code names a host
 * the registry does not list. That is a guarantee about ADDRESSES, and it was
 * silent about the two destinations that have none: the advert page the user
 * pastes, and the WebView2 runtime's own traffic to Microsoft. Both are real
 * requests leaving the machine, and neither was on the screen that says "this
 * is not a summary".
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OUTBOUND_CAPABILITIES, OUTBOUND_HOST_NAMES } from '../../../lib/outbound-hosts';
import { Settings } from '../Settings';
import { createFakeBackupPort } from '../test/fakePort';
import { createFakeFilePort } from '../../../platform/test/fakeFilePort';

import { GROUPS, PRIVACY_SUMMARY, PrivacyNotice } from './PrivacyNotice';
import { currentPrivacyPolicy } from './policyDocument';

afterEach(cleanup);

function renderSettings() {
  render(<Settings port={createFakeBackupPort()} filePort={createFakeFilePort()} />);
}

describe('the paragraph at the top of Settings → Privacy', () => {
  it('is the owner’s wording, exactly', () => {
    expect(PRIVACY_SUMMARY).toBe(
      'CViper Light runs on your computer. We have no server, no accounts, and no copy of ' +
        'your data. Your key and your CV never leave your machine except to reach the AI ' +
        'provider you choose — OpenAI, or a model running on your own PC.',
    );
  });

  it('keeps the amendment: the destination is the provider you choose, not OpenAI alone', () => {
    // The specific regression. The first draft named OpenAI as the only place a
    // key or a CV could go, which is not true of a model running locally — and
    // reads as though it were true of the whole app, which it is not either.
    expect(PRIVACY_SUMMARY).toContain('the AI provider you choose');
    expect(PRIVACY_SUMMARY).toContain('a model running on your own PC');
  });

  it('is on the Privacy screen, above the telemetry switch', () => {
    renderSettings();

    const paragraph = screen.getByTestId('settings-privacy-summary');
    expect(paragraph.textContent).toBe(PRIVACY_SUMMARY);

    // Order matters: this is the first thing a suspicious person reads.
    const telemetry = screen.getByTestId('settings-telemetry-note');
    expect(paragraph.compareDocumentPosition(telemetry) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('the list of what the app can contact is complete', () => {
  it('scans a real registry', () => {
    // Anti-inert: an empty capability list would clear every assertion below.
    expect(OUTBOUND_CAPABILITIES.length).toBeGreaterThanOrEqual(2);
  });

  it('shows every capability, with its reason', () => {
    render(<PrivacyNotice />);

    for (const entry of OUTBOUND_CAPABILITIES) {
      const item = screen.getByTestId(`privacy-capability-${entry.id}`);
      expect(item.textContent, entry.id).toContain(entry.what);
      expect(item.textContent, entry.id).toContain(entry.why);
    }
  });

  it('every capability has a heading to sit under', () => {
    render(<PrivacyNotice />);

    for (const entry of OUTBOUND_CAPABILITIES) {
      const group = GROUPS.find((candidate) => candidate.purpose === entry.purpose);
      expect(group, entry.id).toBeDefined();
      expect(screen.getByText(group?.heading ?? '')).toBeTruthy();
    }
  });

  it('explains each one in a user-readable sentence', () => {
    for (const entry of OUTBOUND_CAPABILITIES) {
      expect(entry.why.length, entry.id).toBeGreaterThan(30);
      expect(entry.why.trim().endsWith('.'), `${entry.id}: "why" is a sentence`).toBe(true);
    }
  });

  it('the advert fetch is on the screen, in plain words, tied to the button', () => {
    render(<PrivacyNotice />);

    const item = screen.getByTestId('privacy-capability-fetched-advert');
    expect(item.textContent).toContain('Fetch');
    // The two facts a user actually needs: it is their choice of page, and the
    // site sees their IP address.
    expect(item.textContent).toContain('IP address');
    expect(item.textContent).toContain('no key');
  });

  it('the WebView2 runtime is named, including that the app does not control it', () => {
    render(<PrivacyNotice />);

    const item = screen.getByTestId('privacy-capability-webview2-runtime');
    expect(item.textContent).toContain('WebView2');
    expect(item.textContent).toContain('SmartScreen');
    expect(item.textContent).toContain('cannot switch them off');
  });

  it('the telemetry note now names the fetch as one of the requests', () => {
    // The sentence this work item corrected. It listed a job search, a CV check
    // and an update check, and omitted the one request that goes to a site the
    // app has never spoken to before.
    renderSettings();

    const copy = screen.getByTestId('view-settings').textContent ?? '';
    expect(copy).toContain('The only requests it ever makes are the ones you start');
    expect(copy).toContain('a job advert you ask it to fetch');
  });

  it('the generated policy document carries the capabilities too', () => {
    // The in-app notice and the published policy are rendered from the same
    // registry. `currentPrivacyPolicy` has to actually pass the second list on,
    // and `renderPrivacyPolicy` defaults it to none.
    const policy = currentPrivacyPolicy();
    for (const entry of OUTBOUND_CAPABILITIES) {
      expect(policy, entry.id).toContain(entry.what);
      expect(policy, entry.id).toContain(entry.why);
    }
  });
});

describe('the capabilities do not weaken the host contract', () => {
  it('no capability is registered as a host name', () => {
    // The whole point of the second list. `OUTBOUND_HOST_NAMES` is the
    // allow-set that `outbound-hosts.contract.test.ts` compares real extracted
    // host names against; a sentence in it would turn a precise contract into a
    // fuzzy one that could be satisfied by prose.
    for (const entry of OUTBOUND_CAPABILITIES) {
      expect(OUTBOUND_HOST_NAMES.has(entry.id), entry.id).toBe(false);
      expect(OUTBOUND_HOST_NAMES.has(entry.what), entry.id).toBe(false);
    }
  });

  it('the host allow-set still holds only things shaped like host names', () => {
    // A host name has no spaces. If one ever does, something that is not an
    // address has been added to the set the guard trusts.
    for (const name of OUTBOUND_HOST_NAMES) {
      expect(name, `${name} is not a host name`).toMatch(/^[A-Za-z0-9.-]+$/);
    }
  });
});
