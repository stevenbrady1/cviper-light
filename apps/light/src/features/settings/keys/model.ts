/**
 * What each job board needs, what this machine has, and what to say about it.
 *
 * ============================================================================
 * NO REACT, NO KEYRING, NO NETWORK.
 * ============================================================================
 * Everything here is a pure function or a constant, so the rules that decide
 * what a card says can be tested exactly rather than by rendering one and
 * reading the words back off it.
 *
 * ============================================================================
 * A KEY GOES IN AND NEVER COMES BACK OUT
 * ============================================================================
 * There is no "reveal key" affordance anywhere in this feature, and there is no
 * command that could implement one — `secret_get` is a Rust-only function that
 * `generate_handler!` deliberately does not register (see the module comment in
 * `src-tauri/src/secrets.rs`). Everything on screen is derived from
 * `secret_status`, which answers a bool and nothing else.
 *
 * That is a structural decision rather than an omission, and it has a real
 * consequence for the user: a forgotten key cannot be looked up, it has to be
 * pasted again. So the copy says so, on the card, before anyone relies on the
 * opposite. `privacyNote` is where that sentence lives, and a test asserts
 * every provider has one.
 */
import { PROVIDER_LABEL, type JobApiErrorKind, type JobProviderId } from '@cviper/job-apis';

import { combineKeyState, type KeyState, type SecretKeyName } from '../../../status/environment';

/**
 * The largest credential this app will try to save, in UTF-8 BYTES.
 *
 * Must equal `MAX_SECRET_BYTES` in `src-tauri/src/secrets.rs`, which is where
 * the limit is really enforced and which counts bytes rather than characters.
 * `model.test.ts` reads that file and asserts the two numbers agree — a key
 * that passed the test and was then refused by the save would be precisely the
 * failure that testing-before-saving exists to prevent.
 */
export const MAX_KEY_BYTES = 1024;

/** UTF-8 byte length, the way Rust's `String::len` counts it. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** One box on a card. */
export interface CredentialField {
  /** Spelled exactly as the `SecretKey` enum serialises it in Rust. */
  readonly key: SecretKeyName;
  /** What the provider itself calls this credential, so the two pages match. */
  readonly label: string;
  /** One line under the box. Never an example that looks like a real key. */
  readonly hint: string;
}

export interface KeyProvider {
  readonly id: JobProviderId;
  readonly label: string;
  /** What having this key lets the user do. One sentence, concrete. */
  readonly unlocks: string;
  /** That it is free, and the REAL allowance — or that there is no one number. */
  readonly allowance: string;
  /** The provider's own signup page. Opened in the user's real browser. */
  readonly signupUrl: string;
  readonly signupLabel: string;
  /** Where the key goes, and that it can never be shown back. */
  readonly privacyNote: string;
  readonly fields: readonly CredentialField[];
}

/**
 * The two boards, in the order the search screen lists them.
 *
 * ============================================================================
 * THE ALLOWANCE SENTENCES ARE NOT INTERCHANGEABLE
 * ============================================================================
 * Reed publishes 100 requests a day for the free tier, so a number can be
 * stated and CViper can enforce a threshold against it. Adzuna's allowance
 * depends on the plan the user signed up for, is not published as one figure,
 * and cannot be queried — so the card says that, rather than inventing a number
 * that would be wrong on screen for ever. The same asymmetry runs all the way
 * down to `PROVIDER_DAILY_LIMIT` in `@cviper/job-apis`, where Adzuna is counted
 * and never blocked.
 */
