import {
  OUTBOUND_HOSTS,
  type OutboundHost,
  type OutboundPurpose,
} from '../../../lib/outbound-hosts';
import { APP_VERSION } from '../backup';

import { DATA_LOCATIONS, type DataLocation } from './dataLocations';
import { GROUPS } from './PrivacyNotice';

/**
 * The privacy policy, as a Markdown document — generated from the same
 * registry the in-app notice renders and the build is held to.
 *
 * ============================================================================
 * WHY A GENERATED DOCUMENT
 * ============================================================================
 * Apple requires a privacy policy URL for every App Store listing, even one
 * whose privacy label says "Data Not Collected" (L-84). A policy written by
 * hand is a second copy of the truth, and second copies drift: the day a host
 * is added to `lib/outbound-hosts.ts` the notice in Settings changes and the
 * page on the website does not. So the page is rendered from the registry,
 * `docs/app-store/privacy-policy.md` is a file snapshot of that render, and
 * `policyDocument.test.ts` fails the build the moment the two disagree. The
 * hosted site (CV-1394) publishes that file at cviper.ai/light/privacy.
 *
 * No date is printed: a generated document is as current as the code it was
 * generated from, and a hand-typed date would be the one thing in it that
 * could be stale.
 */

/** Where to send a question. The public issue tracker; there is no inbox. */
export const PRIVACY_CONTACT_URL = 'https://github.com/stevenbrady1/cviper-light/issues';

export interface PolicyInputs {
  readonly version: string;
  readonly hosts: readonly OutboundHost[];
  readonly locations: readonly DataLocation[];
}

function hostsFor(hosts: readonly OutboundHost[], purpose: OutboundPurpose): OutboundHost[] {
  return hosts.filter((entry) => entry.purpose === purpose);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The document, as Markdown. Deterministic: same registry, same text. */
export function renderPrivacyPolicy(inputs: PolicyInputs): string {
  const lines: string[] = [];
  const push = (...text: string[]) => lines.push(...text);

  push(
    '# CViper Light privacy policy',
    '',
    `_For CViper Light ${inputs.version}. This page is generated from the app's own list of ` +
      'the addresses it may contact — the same list the app shows under Settings → Privacy, ' +
      'and the one a test holds the code to. It changes when that list changes and not ' +
      'otherwise._',
    '',
    '## The short version',
    '',
    'CViper Light has no account to create, no server of ours behind it and no analytics in ' +
      'it. Your CV text, your saved jobs and your applications are stored on your own device, ' +
      'in a database that belongs to the app. The app contacts another service only when you ' +
      'press a button that says it will, and only the services listed on this page.',
    '',
    'We — the people who make CViper Light — receive nothing from it. Not your CV, not your ' +
      'searches, not your keys, not whether you use it at all. No address on this page belongs ' +
      'to us.',
    '',
    '## What the app keeps, and where',
    '',
  );

  for (const location of inputs.locations) {
    push(`- **${capitalise(location.what)}** — ${location.where}.`);
  }

  push(
    '',
    '## Every address the app can contact',
    '',
    'This is not a summary. It is the exact set of addresses the code is allowed to name; a ' +
      'test fails the build if one is added without appearing here.',
    '',
  );

  for (const group of GROUPS) {
    const hosts = hostsFor(inputs.hosts, group.purpose);
    if (hosts.length === 0) continue;
    push(`### ${group.heading}`, '', group.meaning, '');
    for (const entry of hosts) {
      push(`- \`${entry.host}\` — ${entry.why}`);
    }
    push('');
  }

  push(
    '## Services you may choose to use',
    '',
    'If you paste an API key for OpenAI, Anthropic, Adzuna or Reed, the app sends the request ' +
      'you start to that service under your own account, and that service handles what it ' +
      'receives under its own privacy policy, not this one. The key itself is stored in your ' +
      "device's credential store (the Keychain on Apple devices, Credential Manager on " +
      'Windows), and the app has no way to read it back into the screen.',
    '',
    'If you run Ollama, the analysis goes to that program on the same device and not to the ' +
      'internet.',
    '',
    'A keyless job-board link is handed to your own browser. What that site sees is what your ' +
      'browser shows it; the app is not involved from then on.',
    '',
    '## Deleting your data',
    '',
    'Settings → Delete everything removes the database, every saved key and the preferences, ' +
      'and the app returns to its first-run state. Do that before uninstalling if you want the ' +
      "keys gone as well: on some systems the credential store keeps an app's entries after " +
      'the app itself is removed.',
    '',
    '## Children',
    '',
    'CViper Light is a job-application tool and is not directed at children under 13. It ' +
      'collects no data from anyone.',
    '',
    '## Questions',
    '',
    `Ask on the public issue tracker: ${PRIVACY_CONTACT_URL}. The source code is public ` +
      'under the MIT licence, so every statement on this page can be checked against it.',
    '',
  );

  return lines.join('\n');
}

/** The policy for this build. */
export function currentPrivacyPolicy(): string {
  return renderPrivacyPolicy({
    version: APP_VERSION,
    hosts: OUTBOUND_HOSTS,
    locations: DATA_LOCATIONS,
  });
}
