// @vitest-environment jsdom
/**
 * The OpenAI key card, driven the way a user drives it.
 *
 * ============================================================================
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE
 * ============================================================================
 * A KEY IS NEVER SAVED UNTIL OPENAI HAS ACCEPTED IT.
 *
 * The same rule the job-board wizard enforces, and the same reason: a mistyped
 * key sitting in the credential store looks exactly like a working one. The
 * analysis screen would then offer "OpenAI · gpt-4o" on the strength of it, the
 * user would pick it, and the first thing they would learn is that a
 * thirty-second wait ends in a 401.
 *
 * So the tests below never check that a "save" function was called. They look
 * at what is actually in the fake credential store afterwards.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { providerOptions, type ProviderOption } from '../../analysis/providers';
import { runAnalysis } from '../../analysis/runAnalysis';
import {
  createFakeBrowserPort,
  type FakeBrowserPort,
} from '../../../platform/test/fakeBrowserPort';

import { AiKeySetup } from './AiKeySetup';
import {
  AI_KEY_SAVED_MASK,
  AI_KEY_REFUSED,
  AI_KEY_TEST_SENTENCES,
  AI_KEY_UNREACHABLE,
  AI_KEY_RATE_LIMITED,
  MAX_KEY_BYTES,
  OPENAI_KEY_PROVIDER,
} from './aiKeyModel';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

/**
 * A key shaped like a real one, used to prove it never escapes.
 *
 * Deliberately NOT a real key, and deliberately distinctive: every leak
 * assertion in this file greps for this exact string, so a substring that
 * happened to appear for another reason would be a false pass.
 */
const SENTINEL = 'sk-proj-SENTINELVALUE1234';

/**
 * Its last four characters.
 *
 * These used to be allowed on screen, when the card showed `••••1234`. Since
 * the hint was removed they are forbidden like everything else, so this is now
 * a thing to assert the ABSENCE of.
 */
const SENTINEL_TAIL = '1234';

interface Harness {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly port: FakeAiKeyPort;
  readonly browser: FakeBrowserPort;
}

function renderCard(port = createFakeAiKeyPort()): Harness {
  const user = userEvent.setup();
  const browser = createFakeBrowserPort();
  render(<AiKeySetup port={port} browser={browser} />);
  return { user, port, browser };
}

/** Type a key into the box and press the button. */
async function testKey(user: Harness['user'], key: string): Promise<void> {
  const input = screen.getByTestId('ai-key-input-openai');
  input.focus();
  // `paste` rather than `type`: a long key is slow to type character by
  // character, and a key only ever arrives by paste anyway.
  await user.paste(key);
  await user.click(screen.getByTestId('ai-key-test-openai'));
}

afterEach(() => {
  cleanup();
});

describe('a key OpenAI rejects is never saved', () => {
  it('negative: a refused key is reported and NOT written to the credential store', async () => {
    const port = createFakeAiKeyPort();
    port.nextTest(err({ message: AI_KEY_REFUSED }));
    const { user } = renderCard(port);
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, SENTINEL);

    const problem = await screen.findByTestId('ai-key-problem-openai');
    expect(problem.textContent ?? '').toContain('did not accept that key');

    // The assertion that matters. Not "save was not called" — nothing is there.
    expect(port.saved()).toBeNull();
    expect(port.calls.save).toBe(0);
    expect(screen.queryByTestId('ai-key-result-openai')).toBeNull();
    expect((await screen.findByTestId('ai-key-state-openai')).getAttribute('data-state')).toBe(
      'missing',
    );
  });
});

