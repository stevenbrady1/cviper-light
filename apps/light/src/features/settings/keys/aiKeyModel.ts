/**
 * What an AI key card says, and what is wrong with what was typed.
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
 * asserts it REFUSES one. Bolting an AI provider into that list would mean
 * widening a closed union, weakening a deliberate guard, and sending an AI key
 * to Adzuna to find out whether it works.
 *
 * So this is its own small section with its own command. Every card looks the
 * same on screen because they do the same job; underneath they share nothing
 * but the credential store and the design tokens.
 *
 * ============================================================================
 * THE KEY GOES IN AND NOT ONE CHARACTER COMES BACK
 * ============================================================================
 * There is no reveal affordance, and nothing here displays any part of a saved
 * key. The saved state is a fixed row of bullets derived from the
 * `secret_status` BOOL — it asks the credential store for nothing beyond "is
 * there one?".
 *
 * An earlier version of this card showed `••••abcd`, the last four characters,
 * computed in Rust. It was removed before shipping: the command it needed took
 * any `SecretKey`, so it exposed a four-character tail of every credential the
 * app stores — both AI keys and all three job-board ones — to answer a question
 * only this card was asking. Telling two keys apart is not worth that.
 */
import { ANTHROPIC_DEFAULT_MODEL } from '@cviper/ai-providers';

import { OPENAI_DEFAULT_MODEL } from '../../analysis/providers';

import { MAX_KEY_BYTES } from './model';

/**
 * Which AI key. A closed set, so a provider added later is a compile error at
 * every site that has to change, rather than a card that silently reads the
 * wrong credential.
 *
 * ============================================================================
 * TWO GUARDS READ THIS DECLARATION. LEAVE IT HERE, SPELLED LIKE THIS.
 * ============================================================================
 *   * `privacy/configurableAi.contract.test.ts` parses it OUT OF THIS FILE with
 *     a regular expression, to check the privacy paragraph and the generated
 *     policy name every provider a user can actually configure. Moving the
 *     declaration to another file empties that guard rather than failing it.
 *   * `keys/aiKeyProviders.ts` mirrors it as a runtime VALUE, because
 *     `analysis/providers.ts` has to decide what the picker may offer while the
 *     app is running, and a type cannot answer that (L-102).
 */
export type AiKeyProviderId = 'openai' | 'anthropic';

/** Spelled exactly as the `SecretKey` enum serialises it in Rust. */
export const OPENAI_SECRET_KEY = 'openai_api_key';

/** Spelled exactly as the `SecretKey` enum serialises it in Rust. */
export const ANTHROPIC_SECRET_KEY = 'anthropic_api_key';

/**
 * What a saved key looks like on screen: four bullets, and nothing else.
 *
 * A FIXED string, deliberately not one bullet per character. The length of an
 * API key is a small fact about it, and rendering it would be one more thing a
 * screenshot gives away in return for nothing.
 */
export const AI_KEY_SAVED_MASK = '••••';

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
 * Checked here first so a blank box never costs a round trip to the provider
 * to find out it was blank. Rust checks both of these again — neither side
 * trusts the other — and neither message ever repeats the value back.
 *
 * `label` names the card asking, so the sentence a user reads always names the
 * provider they are actually pasting a key for.
 */
