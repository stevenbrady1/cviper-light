/**
 * What the OpenAI key card says, and what is wrong with what was typed.
 *
 * ============================================================================
 * NO REACT, NO KEYRING, NO NETWORK.
 * ============================================================================
 * Same shape as `model.ts` next door, and for the same reason: the rules that
 * decide what a card says are pure functions, so they can be tested exactly
 * rather than by rendering one and reading the words back off it.
 *
 * ============================================================================
 * WHY THIS IS NOT AN ENTRY IN `KEY_PROVIDERS`
 * ============================================================================
 * The job-board wizard is typed to `JobProviderId` from `@cviper/job-apis` all
 * the way down, and its test step invokes `job_test_credentials`. That command
 * cannot test an AI key and is not merely unsuited to it — `jobs.rs` has a test
 * called `an_ai_credential_can_never_be_used_as_a_job_board_credential` which
 * asserts it REFUSES one. Bolting OpenAI into that list would mean widening a
 * closed union, weakening a deliberate guard, and sending an OpenAI key to
 * Adzuna to find out whether it works.
 *
 * So this is its own small section with its own command. The two cards look
 * identical on screen because they do the same job; underneath they share
 * nothing but the credential store and the design tokens.
 *
 * ============================================================================
 * THE KEY STILL GOES IN AND DOES NOT COME BACK OUT
 * ============================================================================
 * There is no reveal affordance here either. The one thing that comes back is
 * `secret_hint` — bullets and at most the last four characters, computed in
 * Rust (see `secrets.rs`). That is a deliberate, bounded weakening of the rule
 * in `secrets.rs`, made so a user with two OpenAI keys can tell which one is
 * saved. It is not enough to authenticate with and it is not the key.
 */
import { OPENAI_DEFAULT_MODEL } from '../../analysis/providers';

import { MAX_KEY_BYTES } from './model';

/**
 * Which AI key. A closed set with one member today.
 *
 * Written as a union rather than a bare string so adding Anthropic later is a
 * compile error at every site that has to change, rather than a card that
 * silently reads the wrong credential.
 */
export type AiKeyProviderId = 'openai';

/** Spelled exactly as the `SecretKey` enum serialises it in Rust. */
export const OPENAI_SECRET_KEY = 'openai_api_key';

/**
 * The byte limit, borrowed rather than redeclared.
 *
 * `model.ts` already pins this to `MAX_SECRET_BYTES` in `secrets.rs` with a
 * test that reads the Rust source. A second constant here would be a second
 * thing to drift, and a key that passed validation and was then refused by the
 * save is the exact failure test-before-save exists to prevent.
 */
export { MAX_KEY_BYTES };

/** UTF-8 byte length, the way Rust's `String::len` counts it. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Whitespace off both ends, once, in one place.
 *
 * A pasted key very often arrives with a trailing newline — copying from a
 * terminal or a text file does it every time — and a trailing newline is not a
 * cosmetic problem: it cannot go in an HTTP header at all, so the request would
 * fail before it left the machine and the user would be told their key was
 * wrong. Rust trims again on its side; this half is what makes the value that
 * was TESTED byte-identical to the value that gets SAVED.
 */
export function normaliseAiKey(value: string): string {
  return value.trim();
}

/**
 * What is wrong with what was typed, or `null`.
 *
 * Checked here first so a blank box never costs a round trip to OpenAI to find
 * out it was blank. Rust checks both of these again — neither side trusts the
 * other — and neither message ever repeats the value back.
 */
export function validateAiKey(value: string): string | null {
  const key = normaliseAiKey(value);

  if (key === '') return 'Paste your OpenAI API key before testing it.';

  if (byteLength(key) > MAX_KEY_BYTES) {
    return (
      'That is too long to be an API key. Check that only the key was pasted, ' +
      'and nothing came with it.'
    );
  }

  return null;
}

/**
 * ============================================================================
 * THE THREE SENTENCES A FAILED TEST CAN PRODUCE — AND WHERE THEY REALLY LIVE
 * ============================================================================
 * These are declared in Rust, in `provider_test_key` (`providers.rs`), because
 * that is the only place that knows what actually happened. They are repeated
 * here so this side can be tested without a socket, and
 * `AiKeySetup.test.tsx` reads `providers.rs` and asserts the two agree — a
 * reworded Rust sentence fails the build rather than quietly making these
 * constants a lie.
 *
 * Each one names a DIFFERENT fix. A refused key is re-pasted, a network fault
 * is retried, and a rate limit is waited out. Collapsing them into "something
 * went wrong" would send a user with a working key off to re-read it.
 *
 * None of them contains a status code, a digit, or a single byte of OpenAI's
 * response — the test never reads the body at all.
 */