describe('testing before saving', () => {
  it('saves the key only after OpenAI has answered', async () => {
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    expect(port.saved()).toBeNull();

    await testKey(user, SENTINEL);
    await screen.findByTestId('ai-key-result-openai');

    // The order is the feature: tested first, and only then written.
    expect(port.calls.test).toBe(1);
    expect(port.tested()).toEqual([SENTINEL]);
    expect(port.saved()).toBe(SENTINEL);
  });

  it('clears the box once the key is in the credential store', async () => {
    const { user } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, SENTINEL);
    await screen.findByTestId('ai-key-result-openai');

    // There is no reason for the value to stay in the DOM after it is saved,
    // and one good reason for it not to.
    expect((screen.getByTestId('ai-key-input-openai') as HTMLInputElement).value).toBe('');
    expect((await screen.findByTestId('ai-key-state-openai')).getAttribute('data-state')).toBe(
      'configured',
    );
  });

  it('says a key is saved with bullets alone — never any part of it', async () => {
    renderCard(createFakeAiKeyPort(SENTINEL));

    const saved = await screen.findByTestId('ai-key-saved-openai');
    const shown = saved.textContent ?? '';

    expect(shown).toContain(AI_KEY_SAVED_MASK);
    // The card once showed `••••1234`. It must not show even that much: the
    // command behind it exposed a tail of EVERY stored credential.
    expect(shown).not.toContain(SENTINEL_TAIL);
    expect(shown).not.toContain('SENTINELVALUE');
  });

  it('asks the store only whether a key exists, never for its value', async () => {
    const port = createFakeAiKeyPort(SENTINEL);
    renderCard(port);
    await screen.findByTestId('ai-key-saved-openai');

    // `status` answers a bool. There is no other read call to make, and the
    // port has no method that could make one.
    expect(port.calls.status).toBeGreaterThan(0);
    expect(Object.keys(port.calls)).toEqual(['status', 'test', 'save', 'remove']);
  });

  it('negative: a key that worked but could not be stored says exactly that', async () => {
    const port = createFakeAiKeyPort();
    port.failNext('save');
    const { user } = renderCard(port);
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, SENTINEL);

    const problem = await screen.findByTestId('ai-key-problem-openai');
    // Two different failures with two different fixes. Reporting a locked
    // keychain as "your key was refused" sends the user to re-read their key.
    expect(problem.textContent ?? '').toContain('worked');
    expect(problem.textContent ?? '').toContain('credential store');
    expect(port.saved()).toBeNull();
  });
});

describe('the sentences a failed test can produce', () => {
  it('negative: a network failure reads as a connection problem, not a bad key', async () => {
    const port = createFakeAiKeyPort();
    port.nextTest(err({ message: AI_KEY_UNREACHABLE }));
    const { user } = renderCard(port);
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, SENTINEL);

    const shown = (await screen.findByTestId('ai-key-problem-openai')).textContent ?? '';
    expect(shown).toContain('could not reach OpenAI');
    // The fix is to retry, not to re-read a key that is probably fine.
    expect(shown).not.toContain('did not accept');
    expect(port.saved()).toBeNull();
  });

  it('negative: a rate limit says to wait, and does not blame the key', async () => {
    const port = createFakeAiKeyPort();
    port.nextTest(err({ message: AI_KEY_RATE_LIMITED }));
    const { user } = renderCard(port);
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, SENTINEL);

    const shown = (await screen.findByTestId('ai-key-problem-openai')).textContent ?? '';
    expect(shown).toContain('rate-limiting');
    expect(shown).not.toContain('did not accept');
    expect(port.saved()).toBeNull();
  });

  /*
   * ==========================================================================
   * DRIVEN THROUGH THE CARD, NOT COMPARED WITH ITSELF.
   * ==========================================================================
   * This block used to assert properties of the constants — that they were
   * distinct, contained no digits, and did not say "saved". Every one of those
   * assertions would still have passed with the card deleted, because both
   * sides of the comparison were the same constant. An inert test is worse
   * than no test, because everybody believes it.
   *
   * So each sentence is now put through the real failure path and read back off
   * the rendered alert. Delete the card, or stop rendering the transport's
   * message, and every case here fails.
   */
  it.each(AI_KEY_TEST_SENTENCES.map((sentence) => [sentence]))(
    'renders this failure verbatim and saves nothing: %s',
    async (sentence: string) => {
      const port = createFakeAiKeyPort();
      port.nextTest(err({ message: sentence }));
      const { user } = renderCard(port);
      await screen.findByTestId('ai-key-card-openai');

      await testKey(user, SENTINEL);

      const alert = await screen.findByTestId('ai-key-problem-openai');
      expect(alert.textContent ?? '').toBe(sentence);
      // It is an alert, not a status: something went wrong and nothing was kept.
      expect(alert.getAttribute('role')).toBe('alert');
      expect(port.saved()).toBeNull();
      expect(port.calls.save).toBe(0);
    },
  );
});

