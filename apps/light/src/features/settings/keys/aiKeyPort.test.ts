/**
 * `createTauriAiKeyPort`, through the REAL port and a mocked `invoke` (C2,
 * coordinator review of PR #96).
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * Every existing test of the AI key cards (`AiKeySetup.test.tsx`,
 * `AiKeySetup.anthropic.test.tsx`) drives the FAKE port — proof that the fake
 * behaves as documented, not that the REAL port sends the right command with
 * the right arguments to the right credential for the right provider. Nothing
 * before this file ever called the real `createTauriAiKeyPort` at all, which
 * is exactly the class of gap `erase/port.test.ts` closed for `forgetKeys` in
 * this same PR (L-106's own lesson, repeated).
 *
 * ============================================================================
 * WHAT THIS PROVES THAT THE CONTRACT TEST CANNOT
 * ============================================================================
 * `aiKeyModel.contract.test.ts` proves each card's `secret` names the same
 * provider as its `id` — a STATIC fact about the data. This file proves the
 * PORT actually sends that `secret` (never the other provider's) to Rust for
 * every one of its four operations, and sends `providerId` — not a hardcoded
 * literal — as the `provider` argument `provider_test_key` reads. A port that
 * ignored its own arguments and always spoke to `openai_api_key` would still
 * pass the contract test (the DATA would still be correct) and only be caught
 * here, where the CALL is actually inspected.
 */
import { describe, expect, it, vi } from 'vitest';

import { ANTHROPIC_KEY_PROVIDER, OPENAI_KEY_PROVIDER } from './aiKeyModel';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { createTauriAiKeyPort } = await import('./aiKeyPort');

describe.each([
  { label: 'OpenAI', provider: OPENAI_KEY_PROVIDER },
  { label: 'Anthropic', provider: ANTHROPIC_KEY_PROVIDER },
])('$label: the real port speaks to its own credential and its own provider id', ({ provider }) => {
  const port = createTauriAiKeyPort(provider.secret, provider.id);

  it('status() asks secret_status for this provider’s own key', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(true);

    await port.status();

    expect(tauri.invoke).toHaveBeenCalledWith('secret_status', { key: provider.secret });
  });

  it('test() calls provider_test_key with this provider’s own id', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(undefined);

    await port.test('a-pasted-key');

    expect(tauri.invoke).toHaveBeenCalledWith('provider_test_key', {
      provider: provider.id,
      key: 'a-pasted-key',
    });
  });

  it('save() writes into secret_set under this provider’s own key, never the other one', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(undefined);

    await port.save('a-pasted-key');

    expect(tauri.invoke).toHaveBeenCalledWith('secret_set', {
      key: provider.secret,
      value: 'a-pasted-key',
    });
    // The negative half of the same fact: it never touched the sibling
    // provider's credential name.
    const other =
      provider.id === 'openai' ? ANTHROPIC_KEY_PROVIDER.secret : OPENAI_KEY_PROVIDER.secret;
    expect(tauri.invoke).not.toHaveBeenCalledWith('secret_set', {
      key: other,
      value: 'a-pasted-key',
    });
  });

  it('remove() deletes this provider’s own key', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockResolvedValue(undefined);

    await port.remove();

    expect(tauri.invoke).toHaveBeenCalledWith('secret_delete', { key: provider.secret });
  });
});

describe('boundary: a store that will not answer status() reads as unreadable, not missing', () => {
  it('negative: status() rejects and the port reports null, never false', async () => {
    tauri.invoke.mockReset();
    tauri.invoke.mockRejectedValue(new Error('locked'));

    const port = createTauriAiKeyPort(OPENAI_KEY_PROVIDER.secret, 'openai');
    expect(await port.status()).toBeNull();
  });
});
