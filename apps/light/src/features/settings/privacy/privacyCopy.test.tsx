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
    // Re-pinned for L-148 (13 September 2026): the product must not read as
    // tied to one AI provider, so this paragraph stopped naming any — "the
    // provider you choose" replaces "OpenAI or Anthropic" / "today that's…".
    // See the docblock on `PRIVACY_SUMMARY` in `PrivacyNotice.tsx`.
    expect(PRIVACY_SUMMARY).toBe(
      'CViper Light runs on your computer. We have no server, no accounts, and no copy of your ' +
        'data. Your CV, a pasted advert and your own AI key only ever go to the provider you ' +
        'choose, or to a model running on your own PC. Your job-board keys go only to Adzuna ' +
        'and Reed, and only when you search or test a key.',
    );
  });

  it('says a job-board key also leaves when it is TESTED, not only when you search', () => {
    // `job_test_credentials` (jobs.rs) runs a real one-result search through
    // `send_search` when the user presses "Test and save this key" in Settings.
    // An earlier draft said "only when you search", which is defensible — it IS
    // a search — but nobody pressing Save would call it searching. Unaffected
    // by L-148: this clause was never about which AI provider, and stayed.
    expect(PRIVACY_SUMMARY).toContain('only when you search or test a key');
  });

  it('scopes each promise to the thing it is actually true of', () => {
    // Earlier drafts were rejected for over-reaching in both directions: one
    // named OpenAI as the only destination a key or CV could reach, another
    // said "your key" (reading as ALL keys, when the Adzuna and Reed keys
    // leave the machine too and neither is an AI provider). L-148 added a
    // third failure mode to guard against — naming a provider at all — so each
    // clause now names its own subject without naming a brand: the CV, the
    // pasted advert and the AI key go to the chosen provider; the job-board
    // keys go to the job boards.
    expect(PRIVACY_SUMMARY).toContain(
      'Your CV, a pasted advert and your own AI key only ever go to the provider you choose',
    );
    expect(PRIVACY_SUMMARY).toContain('Your job-board keys go only to Adzuna and Reed');
  });

  it('never names an AI provider, only the choice and the local option', () => {
    // The word that used to do this work was "today" — "today that's OpenAI…",
    // a claim about what is choosable in THIS build, kept honest by
    // `configurableAi.contract.test.ts`. L-148 removed the claim instead of
    // maintaining it: there is no provider name left here to go stale, in this
    // build or the next one.
    expect(PRIVACY_SUMMARY).toContain('the provider you choose');
    expect(PRIVACY_SUMMARY).toContain('a model running on your own PC');
    expect(PRIVACY_SUMMARY).not.toContain('OpenAI');
    expect(PRIVACY_SUMMARY).not.toContain('Anthropic');
    expect(PRIVACY_SUMMARY).not.toContain('today');
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

  it('the telemetry note names the fetch AND the check that happens on launch', () => {
    // L-91 corrected this sentence to include the advert fetch, which goes to a
    // site the app has never spoken to before. L-92 corrected it again, and for
    // a sharper reason: "the ones you START" stopped being true the moment an
    // update check could happen at startup. A request the user CONSENTED to by
    // leaving a switch on is not one they started, and quietly filing it under
    // "ones you start" would be the screen telling a small lie about itself.
    renderSettings();

    const copy = screen.getByTestId('view-settings').textContent ?? '';
    expect(copy).toContain('The only requests it ever makes are ones you start or switched on');
    expect(copy).toContain('a job advert you ask it to fetch');
    // Named explicitly, with when it happens and how to stop it.
    expect(copy).toContain('once at startup');
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