describe('what was typed, before anything is sent', () => {
  it('negative: an empty box is caught here, without a request', async () => {
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await user.click(screen.getByTestId('ai-key-test-openai'));

    expect((await screen.findByTestId('ai-key-error-openai')).textContent ?? '').toContain(
      'Paste your OpenAI API key',
    );
    expect(port.calls.test).toBe(0);
    expect(port.saved()).toBeNull();
  });

  it('negative: a box holding only whitespace is an empty box', async () => {
    // A pasted key that turned out to be a tab is indistinguishable from an
    // empty box on screen, and OpenAI would answer it with a 401.
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, '   \t  ');

    expect((await screen.findByTestId('ai-key-error-openai')).textContent ?? '').toContain('Paste');
    expect(port.calls.test).toBe(0);
  });

  it('boundary: a single character is sent — this side does not guess at shapes', async () => {
    // Deliberately NOT refused. Only OpenAI knows what a valid key looks like,
    // and a client-side shape rule is how a legitimate key from a future format
    // gets rejected by an app that cannot be updated fast enough.
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, 'k');

    expect(screen.queryByTestId('ai-key-error-openai')).toBeNull();
    expect(port.calls.test).toBe(1);
    expect(port.tested()).toEqual(['k']);
  });

  it('boundary: leading and trailing whitespace is trimmed before testing AND saving', async () => {
    // Copying a key out of a terminal or a text file brings a trailing newline
    // every time, and a newline cannot go into an HTTP header at all. The
    // tested value and the saved value must be the same bytes.
    const { user, port } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await testKey(user, `  ${SENTINEL}\n`);
    await screen.findByTestId('ai-key-result-openai');

    expect(port.tested()).toEqual([SENTINEL]);
    expect(port.saved()).toBe(SENTINEL);
  });

  it('boundary: a long but legal key is accepted, and one byte over the limit is not', async () => {
    // Five hundred characters is several times any real OpenAI key and well
    // inside the credential store's limit, so it must go through.
    const long = renderCard();
    await screen.findByTestId('ai-key-card-openai');
    await testKey(long.user, 'k'.repeat(500));
    await screen.findByTestId('ai-key-result-openai');
    expect(long.port.calls.test).toBe(1);

    cleanup();

    // One byte past the limit the credential store enforces is refused HERE,
    // rather than after a successful test — which is the sequence
    // test-before-save exists to prevent.
    const over = renderCard();
    await screen.findByTestId('ai-key-card-openai');
    await testKey(over.user, 'k'.repeat(MAX_KEY_BYTES + 1));

    expect((await screen.findByTestId('ai-key-error-openai')).textContent ?? '').toContain(
      'too long',
    );
    expect(over.port.calls.test).toBe(0);
  });

  it('announces an invalid box to a screen reader, not just in colour', async () => {
    // The pairing `NewApplicationForm` uses on every field: `aria-invalid` says
    // something is wrong, `aria-describedby` says what. Colour alone reaches
    // nobody using a screen reader, and this is the one control on the card.
    const { user } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    const input = screen.getByTestId('ai-key-input-openai');
    // Nothing is wrong yet, so nothing is announced.
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();

    await user.click(screen.getByTestId('ai-key-test-openai'));

    const error = await screen.findByTestId('ai-key-error-openai');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The link has to land on the element that actually holds the sentence.
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.id.length).toBeGreaterThan(0);

    // And it clears as soon as the user starts fixing it.
    await user.type(input, 'k');
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('where to get a key', () => {
  it('opens OpenAI’s key page in the real browser, not in the app', async () => {
    const { user, browser } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await user.click(screen.getByTestId('ai-key-signup-openai'));

    // The fake applies the REAL scheme check, so this also proves the app would
    // have been allowed to open it.
    expect(browser.opened()).toEqual(['https://platform.openai.com/api-keys']);
  });

  it('the link is a host the outbound registry knows about', async () => {
    // Not a style rule. `outbound-hosts.contract.test.ts` fails the build on any
    // host in shipped code that the registry does not list, and the privacy
    // notice is generated from that same list — so a link the user can press is
    // a link the notice tells them about.
    const { OUTBOUND_HOST_NAMES } = await import('../../../lib/outbound-hosts');
    const host = new URL(OPENAI_KEY_PROVIDER.signupUrl).hostname;

    expect(host).toBe('platform.openai.com');
    expect(OUTBOUND_HOST_NAMES.has(host)).toBe(true);
  });
});

describe('the key never reaches anywhere it could be read', () => {
  /**
   * ==========================================================================
   * ONE SENTINEL, DRIVEN THROUGH THE WHOLE JOURNEY.
   * ==========================================================================
   * Saved, rendered in its saved state, and then used for an analysis that
   * comes back 401 — which is the path that actually leaked. OpenAI's 401 body
   * quotes the rejected key back, masked, and that text used to be passed
   * verbatim into the analysis error banner.
   *
   * Everything is watched at once: every `console.*` call, the error string the
   * analysis returns, and the rendered markup.
   *
   * `innerHTML`, NOT `textContent`. Text content is only what a person reads;
   * a key leaked into `value=`, `title=`, `placeholder=` or a `data-*`
   * attribute is every bit as exposed — it is in the DOM, in a screenshot of
   * the inspector, and in anything that serialises the page — and
   * `textContent` cannot see any of it.
   */
  it('never appears in the markup, in any console call, or in an analysis error', async () => {
    const spoken: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        spoken.push(args.map((argument) => String(argument)).join(' '));
      }),
    );

    try {
      // ── Save it ───────────────────────────────────────────────────────────
      const { user, port } = renderCard();
      await screen.findByTestId('ai-key-card-openai');

      await testKey(user, SENTINEL);
      await screen.findByTestId('ai-key-result-openai');
      expect(port.saved()).toBe(SENTINEL);

      // ── Look at the saved state, attributes included ──────────────────────
      await screen.findByTestId('ai-key-saved-openai');
      const markup = document.body.innerHTML;

      // ── Run an analysis that 401s, with the key quoted in the body ────────
      const openai = providerOptions({
        ollamaRunning: false,
        ollamaModels: [],
        anthropicKey: false,
        openaiKey: true,
      }).find((option) => option.kind === 'openai') as ProviderOption;

      const refusing: ChatTransport = {
        chat: (): Promise<Result<ProviderHttpResponse, ProviderError>> =>
          Promise.resolve(
            ok({
              status: 401,
              body: JSON.stringify({
                error: {
                  // Exactly the shape OpenAI returns, sentinel and all.
                  message: `Incorrect API key provided: ${SENTINEL}. You can find your API key at https://platform.openai.com/account/api-keys.`,
                  type: 'invalid_request_error',
                  code: 'invalid_api_key',
                },
              }),
            }),
          ),
        listModels: (): Promise<Result<ProviderHttpResponse, ProviderError>> =>
          Promise.resolve(ok({ status: 200, body: '{"data":[]}' })),
      };

      const run = await runAnalysis(
        {
          option: openai,
          cvText:
            'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
            'stress testing, IFRS 9 impairment models, stakeholder reporting.',
          jobText:
            'Credit Risk Analyst. You will build SQL models, run stress tests and report on ' +
            'IFRS 9 impairment to the CRO. Python experience essential.',
        },
        () => refusing,
        // A user who reaches a real 401 has already cleared the consent gate
        // (L-97) — that is a separate screen this file does not drive. What
        // this test is actually about is the 401 body itself never leaking,
        // so consent is granted outright rather than re-tested here.
        () => Promise.resolve(true),
      );

      expect(run.ok).toBe(false);
      const analysisError = run.ok ? '' : run.error.message;

      // ── The verdict ───────────────────────────────────────────────────────
      const everywhere = [markup, analysisError, ...spoken].join('\n');

      expect(everywhere).not.toContain(SENTINEL);
      expect(everywhere).not.toContain('SENTINELVALUE');
      // Not even the distinctive prefix of a real OpenAI project key.
      expect(everywhere).not.toContain('sk-proj');
      // And, since the hint was removed, not even the last four characters.
      expect(markup).not.toContain(SENTINEL_TAIL);

      // The saved state is still shown — as bullets, which carry nothing.
      expect(markup).toContain(AI_KEY_SAVED_MASK);

      // And the banner still says something useful about what went wrong.
      expect(analysisError).toContain('Settings');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('the card never claims a primary action', () => {
  it('renders no primary button — Settings already has one', async () => {
    renderCard();
    await screen.findByTestId('ai-key-card-openai');

    // Blue means "this is the thing this screen is for", exactly once per view.
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(0);
  });

  it('offers nothing to remove when there is nothing saved', async () => {
    renderCard();

    const remove = (await screen.findByTestId('ai-key-remove-openai')) as HTMLButtonElement;
    // Disabled, never hidden: a control that comes and goes is one the user
    // cannot learn.
    expect(remove.disabled).toBe(true);
  });

  it('removes a saved key and says so', async () => {
    const { user, port } = renderCard(createFakeAiKeyPort(SENTINEL));
    await screen.findByTestId('ai-key-card-openai');

    await user.click(screen.getByTestId('ai-key-remove-openai'));

    await screen.findByTestId('ai-key-result-openai');
    expect(port.saved()).toBeNull();
    expect((await screen.findByTestId('ai-key-state-openai')).getAttribute('data-state')).toBe(
      'missing',
    );
    // The saved row goes with it.
    expect(screen.queryByTestId('ai-key-saved-openai')).toBeNull();
  });

  it('reads a credential store that will not answer as unreadable, never as empty', async () => {
    const port = createFakeAiKeyPort(SENTINEL);
    port.makeUnreadable();
    renderCard(port);

    // Reporting a locked keychain as "no key saved" invites the user to paste a
    // key they have already saved, and to conclude the app forgot it.
    const pill = await screen.findByTestId('ai-key-state-openai');
    expect(pill.getAttribute('data-state')).toBe('unreadable');
  });
});