export const AI_KEY_REFUSED =
  'OpenAI did not accept that key. Check it was pasted whole — a brand new key can take a few minutes to become active.';

export const AI_KEY_UNREACHABLE =
  'CViper could not reach OpenAI. Check your internet connection and try again.';

export const AI_KEY_RATE_LIMITED =
  'OpenAI is rate-limiting this key. Wait a moment and test it again.';

export const AI_KEY_PROVIDER_FAULT =
  'OpenAI is having trouble at their end. Nothing is wrong with your key — try again shortly.';

export const AI_KEY_REQUEST_REFUSED =
  'OpenAI would not accept the test request. Nothing was changed.';

/** Every sentence Rust can produce for a failed key test. */
export const AI_KEY_TEST_SENTENCES: readonly string[] = [
  AI_KEY_REFUSED,
  AI_KEY_UNREACHABLE,
  AI_KEY_RATE_LIMITED,
  AI_KEY_PROVIDER_FAULT,
  AI_KEY_REQUEST_REFUSED,
];

/**
 * What a passed test means.
 *
 * Says the key was accepted AND that it is now saved, because those are two
 * separate facts and the user just pressed one button for both.
 */
export const AI_KEY_PASS =
  'OpenAI accepted the key, and it is saved in this computer’s credential store. ' +
  'It never leaves this computer except to OpenAI.';

/**
 * The key worked but the credential store would not keep it.
 *
 * A distinct outcome with a distinct fix — unlock the store — and reporting it
 * as "your key was refused" would send the user to re-read a key that is fine.
 */
export const AI_KEY_SAVE_REFUSED =
  'The key worked, but this computer’s credential store would not keep it.';

export const AI_KEY_REMOVED =
  'Your OpenAI key has been removed from this computer’s credential store.';

export interface AiKeyProvider {
  readonly id: AiKeyProviderId;
  readonly label: string;
  readonly secret: string;
  /** What having this key lets the user do. One sentence, concrete. */
  readonly unlocks: string;
  /** Who pays, stated plainly. Never an estimate of how much. */
  readonly billing: string;
  /** Where to get one. No link: see the note below. */
  readonly whereFrom: string;
  /** Where the key goes, and that it can never be shown back in full. */
  readonly privacyNote: string;
  readonly fieldLabel: string;
  readonly fieldHint: string;
}

/**
 * ============================================================================
 * THERE IS NO "GET A KEY" LINK HERE, AND THAT IS NOT AN OVERSIGHT
 * ============================================================================
 * The two job-board cards link to their signup pages because
 * `developer.adzuna.com` and `www.reed.co.uk` are entries in
 * `lib/outbound-hosts.ts`. OpenAI's key page is on `platform.openai.com`, which
 * is NOT in that registry, and `outbound-hosts.contract.test.ts` fails the
 * build on any host that is not.
 *
 * That guard is right and this card obeys it. Adding the host is a product
 * decision rather than a code change — the registry's own header says so — so
 * the card names the place in words and opens nothing. `api.openai.com` is
 * already registered, which is what the test request uses.
 */
export const OPENAI_KEY_PROVIDER: AiKeyProvider = {
  id: 'openai',
  label: 'OpenAI',
  secret: OPENAI_SECRET_KEY,
  unlocks:
    `Adds “OpenAI · ${OPENAI_DEFAULT_MODEL}” to the analysis screen as a way of reading your CV. ` +
    'It is the strongest reading available without installing anything, and it is the one ' +
    'option that sends your CV and the advert to OpenAI.',
  billing:
    'An OpenAI key is not free. OpenAI bills your own account for what you use, at their ' +
    'published rates. CViper adds nothing to that, takes no cut, and never sees your bill.',
  whereFrom:
    'Create one in the API keys section of your OpenAI account, then paste the whole value here.',
  privacyNote:
    'The key is stored in this computer’s own credential store — Windows Credential Manager, ' +
    'macOS Keychain, or the Linux Secret Service. It is never written to a file, never put in ' +
    'your backup, and never sent anywhere except to OpenAI. CViper cannot show it back to you ' +
    'afterwards: the last four characters are all it will ever display, so if you lose it, ' +
    'paste it again.',
  fieldLabel: 'API key',
  fieldHint: 'Paste the whole value, including the prefix.',
};
