// @vitest-environment jsdom
/**
 * Withdrawing a consent from the Tailor screen (L-399).
 *
 * Tailor drew its rows from the same hand-typed `['anthropic', 'openai']` as
 * Analysis, so a consent given to any provider added later had no row and no
 * Withdraw here either. `tailor.consent.test.ts` covers the gate inside the
 * run modules; nothing covered the rows on the screen.
 *
 * The kinds are typed out again on purpose: a test that read the app's own
 * list would agree with whatever that list happened to say.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');

const EVERY_KIND = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'grok',
  'openrouter',
  'custom',
] as const;

beforeEach(() => {
  tauri.invoke.mockReset();
  // No Ollama and no saved key: the rows must not depend on what is set up now.
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});
afterEach(() => cleanup());

function renderTailor(consentPort: ReturnType<typeof createFakeConsentPort>) {
  render(
    <Tailor
      port={createFakeTailorPort()}
      filePort={createFakeFilePort()}
      consentPort={consentPort}
      browser={createFakeBrowserPort()}
    />,
  );
}

describe('withdrawing consent on Tailor, for every provider a consent can be given to', () => {
  it.each(EVERY_KIND)(
    'happy: a consent given to %s shows a row, and Withdraw takes it back',
    async (kind) => {
      const consentPort = createFakeConsentPort({ [kind]: true });
      const user = userEvent.setup();
      renderTailor(consentPort);

      await screen.findByTestId(`analysis-consent-status-${kind}`);
      await user.click(screen.getByTestId(`analysis-consent-withdraw-${kind}`));

      await vi.waitFor(() => expect(consentPort.state()[kind]).toBe(false));
      expect(screen.queryByTestId(`analysis-consent-status-${kind}`)).toBeNull();
    },
  );

  it('negative: a provider never agreed to has no row and no Withdraw', async () => {
    renderTailor(createFakeConsentPort({ mistral: true }));

    await screen.findByTestId('analysis-consent-status-mistral');
    for (const kind of EVERY_KIND.filter((each) => each !== 'mistral')) {
      expect(screen.queryByTestId(`analysis-consent-status-${kind}`)).toBeNull();
      expect(screen.queryByTestId(`analysis-consent-withdraw-${kind}`)).toBeNull();
    }
  });

  it('boundary: none agreed draws no list at all', async () => {
    renderTailor(createFakeConsentPort());

    // The availability read has settled, and the consent read settled before it.
    await screen.findByText('No AI set up yet');
    expect(screen.queryByTestId('analysis-consent-status')).toBeNull();
  });

  it('boundary: all seven agreed draws seven rows, each with its own Withdraw', async () => {
    const all = Object.fromEntries(EVERY_KIND.map((kind) => [kind, true]));
    renderTailor(createFakeConsentPort(all));

    const list = await screen.findByTestId('analysis-consent-status');
    await vi.waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(7));
    for (const kind of EVERY_KIND) {
      expect(screen.getByTestId(`analysis-consent-withdraw-${kind}`)).toBeTruthy();
    }
  });
});
