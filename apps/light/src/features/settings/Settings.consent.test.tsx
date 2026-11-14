// @vitest-environment jsdom
/**
 * Settings → "What I have agreed to" (L-410).
 *
 * A consent to send a CV to an AI provider could be seen and withdrawn only on
 * Analysis and Tailor, the screens it is given on. Settings, where somebody
 * goes to ask "what have I agreed to?", said nothing. This section answers it
 * from the same store, with the same rows (`ConsentStatus`).
 *
 * Here "nothing" is an answer, so the section is always drawn. The assertion
 * that matters most is the negative one: a store that cannot be read is an
 * error, never "Nothing yet".
 */
import { err } from '@cviper/core-types';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsentPort } from '../analysis/consent';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Settings } = await import('./Settings');
const { createFakeUpdatePort } = await import('./updates/test/fakeUpdatePort');
const { createFakeBackupPort } = await import('./test/fakePort');
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { providerLabel } = await import('../analysis/model');
const { createFakeBoardPort } = await import('../boards/test/fakeBoardPort');

/** Typed out again on purpose: a test reading the app's own list would agree with it. */
const EVERY_KIND = [
  'anthropic',
  'openai',
  'google',
  'mistral',
  'grok',
  'openrouter',
  'custom',
] as const;

const EMPTY_LINE = 'Nothing yet. A company appears here after you agree to send it your CV.';
const READ_FAILED =
  'Your AI consent choices could not be read, so nothing will be sent to a cloud provider until you choose again. The disk said no.';
const WRITE_FAILED = 'That choice could not be saved, so it will be asked again. The disk said no.';

