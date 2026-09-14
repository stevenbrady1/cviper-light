// @vitest-environment jsdom
/**
 * ============================================================================
 * THE PROMISE, INVERTED: THIS SCREEN NEEDS A MODEL, AND SAYS SO.
 * ============================================================================
 * The analysis screen works with nothing configured. This one cannot — there
 * is no keyword way to write a paragraph — so on a machine with no local
 * model and no key the honest behaviour is a disabled button with the reason
 * next to it, in generic words, pointing at Settings.
 *
 * And the load-bearing half, the same as `analysis.zeroKeys.test.tsx`: no
 * provider transport is BUILT and no provider command is invoked. A disabled
 * button that still warmed a model up would break the promise on a screen
 * that looks like it keeps it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Cv } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { NO_AI_REASON } = await import('./model');

const PROVIDER_COMMANDS = ['provider_chat', 'provider_list_models'];

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text:
    'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, IFRS 9.',
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const ADVERT =
  'Credit Risk Analyst. You will build SQL models and report on IFRS 9 impairment. ' +
  'Python experience essential.';

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // A machine with nothing set up: no daemon, and not one saved credential.
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

describe('the tailor view on a machine with no keys and no local model', () => {
  it('disables the run button with the generic reason, and never builds a transport', async () => {
    const user = userEvent.setup();
    const built = { count: 0 };

    render(
      <Tailor
        port={createFakeTailorPort({ cvs: [CV] })}
        filePort={createFakeFilePort()}
        createTransport={() => {
          built.count += 1;
          throw new Error('no transport may be built on this machine');
        }}
        consentPort={createFakeConsentPort()}
      />,
    );

    await screen.findByDisplayValue('CV.docx');
    // Even with a CV chosen and a full advert pasted, the button stays off.
    await user.type(screen.getByTestId('tailor-job-text'), ADVERT);

    await vi.waitFor(() =>
      expect(screen.getByTestId('tailor-run-reason').textContent).toBe(NO_AI_REASON),
    );
    expect(screen.getByTestId('tailor-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('tailor-run-reason').textContent).toContain('Settings');

    // The picker has nothing to offer and says so — no basic match, no greyed
    // row advertising software the user has never heard of.
    const picker = screen.getByTestId('tailor-provider') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['']);
    expect(picker.disabled).toBe(true);

    // Pressing it anyway does nothing: a disabled button gets no click.
    await user.click(screen.getByTestId('tailor-run'));

    expect(built.count).toBe(0);
    expect(
      tauri.invoke.mock.calls
        .map(([command]) => command)
        .filter((c) => PROVIDER_COMMANDS.includes(c)),
    ).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
    expect(screen.queryByTestId('tailor-result')).toBeNull();
  });

  it('names no provider on that surface', async () => {
    render(
      <Tailor
        port={createFakeTailorPort({ cvs: [CV] })}
        filePort={createFakeFilePort()}
        consentPort={createFakeConsentPort()}
      />,
    );
    await screen.findByDisplayValue('CV.docx');
    await vi.waitFor(() =>
      expect(screen.getByTestId('tailor-run-reason').textContent).toBe(NO_AI_REASON),
    );

    const copy = `${screen.getByTestId('tailor-run-reason').textContent} ${screen.getByTestId('tailor-provider-note').textContent}`;
    for (const brand of ['OpenAI', 'Anthropic', 'Ollama', 'GPT', 'Claude']) {
      expect(copy).not.toContain(brand);
    }
  });
});
