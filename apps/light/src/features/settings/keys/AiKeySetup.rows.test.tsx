// @vitest-environment jsdom
/**
 * L-390 — each AI provider, and "Your own AI service", is a short row that
 * opens on click.
 *
 * jsdom draws what is inside a closed fold, so every older card test passes
 * whether a row is open or not. These tests look at what jsdom CAN tell: which
 * rows are closed (`details.open`), what each closed title says, and the order
 * of things inside a row. Whether a row really opens is proved in a real
 * engine (`e2e/contrast-webkit.spec.ts`, "Settings key rows").
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ok, type Result } from '@cviper/core-types';

import { createFakeBrowserPort } from '../../../platform/test/fakeBrowserPort';
import { AI_MODEL_CHOICES, chooseModel, defaultModelFor } from '../../analysis/modelChoice';

import { AiKeySetup } from './AiKeySetup';
import { AI_KEY_PROVIDERS, type AiKeyProviderId } from './aiKeyModel';
import { type AiKeyPort, type AiKeyTestFailure } from './aiKeyPort';
import { AI_KEY_PROVIDER_IDS } from './aiKeyProviders';
import { type CustomServicePort } from './customServicePort';
import { createFakeAiKeyPort, type FakeAiKeyPort } from './test/fakeAiKeyPort';

/** "Your own AI service", with nothing saved. */
const NO_CUSTOM_SERVICE: CustomServicePort = {
  status: () => Promise.resolve(ok(null)),
  save: () => Promise.resolve(ok(undefined)),
  remove: () => Promise.resolve(ok(undefined)),
  listModels: () => Promise.resolve(ok([])),
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderRows(
  overrides: Partial<Record<AiKeyProviderId, AiKeyPort>> = {},
): Record<AiKeyProviderId, FakeAiKeyPort> {
  const fakes = Object.fromEntries(
    AI_KEY_PROVIDER_IDS.map((id) => [id, createFakeAiKeyPort()]),
  ) as Record<AiKeyProviderId, FakeAiKeyPort>;
  render(
    <AiKeySetup
      ports={{ ...fakes, ...overrides }}
      browser={createFakeBrowserPort()}
      customServicePort={NO_CUSTOM_SERVICE}
    />,
  );
  return fakes;
}

function row(id: AiKeyProviderId): HTMLDetailsElement {
  return screen.getByTestId(`ai-key-row-${id}`) as HTMLDetailsElement;
}

function title(id: AiKeyProviderId): HTMLElement {
  const summary = row(id).querySelector('summary');
  if (summary === null) throw new Error(`the ${id} row has no title`);
  return summary;
}

async function pillSays(id: AiKeyProviderId, words: string): Promise<void> {
  await waitFor(() => expect(screen.getByTestId(`ai-key-state-${id}`).textContent).toBe(words));
}

describe('the AI keys are short rows (L-390)', () => {
  it('every provider and Your own AI service is a closed row', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(row(id).tagName, id).toBe('DETAILS');
      expect(row(id).open, id).toBe(false);
      expect(screen.getByTestId(`ai-key-card-${id}`).contains(row(id)), id).toBe(true);
      // Name and pill in the title, the key box inside.
      expect(within(title(id)).getByRole('heading', { level: 3 }).textContent).toBe(
        AI_KEY_PROVIDERS[id].label,
      );
      expect(title(id).contains(screen.getByTestId(`ai-key-state-${id}`)), id).toBe(true);
      expect(title(id).contains(screen.getByTestId(`ai-key-input-${id}`)), id).toBe(false);
    }
    const custom = screen.getByTestId('custom-service-row') as HTMLDetailsElement;
    expect(custom.tagName).toBe('DETAILS');
    expect(custom.open).toBe(false);
    expect(screen.getByTestId('custom-service-card').contains(custom)).toBe(true);
  });

  it('with a key saved, the closed row shows the chosen model; changing it inside updates the title', async () => {
    const user = userEvent.setup();
    const pick = AI_MODEL_CHOICES.google[1]?.id ?? '';
    expect(pick).not.toBe('');
    renderRows({ google: createFakeAiKeyPort('AIza-saved') });
    await pillSays('google', 'Key saved');

    expect(title('google').textContent).toContain(defaultModelFor('google'));
    await user.selectOptions(screen.getByTestId('ai-model-google'), pick);
    expect(title('google').textContent).toContain(pick);
    expect(title('google').textContent).not.toContain(defaultModelFor('google'));
  });

  it('shows a model chosen in an earlier session', async () => {
    const pick = AI_MODEL_CHOICES.openai[1]?.id ?? '';
    expect(chooseModel('openai', pick)).toBe(true);
    renderRows({ openai: createFakeAiKeyPort('sk-saved') });
    await pillSays('openai', 'Key saved');

    expect(screen.getByTestId('ai-key-row-model-openai').textContent).toBe(pick);
  });

  // NEGATIVE — a model with no key runs nothing, so the title does not name one.
  it('negative: with no key saved, no model is shown', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(screen.queryByTestId(`ai-key-row-model-${id}`), id).toBeNull();
      expect(title(id).textContent, id).not.toContain(defaultModelFor(id));
    }
  });

  it('inside each row, who bills comes before the key box', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    for (const id of AI_KEY_PROVIDER_IDS) {
      const billing = within(row(id)).getByText(AI_KEY_PROVIDERS[id].billing);
      const box = screen.getByTestId(`ai-key-input-${id}`);
      expect(row(id).contains(billing), id).toBe(true);
      expect(title(id).contains(billing), id).toBe(false);
      // DOCUMENT_POSITION_FOLLOWING: the key box comes after the billing line.
      expect(billing.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING, id).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      // And it is the first thing said after what the provider adds.
      expect(billing.previousElementSibling?.textContent, id).toBe(AI_KEY_PROVIDERS[id].unlocks);
    }
  });

  it('the cost line and the password-store line sit outside every row', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    expect(screen.getByTestId('ai-keys-cost').closest('details')).toBeNull();
    const store = within(screen.getByTestId('ai-keys-steps')).getByText(/own password store/);
    expect(store.closest('details')).toBeNull();
  });

  // EDGE — closing a row is not cancelling what it is doing.
  it('edge: a test that finishes after the row was closed still updates the pill', async () => {
    const user = userEvent.setup();
    const fake = createFakeAiKeyPort();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const slow: AiKeyPort = {
      ...fake,
      test: async (key): Promise<Result<void, AiKeyTestFailure>> => {
        await gate;
        return fake.test(key);
      },
    };
    renderRows({ openai: slow });
    await pillSays('openai', 'Not set up');

    await user.click(title('openai'));
    await user.type(screen.getByTestId('ai-key-input-openai'), 'sk-test-1234567890abcdef');
    await user.click(screen.getByTestId('ai-key-test-openai'));
    await user.click(title('openai'));
    expect(row('openai').open).toBe(false);

    release();
    await pillSays('openai', 'Key saved');
    expect(fake.saved()).toBe('sk-test-1234567890abcdef');
    expect(row('openai').open).toBe(false);
  });

  // EDGE — closing is not cancelling, and it is not saving either.
  it('edge: what was typed in a closed row is kept, and nothing is tested or saved by closing it', async () => {
    const user = userEvent.setup();
    const fakes = renderRows();
    await pillSays('openai', 'Not set up');

    await user.click(title('openai'));
    await user.type(screen.getByTestId('ai-key-input-openai'), 'sk-half');
    await user.click(title('openai'));
    await user.click(title('openai'));

    expect((screen.getByTestId('ai-key-input-openai') as HTMLInputElement).value).toBe('sk-half');
    expect(fakes.openai.calls.test).toBe(0);
    expect(fakes.openai.calls.save).toBe(0);
  });

  // BOUNDARY — a problem is said in the closed title; the row does not open itself.
  it('boundary: a locked store reads "Could not be read" in the closed title, gold, and the row stays closed', async () => {
    const locked = createFakeAiKeyPort('sk-saved');
    locked.makeUnreadable();
    renderRows({ anthropic: locked });
    await pillSays('openai', 'Not set up');
    await pillSays('anthropic', 'Could not be read');

    const pill = screen.getByTestId('ai-key-state-anthropic');
    expect(title('anthropic').contains(pill)).toBe(true);
    expect(pill.getAttribute('data-tone')).toBe('attention');
    expect(row('anthropic').open).toBe(false);
    // Not readable, so not known to be saved: no model either.
    expect(screen.queryByTestId('ai-key-row-model-anthropic')).toBeNull();
  });
});