export const KEY_PROVIDERS: readonly KeyProvider[] = [
  {
    id: 'adzuna',
    label: PROVIDER_LABEL.adzuna,
    unlocks:
      'Searches Adzuna, which gathers adverts from hundreds of UK job boards and company ' +
      'career pages into one feed. Results appear alongside Reed’s, marked with where they ' +
      'came from.',
    allowance:
      'The key is free. Adzuna’s daily allowance depends on the plan you sign up for and ' +
      'cannot be read back from their API, so CViper counts your Adzuna requests but never ' +
      'blocks them — inventing a limit would stop you searching when your plan still allows it.',
    signupUrl: 'https://developer.adzuna.com/signup',
    signupLabel: 'Get a free Adzuna key',
    privacyNote:
      'Both values are stored in this computer’s own credential store — Windows Credential ' +
      'Manager, macOS Keychain, or the Linux Secret Service. They are never written to a file, ' +
      'never put in your backup, and never sent anywhere except to Adzuna. CViper cannot show ' +
      'it back to you afterwards: if you lose it, paste it again.',
    fields: [
      {
        key: 'adzuna_app_id',
        label: 'App ID',
        hint: 'The shorter of the two. Adzuna shows it as “Application ID”.',
      },
      {
        key: 'adzuna_app_key',
        label: 'App Key',
        hint: 'The long one. Adzuna shows it as “Application Key”.',
      },
    ],
  },
  {
    id: 'reed',
    label: PROVIDER_LABEL.reed,
    unlocks:
      'Searches Reed directly — one of the largest UK job boards, and the stronger of the two ' +
      'for contract and day-rate roles.',
    allowance:
      'The key is free. Reed’s free tier is 100 requests a day and their API reports no ' +
      'remaining balance, so CViper keeps the count itself: a warning at 75, and searching ' +
      'pauses at 90 to keep ten back for testing a key and one urgent search. It resets at ' +
      'midnight UTC.',
    signupUrl: 'https://www.reed.co.uk/developers/jobseeker',
    signupLabel: 'Get a free Reed key',
    privacyNote:
      'The key is stored in this computer’s own credential store — Windows Credential Manager, ' +
      'macOS Keychain, or the Linux Secret Service. It is never written to a file, never put in ' +
      'your backup, and never sent anywhere except to Reed. CViper cannot show it back to you ' +
      'afterwards: if you lose it, paste it again.',
    fields: [
      {
        key: 'reed_api_key',
        label: 'API key',
        hint: 'Reed calls it your API key. It is one value, not a pair.',
      },
    ],
  },
];

export function keyProvider(id: JobProviderId): KeyProvider {
  const provider = KEY_PROVIDERS.find((candidate) => candidate.id === id);
  // Unreachable: `JobProviderId` is a closed union over this same list. Thrown
  // rather than defaulted so a future dynamic caller finds out immediately
  // instead of rendering the wrong board's signup link.
  if (provider === undefined) throw new Error(`Unknown key provider: ${id}`);
  return provider;
}

/** What `secret_status` said about each credential. `null` = it would not say. */
export type CredentialAnswers = Partial<Readonly<Record<SecretKeyName, boolean | null>>>;

/**
 * One board's state, from the answers about its credentials.
 *
 * A credential nobody has asked about yet reads as `null` — unreadable — not as
 * `false`. The screen would otherwise claim "no key saved" for the half-second
 * before the first answer arrives, which is the one moment a user is most
 * likely to be looking at it.
 */
export function providerKeyState(id: JobProviderId, answers: CredentialAnswers): KeyState {
  return combineKeyState(keyProvider(id).fields.map((field) => answers[field.key] ?? null));
}

/** Four words for four states. Never "error": three of these are not one. */
export const KEY_STATE_LABEL: Record<KeyState, string> = {
  configured: 'Key saved',
  incomplete: 'Half set up',
  missing: 'Not set up',
  unreadable: 'Could not be read',
};

/**
 * The pill's colours, following the app's grammar exactly.
 *
 * Teal is present, gold is "needs you", and a board with nothing set up is
 * quiet ink rather than a warning — no keys is the DEFAULT state, not a fault.
 * Nothing here is ever red: red is destructive and the `rejected` status, and
 * none of these four is either.
 */
export const KEY_STATE_TONE: Record<KeyState, string> = {
  configured: 'bg-teal/10 text-teal',
  incomplete: 'bg-gold/10 text-gold',
  missing: 'bg-sunken text-ink-muted',
  unreadable: 'bg-gold/10 text-gold',
};