beforeEach(() => {
  localStorage.clear();
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(consentPort: ConsentPort) {
  render(
    <Settings
      port={createFakeBackupPort()}
      updatePort={createFakeUpdatePort()}
      mobileOs={null}
      browser={createFakeBrowserPort()}
      consentPort={consentPort}
    />,
  );
  return screen.getByTestId('settings-agreed');
}

describe('where the section is', () => {
  it('sits under the AI provider keys and above Your data, under the approved heading', async () => {
    const section = open(createFakeConsentPort());
    await screen.findByTestId('settings-agreed-empty');

    expect(within(section).getByRole('heading').textContent).toBe('What I have agreed to');

    const keys = screen.getByTestId('ai-key-setup');
    const exportNote = screen.getByTestId('settings-import');
    expect(keys.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      section.compareDocumentPosition(exportNote) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('what it lists', () => {
  it('happy: agreed to OpenAI and Google is two rows; Withdraw on Google removes its row and saves "no"', async () => {
    const port = createFakeConsentPort({ openai: true, google: true });
    const section = open(port);
    const user = userEvent.setup();

    await screen.findByTestId('analysis-consent-status-openai');
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(section.textContent).toContain(
      'Google Gemini can receive your CV and the adverts you check it against.',
    );
    expect(section.textContent).not.toContain(EMPTY_LINE);

    await user.click(screen.getByTestId('analysis-consent-withdraw-google'));

    await vi.waitFor(() => expect(port.state().google).toBe(false));
    expect(port.state().openai).toBe(true);
    await vi.waitFor(() =>
      expect(screen.queryByTestId('analysis-consent-status-google')).toBeNull(),
    );
    expect(screen.getByTestId('analysis-consent-status-openai')).toBeTruthy();
  });

  it.each(EVERY_KIND)(
    'happy: a consent given to %s shows its row, in the sentence Analysis uses, and Withdraw clears it',
    async (kind) => {
      const port = createFakeConsentPort({ [kind]: true });
      const section = open(port);

      const row = await screen.findByTestId(`analysis-consent-status-${kind}`);
      expect(row.textContent).toContain(
        `${providerLabel(kind)} can receive your CV and the adverts you check it against.`,
      );
      // The provider's name, never its raw id: every kind has a label.
      expect(providerLabel(kind)).not.toBe(kind);

      const withdraw = screen.getByTestId(`analysis-consent-withdraw-${kind}`);
      expect(withdraw.textContent).toBe('Withdraw');
      await userEvent.setup().click(withdraw);

      await vi.waitFor(() => expect(port.state()[kind]).toBe(false));
      // The last one gone: the empty line takes the list's place.
      expect(await within(section).findByTestId('settings-agreed-empty')).toBeTruthy();
    },
  );

  it('negative: a provider never agreed to has no row and no Withdraw', async () => {
    open(createFakeConsentPort({ google: true }));

    await screen.findByTestId('analysis-consent-status-google');
    for (const kind of EVERY_KIND.filter((each) => each !== 'google')) {
      expect(screen.queryByTestId(`analysis-consent-status-${kind}`)).toBeNull();
      expect(screen.queryByTestId(`analysis-consent-withdraw-${kind}`)).toBeNull();
    }
  });

  it('negative: withdrawing never touches a saved key', async () => {
    const port = createFakeConsentPort({ openai: true });
    open(port);

    await userEvent.setup().click(await screen.findByTestId('analysis-consent-withdraw-openai'));
    await vi.waitFor(() => expect(port.state().openai).toBe(false));
    await screen.findByTestId('settings-agreed-empty');

    // Settings asks which keys are saved as it opens, and nothing else: no
    // command that reads, writes or removes a key's value was ever sent.
    const commands = tauri.invoke.mock.calls.map(([command]) => command);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.filter((command) => /^secret_(get|set|delete)$/.test(command))).toEqual([]);
  });

  it('boundary: none agreed is the one empty line, and no list', async () => {
    const section = open(createFakeConsentPort());

    const empty = await screen.findByTestId('settings-agreed-empty');
    expect(empty.textContent).toBe(EMPTY_LINE);
    expect(within(section).queryByRole('list')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('boundary: all seven agreed is seven rows, each with its own Withdraw', async () => {
    const all = Object.fromEntries(EVERY_KIND.map((kind) => [kind, true]));
    const section = open(createFakeConsentPort(all));

    await screen.findByTestId('analysis-consent-status-custom');
    expect(within(section).getAllByRole('listitem')).toHaveLength(7);
    for (const kind of EVERY_KIND) {
      expect(screen.getByTestId(`analysis-consent-withdraw-${kind}`)).toBeTruthy();
    }
    expect(section.textContent).not.toContain(EMPTY_LINE);
  });
});

describe('it never says something it does not know', () => {
  it('before the store has answered: neither rows nor "Nothing yet" is said, and the line only holds its place', () => {
    const never: ConsentPort = {
      read: () => new Promise(() => undefined),
      grant: () => new Promise(() => undefined),
      revoke: () => new Promise(() => undefined),
    };
    const section = open(never);

    // Read in the same turn as the draw: the heading, and nothing claimed.
    expect(within(section).getByRole('heading')).toBeTruthy();
    expect(screen.queryByTestId('settings-agreed-empty')).toBeNull();
    expect(within(section).queryByRole('list')).toBeNull();
    expect(screen.queryByTestId('settings-agreed-error')).toBeNull();

    // The room the empty line will take is held (L-364), unseen and unspoken:
    // not painted, and not in what a screen reader is given.
    const held = within(section).getByText(EMPTY_LINE);
    expect(held.className).toContain('invisible');
    expect(held.getAttribute('aria-hidden')).toBe('true');
    expect(within(section).queryByText(EMPTY_LINE, { ignore: '[aria-hidden="true"]' })).toBeNull();
  });

  it('once the store has answered, nothing is left holding a place', async () => {
    const section = open(createFakeConsentPort({ openai: true }));

    await screen.findByTestId('analysis-consent-status-openai');
    expect(section.querySelector('[aria-hidden="true"].invisible')).toBeNull();
    expect(section.textContent).not.toContain(EMPTY_LINE);
  });

  it('negative: a store that cannot be read shows the store\'s own message and no rows, never a false "Nothing yet"', async () => {
    const unreadable: ConsentPort = {
      ...createFakeConsentPort({ openai: true }),
      read: async () => err({ message: READ_FAILED }),
    };
    const section = open(unreadable);

    const problem = await screen.findByTestId('settings-agreed-error');
    expect(problem.textContent).toBe(READ_FAILED);
    expect(problem.getAttribute('role')).toBe('alert');
    expect(section.textContent).not.toContain(EMPTY_LINE);
    expect(within(section).queryByRole('list')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it("negative: a withdrawal that cannot be saved says so in the store's words, and the row stays", async () => {
    const stuck: ConsentPort = {
      ...createFakeConsentPort({ mistral: true }),
      revoke: async () => err({ message: WRITE_FAILED }),
    };
    const section = open(stuck);

    await userEvent.setup().click(await screen.findByTestId('analysis-consent-withdraw-mistral'));

    const problem = await screen.findByTestId('settings-agreed-error');
    expect(problem.textContent).toBe(WRITE_FAILED);
    // Still agreed, so still listed and still withdrawable: nothing is hidden.
    expect(screen.getByTestId('analysis-consent-status-mistral')).toBeTruthy();
    expect(screen.getByTestId('analysis-consent-withdraw-mistral')).toBeTruthy();
    expect(section.textContent).not.toContain(EMPTY_LINE);
  });

  it('a withdrawal that works clears an earlier failure', async () => {
    let fail = true;
    const fake = createFakeConsentPort({ mistral: true });
    const flaky: ConsentPort = {
      ...fake,
      revoke: (kind) => {
        if (!fail) return fake.revoke(kind);
        fail = false;
        return Promise.resolve(err({ message: WRITE_FAILED }));
      },
    };
    open(flaky);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId('analysis-consent-withdraw-mistral'));
    await screen.findByTestId('settings-agreed-error');

    await user.click(screen.getByTestId('analysis-consent-withdraw-mistral'));
    await screen.findByTestId('settings-agreed-empty');
    expect(screen.queryByTestId('settings-agreed-error')).toBeNull();
  });
});

describe('Withdraw is a quiet control anyone can reach', () => {
  it('is a real button, reachable and pressable from the keyboard, and never the blue one', async () => {
    const port = createFakeConsentPort({ openai: true });
    open(port);

    const withdraw = await screen.findByTestId('analysis-consent-withdraw-openai');
    expect(withdraw.tagName).toBe('BUTTON');
    expect(withdraw.getAttribute('data-primary')).toBeNull();
    expect(withdraw.className).not.toContain('bg-blue');

    withdraw.focus();
    await userEvent.setup().keyboard('{Enter}');
    await vi.waitFor(() => expect(port.state().openai).toBe(false));
  });
});

/*
  The list sits above Job boards and its rows arrive a moment after the screen
  has drawn. Where that really moves the section, the screen scrolls to it once
  more: only a real browser lays anything out, so that is measured in
  `e2e/contrast-webkit.spec.ts`. Here: the list never makes a screen scroll
  that was not asked to, and never asks twice for a place that did not move
  (jsdom lays nothing out, so nothing moves).
*/
describe('the list arriving does not scroll a screen that has no reason to', () => {
  function openAt(place: 'job-boards' | undefined, onOpened: () => void) {
    const scrolled = vi.fn();
    HTMLElement.prototype.scrollTo = scrolled as unknown as HTMLElement['scrollTo'];
    render(
      <Settings
        port={createFakeBackupPort()}
        updatePort={createFakeUpdatePort()}
        mobileOs={null}
        browser={createFakeBrowserPort()}
        boardsPort={createFakeBoardPort()}
        consentPort={createFakeConsentPort({ openai: true, google: true, mistral: true })}
        onOpened={onOpened}
        {...(place === undefined ? {} : { openAt: place })}
      />,
    );
    return scrolled;
  }

  it('negative: opened normally, three rows arriving scroll nothing', async () => {
    const onOpened = vi.fn();
    const scrolled = openAt(undefined, onOpened);

    await screen.findByTestId('analysis-consent-status-mistral');
    expect(scrolled).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('opened at Job boards: the jump is made at once and reported once, rows or no rows', async () => {
    const onOpened = vi.fn();
    const scrolled = openAt('job-boards', onOpened);
    const boards = await screen.findByTestId('boards-settings');
    await vi.waitFor(() => expect(document.activeElement).toBe(boards));
    expect(onOpened).toHaveBeenCalledTimes(1);
    const jumps = scrolled.mock.calls.length;
    expect(jumps).toBeGreaterThan(0);

    await screen.findByTestId('analysis-consent-status-mistral');
    // The place did not move, so it is not scrolled to again; and the shell is
    // told once, not once per scroll.
    expect(scrolled.mock.calls.length).toBe(jumps);
    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});