/** The words above the rows that described cards, said for rows (L-390). */
describe('the words above the rows match them (L-390)', () => {
  it('the three steps say to open a company and paste into its box', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');
    const steps = within(screen.getByTestId('ai-keys-steps')).getAllByRole('listitem');

    expect(steps.map((step) => step.textContent)).toEqual([
      'Pick one company below and open it. You only need one.',
      'Inside, press “Where do I get … key?”. Sign in on its website and create a key: a long line of letters and numbers.',
      'Paste it into the box and press “Test and save this key”.',
    ]);
  });

  it('negative: nothing above the rows still talks about a card', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    expect(screen.getByTestId('ai-keys-steps').textContent).not.toMatch(/\bcard\b/);
  });

  it('the heading line no longer repeats the line above it', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    const text = screen.getByTestId('ai-key-setup').textContent ?? '';
    expect(text).toContain(
      'Optional. An AI key, or an AI service on your own computer, adds six things:',
    );
    expect(text).not.toContain('keyword match that needs no account');
  });

  it('the model choice inside each row is called "AI model"', async () => {
    renderRows();
    await pillSays('openai', 'Not set up');

    for (const id of AI_KEY_PROVIDER_IDS) {
      expect(screen.getByLabelText('AI model', { selector: `#ai-model-${id}` })).toBeTruthy();
    }
  });
});
