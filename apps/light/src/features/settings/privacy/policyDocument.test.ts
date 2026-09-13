/**
 * The privacy policy cannot drift from the app it describes.
 *
 * `docs/app-store/privacy-policy.md` is a FILE SNAPSHOT of the render. When
 * the registry changes, this test fails and says so; regenerate with
 *
 *     npx vitest run apps/light/src/features/settings/privacy/policyDocument.test.ts -u
 *
 * and commit the document with the change that caused it.
 */
import { describe, expect, it } from 'vitest';

import { OUTBOUND_HOSTS } from '../../../lib/outbound-hosts';

import { DATA_LOCATIONS } from './dataLocations';
import { PRIVACY_CONTACT_URL, currentPrivacyPolicy, renderPrivacyPolicy } from './policyDocument';

describe('the privacy policy document', () => {
  it('is the committed file, byte for byte', async () => {
    await expect(currentPrivacyPolicy()).toMatchFileSnapshot(
      '../../../../../../docs/app-store/privacy-policy.md',
    );
  });

  it('names every address the app can contact, and why', () => {
    const text = currentPrivacyPolicy();
    for (const entry of OUTBOUND_HOSTS) {
      expect(text, entry.host).toContain(`\`${entry.host}\``);
      expect(text, entry.host).toContain(entry.why);
    }
  });

  it('names every place the app keeps something', () => {
    const text = currentPrivacyPolicy();
    for (const location of DATA_LOCATIONS) {
      expect(text).toContain(location.where);
    }
  });

  it('is deterministic', () => {
    expect(currentPrivacyPolicy()).toBe(currentPrivacyPolicy());
  });

  it('carries no date and no hand-typed statistic', () => {
    // A generated document is as current as its source. A date would be the
    // one stale thing in it.
    const text = currentPrivacyPolicy();
    expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(text).not.toMatch(/\b(?:last|effective)\s+(?:updated|date)/i);
  });

  it('points questions at the public tracker, not at an inbox', () => {
    expect(currentPrivacyPolicy()).toContain(PRIVACY_CONTACT_URL);
    expect(PRIVACY_CONTACT_URL).toMatch(/^https:\/\/github\.com\/.+\/issues$/);
  });

  it('C1: the short version does not make the bare "only when you press a button" claim', () => {
    // The short version used to say the app contacts another service "only
    // when you press a button that says it will, and only the services
    // listed on this page" — a bare absolute that was already false twice
    // over: the launch update check to github.com defaults ON (L-92,
    // launchCheck.ts) and fires from App.tsx's mount effect with no button
    // pressed, and the Ollama probe (L-134b) does the same. FORBID the bare
    // shape rather than merely requiring the qualifying phrase to be present
    // somewhere — the bare text would satisfy a naive "contains" check too.
    const text = currentPrivacyPolicy();
    expect(text).not.toContain(
      'only when you press a button that says it will, and only the services',
    );
  });

  it('C1: the short version names both things that happen on their own, and how to stop the one that can be', () => {
    // The repo already fixed this exact class of claim once, in the
    // Settings screen's telemetry note (privacyCopy.test.tsx: "ones you
    // start or switched on"). This is the same shape for the policy
    // document: qualify the promise, then name both automatic requests —
    // the GitHub update check, which leaves the machine but is switchable,
    // and the Ollama probe, which never leaves it at all.
    const text = currentPrivacyPolicy();
    expect(text).toContain('only when you press a button that says it will, or switched it on');
    expect(text).toMatch(/GitHub releases to see whether there is a newer version/);
    expect(text).toContain('unless you switch that off in Settings');
    expect(text).toContain('asks this same computer whether Ollama is running');
    expect(text).toContain('never leaves it');
  });

  it('negative: a host added to the registry appears in the render without any other change', () => {
    const text = renderPrivacyPolicy({
      version: '9.9.9',
      hosts: [
        ...OUTBOUND_HOSTS,
        {
          host: 'api.example-provider.com',
          purpose: 'fetched-with-your-key',
          why: 'A planted entry, to prove the render reads the list it is given.',
        },
      ],
      locations: DATA_LOCATIONS,
    });
    expect(text).toContain('`api.example-provider.com`');
    expect(text).toContain('A planted entry');
    expect(text).toContain('CViper Light 9.9.9');
  });

  it('boundary: an empty group prints no heading', () => {
    const text = renderPrivacyPolicy({
      version: '0.0.0',
      hosts: OUTBOUND_HOSTS.filter((entry) => entry.purpose !== 'fetched-on-request'),
      locations: DATA_LOCATIONS,
    });
    expect(text).not.toContain('Only when you press a button, with no key');
  });
});
