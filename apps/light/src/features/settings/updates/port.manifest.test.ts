/**
 * What the port does with each answer the updater endpoint can give (L-92).
 *
 * ============================================================================
 * FOUR MANIFEST STATES, ONE TEST EACH
 * ============================================================================
 * The endpoint is now a fixed URL whose asset is replaced on every release, so
 * these four are the states that URL can actually be in:
 *
 *   * NEWER      — a manifest offering a version above this build.
 *   * SAME       — a manifest offering this build, which the plugin reports as
 *                  "nothing newer" rather than as an update.
 *   * MALFORMED  — the asset was replaced by something that is not the JSON the
 *                  plugin expects. A half-finished upload looks exactly like
 *                  this.
 *   * UNVERIFIED — the manifest parsed, but a signature does not verify against
 *                  the key baked into this binary.
 *
 * The last two matter most and are the ones a fake port cannot express: they
 * are what the PLUGIN throws, so they are driven by mocking the plugin itself
 * rather than the port around it. What is being tested is the translation —
 * that each becomes a sentence the user can act on instead of a stack trace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock('@tauri-apps/plugin-updater', () => ({ check: plugin.check }));

const { createTauriUpdatePort } = await import('./port');

beforeEach(() => {
  plugin.check.mockReset();
});

describe('the manifest offers a NEWER version', () => {
  it('reports it, with its version and notes', async () => {
    plugin.check.mockResolvedValue({
      version: '0.2.0',
      body: 'Faster CV parsing.',
      date: '2026-09-01',
      downloadAndInstall: vi.fn(),
    });

    const result = await createTauriUpdatePort().check();

    expect(result).toEqual({
      ok: true,
      value: { version: '0.2.0', notes: 'Faster CV parsing.', date: '2026-09-01' },
    });
  });
});

describe('the manifest offers the SAME version', () => {
  it('reports nothing newer, which is not an error', async () => {
    // The plugin compares versions itself and returns null. Treating that as a
    // failure would put a red message on a screen where everything is fine.
    plugin.check.mockResolvedValue(null);

    expect(await createTauriUpdatePort().check()).toEqual({ ok: true, value: null });
  });
});

describe('the manifest is MALFORMED', () => {
  it('negative: says the release information could not be read', async () => {
    // What a half-finished upload of latest.json produces. serde fails to
    // deserialise and the plugin throws its parse error verbatim.
    plugin.check.mockRejectedValue(
      new Error('expected value at line 1 column 1 while deserializing the update response'),
    );

    const result = await createTauriUpdatePort().check();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('could not be read');
    // And it says the app is not the thing that is broken, because from the
    // user's side those are indistinguishable.
    expect(result.error.message.toLowerCase()).toContain('nothing was downloaded');
  });
});

describe('the manifest carries a signature that does not VERIFY', () => {
  it('negative: refuses it and says so in words the user can act on', async () => {
    plugin.check.mockRejectedValue(new Error('signature verification failed'));

    const result = await createTauriUpdatePort().check();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('verified as genuine');
    expect(result.error.message).toContain('releases page');
  });
});

describe('the endpoint has nothing published behind it', () => {
  it('negative: says nothing is published YET, not that the manifest is unreadable', async () => {
    // ========================================================================
    // THE STRING BELOW IS THE PLUGIN'S OWN, VERBATIM. DO NOT "TIDY" IT.
    // ========================================================================
    // An earlier version of this test fed a synthetic `404 Not Found`, which is
    // a string this code path NEVER produces — a guard sitting green over a
    // path it never touched.
    //
    // What actually happens, read out of tauri-plugin-updater 2.10.1: on a
    // non-success status `updater.rs` logs it and does NOT set `last_error`
    // (the `else` at the end of the response match). The endpoint loop then
    // ends with no release AND no error, so `check()` returns
    // `Error::ReleaseNotFound`, whose `#[error(...)]` text in `error.rs` is
    // exactly the sentence below.
    //
    // Note what it contains: the word "JSON", and NEITHER "404" NOR "not
    // found". That is precisely how it used to fall through into the
    // malformed-manifest branch and tell the user their release information
    // could not be read, when the truth is that nothing has been published.
    //
    // This is not a corner case. Until the permanent `updater` release exists,
    // EVERY check lands here, so this is the message every user sees.
    plugin.check.mockRejectedValue(
      new Error('Could not fetch a valid release JSON from the remote'),
    );

    const result = await createTauriUpdatePort().check();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('no published releases to compare against yet');
    expect(result.error.message).toContain('Nothing is wrong with your copy');
    // And explicitly NOT the parse message, which would blame the wrong thing.
    expect(result.error.message).not.toContain('could not be read');
  });

  it('boundary: a genuinely unreadable manifest still gets the parse message', async () => {
    // The two must stay distinguishable. Both concern JSON; only one of them
    // means "there is nothing published". A serde failure DOES set
    // `last_error`, so its own text is what reaches here.
    plugin.check.mockRejectedValue(new Error('expected value at line 1 column 1'));

    const result = await createTauriUpdatePort().check();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('could not be read');
    expect(result.error.message).not.toContain('no published releases');
  });
});