/**
 * Name the credential that is missing, when only some of them are.
 *
 * "Half set up" on its own is a state, not an instruction. For Adzuna the user
 * has to know WHICH box is empty — and, because nothing can be read back, that
 * fixing it means entering both again rather than only the missing one.
 */
export function describeMissingCredentials(
  id: JobProviderId,
  answers: CredentialAnswers,
): string | null {
  const provider = keyProvider(id);
  const absent = provider.fields.filter((field) => answers[field.key] === false);
  if (absent.length === 0 || absent.length === provider.fields.length) return null;

  const names = absent.map((field) => field.label).join(' and ');
  return (
    `Your ${provider.label} ${names} is not saved yet, so searches will still fail. ` +
    'CViper cannot read a saved key back, so enter both values again and test them together.'
  );
}

/** What is wrong with each box. An empty object means nothing is. */
export type CandidateErrors = Partial<Record<SecretKeyName, string>>;

/**
 * Check what was typed BEFORE a request goes out.
 *
 * Rust checks the same two things again (`candidate_credentials` in `jobs.rs`)
 * and that is not redundant: this side exists so the user is told which box is
 * wrong without spending one of their hundred daily requests to find out.
 *
 * Neither the value nor its length ever appears in a message.
 */
export function validateCandidate(
  id: JobProviderId,
  values: Readonly<Partial<Record<SecretKeyName, string>>>,
): CandidateErrors {
  const provider = keyProvider(id);
  const errors: CandidateErrors = {};

  for (const field of provider.fields) {
    const value = values[field.key] ?? '';

    if (value.trim() === '') {
      errors[field.key] = `Paste your ${provider.label} ${field.label} before testing it.`;
      continue;
    }

    if (byteLength(value) > MAX_KEY_BYTES) {
      errors[field.key] =
        `That is too long to be an ${field.label}. Check that only the key was pasted, ` +
        'and nothing came with it.';
    }
  }

  return errors;
}

/**
 * What a failed test means, by KIND.
 *
 * Keyed by the union so a kind added to `@cviper/job-apis` is a compile error
 * here rather than a card that silently says nothing. The three the user can
 * actually act on differently are `auth` (the key is wrong), `network` (their
 * connection) and `rate-limit` (wait), and they read as three different things.
 *
 * No arm mentions saving, because on every one of these paths nothing was
 * saved. That is asserted by a test.
 */
export const TEST_FAILURE_HEADLINE: Record<JobApiErrorKind, string> = {
  'no-key': 'Fill in every box on this card before testing.',
  network: 'CViper could not reach this job board. Check your internet connection and try again.',
  throttled: 'That was very quick after the last request. Wait a moment and test again.',
  quota: 'Today’s request allowance for this board is used up. Try again after midnight UTC.',
  'bad-request': 'This job board would not accept the test request. Nothing was changed.',
  auth: 'That key was refused. Check it was pasted whole — a brand new key can also take a few minutes to become active.',
  'rate-limit':
    'This job board says CViper has sent too many requests. Wait a minute and test again.',
  server:
    'This job board is having trouble at their end. Nothing is wrong with your key — try again shortly.',
  'bad-response':
    'This job board answered with something CViper could not read. Try again shortly.',
};

/**
 * What a passed test means.
 *
 * A probe that found NOTHING is still a pass: the board answered 200 with a
 * well-formed body, which is the whole question being asked. Reporting an empty
 * one-result search as a failure would send the user back to re-paste a key
 * that works perfectly.
 */
export function describeTestPass(id: JobProviderId, results: number): string {
  const provider = keyProvider(id);
  const found =
    results > 0
      ? `${provider.label} answered and returned an advert.`
      : `${provider.label} accepted the key. The one-result test matched nothing, which is fine — it was a check, not a search.`;

  return `${found} The key is saved, and it never leaves this computer except to ${provider.label}.`;
}