export function validateAiKey(value: string, label: string): string | null {
  const key = normaliseAiKey(value);

  if (key === '') return `Paste your ${label} API key before testing it.`;

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
 * here — for OpenAI specifically — so this side can be tested without a
 * socket, and `the_card_repeats_these_sentences_word_for_word` in `providers.rs`
 * reads this file and asserts the two agree — a reworded Rust sentence fails
 * the build rather than quietly making these constants a lie.
 *
 * Only OpenAI's wording is pinned this way. `key_test_message` builds every
 * provider's sentence from the exact same template with only the name
 * substituted, so there is nothing provider-specific left for a second set of
 * constants to prove — the card renders whatever Rust sends it, for either
 * provider, and `AiKeySetup.anthropic.test.tsx` drives that path directly.
 *
 * Each one names a DIFFERENT fix. A refused key is re-pasted, a network fault
 * is retried, and a rate limit is waited out. Collapsing them into "something
 * went wrong" would send a user with a working key off to re-read it.
 *
 * None of them contains a status code, a digit, or a single byte of the
 * provider's response — the test never reads the body at all.
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

/** Every sentence Rust can produce for a failed key test, for OpenAI. */
export const AI_KEY_TEST_SENTENCES: readonly string[] = [
  AI_KEY_REFUSED,
  AI_KEY_UNREACHABLE,
  AI_KEY_RATE_LIMITED,
  AI_KEY_PROVIDER_FAULT,
  AI_KEY_REQUEST_REFUSED,
];

/** The key worked but the credential store would not keep it. Names no provider. */
export const AI_KEY_SAVE_REFUSED =
  'The key worked, but this computer’s credential store would not keep it.';

/**
 * What a passed test means, for a named provider.
 *
 * Says the key was accepted AND that it is now saved, because those are two
 * separate facts and the user just pressed one button for both.
 */
function keyPassMessage(label: string): string {
  return (
    `${label} accepted the key, and it is saved in this computer’s credential store. ` +
    `It never leaves this computer except to ${label}.`
  );
}

/** What removing a saved key means, for a named provider. */
function keyRemovedMessage(label: string): string {
  return `Your ${label} key has been removed from this computer’s credential store.`;
}

export interface AiKeyProvider {
  readonly id: AiKeyProviderId;
  readonly label: string;
  readonly secret: string;
  /** What having this key lets the user do. One sentence, concrete. */
  readonly unlocks: string;
  /** Who pays, stated plainly. Never an estimate of how much. */
  readonly billing: string;
  /** The provider's own key page. Opened in the user's real browser. */
  readonly signupUrl: string;
  readonly signupLabel: string;
  /** Where the key goes, and that it can never be shown back. */
  readonly privacyNote: string;
  readonly fieldLabel: string;
  readonly fieldHint: string;
  /** Shown once the key has been tested and saved. */
  readonly passMessage: string;
  /** Shown once the key has been removed. */
  readonly removedMessage: string;
}

/**
 * ============================================================================
 * THE SIGNUP LINK IS A REGISTERED HOST, NOT A CONVENIENCE
 * ============================================================================
 * Every `signupUrl` below is an entry in `lib/outbound-hosts.ts` with a stated
 * reason, exactly as `developer.adzuna.com` and `www.reed.co.uk` are for the
 * two job boards. `outbound-hosts.contract.test.ts` fails the build on any host
 * that is not in that registry, and the privacy notice is GENERATED from it —
 * so adding the link and telling the user about it are the same act.
 *
 * The app never loads the page. It hands the address to the user's own browser
 * through `platform/browser.ts`, which is why the registry files each one
 * under `opened-in-your-browser` rather than anything that carries a
 * credential.
 */
interface AiKeyProviderCopy {
  readonly id: AiKeyProviderId;
  readonly label: string;
  readonly secret: string;
  readonly defaultModel: string;
  readonly signupUrl: string;
  /** The billing sentence: who pays, and — where it is known — what it costs. */
  readonly billing: string;
}

function buildAiKeyProvider(copy: AiKeyProviderCopy): AiKeyProvider {
  const { id, label, secret, defaultModel, signupUrl, billing } = copy;
  return {
    id,
    label,
    secret,
    unlocks:
      `Adds “${label} · ${defaultModel}” to the analysis screen as a way of reading your CV. ` +
      'It is a full reading available without installing anything, and it is the one option ' +
      `that sends your CV and the advert to ${label}.`,
    billing,
    signupUrl,
    signupLabel: 'Where do I get a key?',
    privacyNote:
      'The key is stored in this computer’s own credential store — Windows Credential Manager, ' +
      'macOS Keychain, or the Linux Secret Service. It is never written to a file, never put in ' +
      `your backup, and never sent anywhere except to ${label}. CViper cannot show it back to you ` +
      'afterwards — not even the last few characters — so if you lose it, paste it again.',
    fieldLabel: 'API key',
    fieldHint: 'Paste the whole value, including the prefix.',
    passMessage: keyPassMessage(label),
    removedMessage: keyRemovedMessage(label),
  };
}

export const OPENAI_KEY_PROVIDER: AiKeyProvider = buildAiKeyProvider({
  id: 'openai',
  label: 'OpenAI',
  secret: OPENAI_SECRET_KEY,
  defaultModel: OPENAI_DEFAULT_MODEL,
  signupUrl: 'https://platform.openai.com/api-keys',
  billing:
    'An OpenAI key is not free. OpenAI bills your own account for what you use, at their ' +
    'published rates. CViper adds nothing to that, takes no cut, and never sees your bill.',
});

export const ANTHROPIC_KEY_PROVIDER: AiKeyProvider = buildAiKeyProvider({
  id: 'anthropic',
  label: 'Anthropic',
  secret: ANTHROPIC_SECRET_KEY,
  defaultModel: ANTHROPIC_DEFAULT_MODEL,
  signupUrl: 'https://console.anthropic.com/settings/keys',
  billing:
    'Anthropic bills your own account; a typical CV check costs a few pence. CViper adds ' +
    'nothing to that, takes no cut, and never sees your bill.',
});

/**
 * Every card, keyed by id — what `AiKeySetup` iterates over to render one
 * article per provider in `AI_KEY_PROVIDER_IDS`.
 */
export const AI_KEY_PROVIDERS: Readonly<Record<AiKeyProviderId, AiKeyProvider>> = {
  openai: OPENAI_KEY_PROVIDER,
  anthropic: ANTHROPIC_KEY_PROVIDER,
};
