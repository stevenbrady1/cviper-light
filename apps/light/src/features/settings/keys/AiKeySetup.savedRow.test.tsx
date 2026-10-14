// @vitest-environment jsdom
/**
 * Owner reports on 0.10.0 (0.10.1):
 *
 *   * "Remove saved key" sat beside "Test and save this key", in the quiet
 *     style that reads as plain text. It now sits beside "Saved ••••" — the
 *     thing it removes — as a real button.
 *   * With a key already saved and the box empty, pressing "Test and save this
 *     key" lit the box red with "Paste your … API key before testing it." That
 *     is not a mistake to flag: the saved key is fine and still in use. It now
 *     says so, in neutral words. A blank box with NO saved key is still an
 *     error, exactly as before.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { SECONDARY_BUTTON } from '../../../app/buttons';
import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';

import { AiKeySetup } from './AiKeySetup';
import { createFakeAiKeyPort } from './test/fakeAiKeyPort';

const SAVED = 'sk-proj-SAVEDKEY00000000';

function renderCard(port = createFakeAiKeyPort()) {
  const user = userEvent.setup();
  render(<AiKeySetup ports={{ openai: port }} browser={createFakeBrowserPort()} />);
  return { user, port };
}

afterEach(() => cleanup());

describe('"Remove saved key" sits with what it removes', () => {
  it('is a real button in the same row as "Saved ••••", not beside the Test button', async () => {
    renderCard(createFakeAiKeyPort(SAVED));

    const savedText = await screen.findByTestId('ai-key-saved-openai');
    const row = screen.getByTestId('ai-key-saved-row-openai');
    expect(row.contains(savedText)).toBe(true);

    const remove = within(row).getByRole('button', { name: 'Remove saved key' });
    expect(remove.getAttribute('data-testid')).toBe('ai-key-remove-openai');
    expect(remove.className).toBe(SECONDARY_BUTTON);
    expect(remove.hasAttribute('data-primary')).toBe(false);

    const testButton = screen.getByTestId('ai-key-test-openai');
    expect(testButton.parentElement?.contains(remove)).toBe(false);
  });

  it('clicking it removes the key, and the status says so', async () => {
    const { user, port } = renderCard(createFakeAiKeyPort(SAVED));
    await screen.findByTestId('ai-key-saved-openai');

    await user.click(
      within(screen.getByTestId('ai-key-card-openai')).getByRole('button', {
        name: 'Remove saved key',
      }),
    );

    await screen.findByTestId('ai-key-result-openai');
    expect(port.saved()).toBeNull();
    expect(screen.getByTestId('ai-key-state-openai').getAttribute('data-state')).toBe('missing');
    expect(screen.queryByTestId('ai-key-saved-openai')).toBeNull();
    // Still there, disabled: nothing left to remove.
    expect(screen.getByTestId('ai-key-remove-openai')).toHaveProperty('disabled', true);
  });
});

describe('no red error for a saved key and an empty box', () => {
  it('shows no error and no invalid styling when the card opens with a key saved', async () => {
    renderCard(createFakeAiKeyPort(SAVED));
    await screen.findByTestId('ai-key-saved-openai');

    const input = screen.getByTestId('ai-key-input-openai');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.className).not.toContain('border-danger');
    expect(screen.queryByTestId('ai-key-error-openai')).toBeNull();
  });

  it('pressing Test with the box empty and a key saved says the saved key is still in use — not red', async () => {
    const { user, port } = renderCard(createFakeAiKeyPort(SAVED));
    await screen.findByTestId('ai-key-saved-openai');

    await user.click(screen.getByTestId('ai-key-test-openai'));

    const input = screen.getByTestId('ai-key-input-openai');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.className).not.toContain('border-danger');
    expect(screen.queryByTestId('ai-key-error-openai')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((await screen.findByTestId('ai-key-result-openai')).textContent).toContain(
      'still saved',
    );
    // Nothing was tested or written over.
    expect(port.saved()).toBe(SAVED);
  });

  it('negative: with NO key saved, Test on an empty box still shows the error', async () => {
    const { user } = renderCard();
    await screen.findByTestId('ai-key-card-openai');

    await user.click(screen.getByTestId('ai-key-test-openai'));

    const input = screen.getByTestId('ai-key-input-openai');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.className).toContain('border-danger');
    expect((await screen.findByTestId('ai-key-error-openai')).textContent).toContain(
      'before testing it',
    );
  });

  it('boundary: whitespace only with a key saved counts as empty, not as a key to test', async () => {
    const { user, port } = renderCard(createFakeAiKeyPort(SAVED));
    await screen.findByTestId('ai-key-saved-openai');

    screen.getByTestId('ai-key-input-openai').focus();
    await user.paste('   ');
    await user.click(screen.getByTestId('ai-key-test-openai'));

    expect(screen.queryByTestId('ai-key-error-openai')).toBeNull();
    expect(port.saved()).toBe(SAVED);
  });
});
