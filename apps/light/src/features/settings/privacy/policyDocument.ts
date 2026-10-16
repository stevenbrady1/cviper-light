import {
  OUTBOUND_CAPABILITIES,
  OUTBOUND_HOSTS,
  type OutboundCapability,
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
 * hosted site (CV-1394) publishes that file at https://cviper.ai/privacy/.
 *
 * ============================================================================
 * THE ONE HAND-TYPED THING: THE DATE (L-231)
 * ============================================================================
 * This used to print no date, on the grounds that a hand-typed date is the one
 * thing in a generated document that can go stale. UK GDPR transparency
 * guidance expects a policy to say when it last changed, and the launch audit
 * (issue #240) asked for one. So `POLICY_LAST_UPDATED` is the date the
 * policy's WORDING last changed. Bump it whenever you change the prose below
 * or the registry the policy is rendered from — the snapshot test in
 * `policyDocument.test.ts` will already have stopped you to regenerate the
 * file, and that is the moment to bump it.
 */

/** The public issue tracker — for general questions, never personal ones. */
export const PRIVACY_CONTACT_URL = 'https://github.com/stevenbrady1/cviper-light/issues';

/** The private address for privacy questions and data-protection requests (L-231). */
export const PRIVACY_CONTACT_EMAIL = 'cviperuk@gmail.com';

/** When the policy last changed, as an ISO date. See the docblock above. */
export const POLICY_LAST_UPDATED = '2026-10-16';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2026-10-16` → `16 October 2026`. Throws on anything that is not a real day. */
export function formatPolicyDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (
    match === null ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
  ) {
    throw new Error(`Not a calendar date: ${iso}`);
  }
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()] ?? ''} ${parsed.getUTCFullYear()}`;
}

export interface PolicyInputs {
  readonly version: string;
  readonly hosts: readonly OutboundHost[];
  readonly locations: readonly DataLocation[];
  /**
   * Destinations with no fixed address (L-91). Defaults to NONE, because a pure
   * renderer renders what it is handed — `currentPrivacyPolicy` supplies the
   * real list, and `policyDocument.test.ts` asserts the rendered document
   * carries every one of them.
   */
  readonly capabilities?: readonly OutboundCapability[] | undefined;
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
      'and the one a test holds the code to. It changes when that list changes. Last ' +
      `updated: ${formatPolicyDate(POLICY_LAST_UPDATED)}._`,
    '',
    '## The short version',
    '',
    'CViper Light has no account to create, no server of ours behind it and no analytics in ' +
      'it. Your CV text, your saved jobs and your applications are stored on your own device, ' +
      'in a database that belongs to the app. The app contacts another service only when you ' +
      'press a button that says it will, or switched it on — and only the services listed on ' +
      'this page. Two things happen on their own: when the app starts it reads this app’s ' +
      'GitHub releases to see whether there is a newer version, unless you switch that off in ' +
      'Settings; and it asks this same computer whether Ollama is running, a request that ' +
      'never leaves it.',
    '',
    'We — the people who make CViper Light — receive nothing from the app itself. Not your ' +
      'CV, not your searches, not your keys. The places that hand it out — an app store, or ' +
      'GitHub, where the update check looks — may show us totals, such as how many times it ' +
      'was downloaded, without saying who you are. The one address on this page ' +
      'that is ours, cviper.ai, is only ever opened in your own browser when you tap a line ' +
      'that names it; the app never contacts it, and what that site sees is what your ' +
      'browser shows it.',
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
      'test fails the build if one is added without appearing here. Three things below have no ' +
      'fixed address — the advert page you choose, an AI service you add yourself, and Windows ' +
      'itself — so they are described instead of named.',
    '',
  );

  for (const group of GROUPS) {
    const hosts = hostsFor(inputs.hosts, group.purpose);
    const capabilities = (inputs.capabilities ?? []).filter(
      (entry) => entry.purpose === group.purpose,
    );
    if (hosts.length === 0 && capabilities.length === 0) continue;
    push(`### ${group.heading}`, '', group.meaning, '');
    for (const entry of hosts) {
      push(`- \`${entry.host}\` — ${entry.why}`);
    }
    for (const entry of capabilities) {
      push(`- **${entry.what}** — ${entry.why}`);
    }
    push('');
  }

  push(
    '## Services you may choose to use',
    '',
    'If you paste an API key for an AI provider, or for Adzuna or Reed, the app sends the ' +
      'request you start to that service under your own account, and that service handles what it ' +
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
    '## Our website',
    '',
    'cviper.ai is served by GitHub Pages, and cviper.uk and www.cviper.uk are redirected to ' +
      'it by Cloudflare. The site sets no cookies and loads no analytics script. The app ' +
      'itself never contacts it; its pages open in your own browser when you tap a line that ' +
      'names them. Like any web host, GitHub and Cloudflare see your IP address and keep ' +
      'server logs of the requests they handle, under their own privacy policies, and may ' +
      'show us traffic totals. We do not use them to identify anyone, and they cannot be ' +
      'connected to anything in the app.',
    '',
    '## Who is responsible',
    '',
    'CViper Light is made by Steven Brady, a sole trader in the United Kingdom. For the little ' +
      'personal data described here that we handle ourselves, he is the controller under UK ' +
      `data-protection law. You can reach him privately at ${PRIVACY_CONTACT_EMAIL}.`,
    '',
    '## Our lawful basis',
    '',
    'The app sends us nothing, so there is nothing from the app for us to need a lawful basis ' +
      'for. What you keep in it stays on your own device, under your control. When you send a ' +
      'request to a service you chose, that service handles it under its own terms.',
    '',
    `We handle personal data ourselves in one case: when you email ${PRIVACY_CONTACT_EMAIL}, we ` +
      'read your message and reply to it. Under the UK GDPR we do that on the basis of ' +
      'legitimate interests — yours and ours, in answering what you asked — or, when you are ' +
      'using one of your rights below, because the law requires us to respond. The server logs ' +
      'kept by our website’s hosts rest on legitimate interests too: keeping a website working ' +
      'and secure.',
    '',
    '## Your rights',
    '',
    'Under UK data-protection law you have the right to access the personal data we hold ' +
      'about you, to correct it, to delete it, to restrict or object to how we use it, and to ' +
      'have a copy in a portable form. The data the app keeps is on your own device, so you ' +
      'can see, export, change or delete it yourself at any time. For an email you sent us, ' +
      `write to ${PRIVACY_CONTACT_EMAIL} and we will reply within one month. For what a service ` +
      'you chose received, ask that service: it is the one that holds it.',
    '',
    'If you are unhappy with how we have handled your data, please tell us first so we can put ' +
      'it right. You also have the right to complain to the Information Commissioner’s Office ' +
      '(ICO), the UK’s data-protection regulator, at ico.org.uk/make-a-complaint or on ' +
      '0303 123 1113.',
    '',
    '## International transfers',
    '',
    'We transfer nothing, because the app sends nothing to us. If you choose an AI service or ' +
      'a job board, your request goes straight from your device to that service, which may be ' +
      'outside the UK — many are in the United States. That is your choice, made when you ' +
      'press the button, and the service handles what it receives under its own terms and ' +
      'safeguards. A program on your own computer, such as Ollama, keeps the request on that ' +
      'computer. GitHub and Cloudflare, who host our website, may keep their server logs ' +
      'outside the UK under their own safeguards.',
    '',
    '## How long things are kept',
    '',
    'What the app keeps on your device stays there until you delete it. Settings → Delete ' +
      'everything removes all of it at once; we cannot delete it for you, because we never ' +
      'have it. A service you chose keeps what it received for as long as its own policy ' +
      `says. An email to ${PRIVACY_CONTACT_EMAIL} is kept only for as long as we need it to ` +
      'answer you, and then deleted.',
    '',
    '## Age',
    '',
    'CViper Light is a tool for finding work, meant for people aged 16 and over. The app sends ' +
      'us nothing, so we collect no data through it from anyone, of any age.',
    '',
    '## Questions',
    '',
    `For anything about your own data, email ${PRIVACY_CONTACT_EMAIL}. General questions about ` +
      `how the app works are welcome on the issue tracker, ${PRIVACY_CONTACT_URL}, but ` +
      'everything posted there is public, so please leave out anything personal. The source ' +
      'code is public under the MIT licence, so every statement about the app on this page ' +
      'can be checked against it.',
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
    capabilities: OUTBOUND_CAPABILITIES,
  });
}
