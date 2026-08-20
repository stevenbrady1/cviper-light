// @vitest-environment jsdom
/**
 * Managing the board list, and proving the choices survive a restart.
 *
 * A "restart" here is an unmount and a fresh mount against the SAME port. The
 * component keeps its state in React; the port keeps it in a store. If a change
 * only ever reached the first of those, every assertion about the live screen
 * would still pass and the user would find their choices gone at the next
 * launch — which is the failure this file exists to catch.
 *
 * Board ids are read from the shipped config rather than typed out, so adding a
 * ninth board does not silently make these tests assert about the wrong row.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { BoardSettings } from './BoardSettings';
import { SHIPPED_BOARDS } from './defaults';
import { createFakeBoardPort, type FakeBoardPort } from './test/fakeBoardPort';

const FIRST = SHIPPED_BOARDS[0]?.id ?? '';
const SECOND = SHIPPED_BOARDS[1]?.id ?? '';
const LAST = SHIPPED_BOARDS.at(-1)?.id ?? '';

const A_GOOD_TEMPLATE = 'https://www.example.com/jobs?q={keyword}&where={location}';

/**
 * Put a URL in the address box the way the form tells the user to: by pasting.
 *
 * `userEvent.type` would read `{keyword}` as a KEY DESCRIPTOR — a request to
 * press a key called "keyword" — and typing a fifty-character URL one synthetic
 * keystroke at a time is the single most expensive thing in this file. `paste`
 * is one event, and it is what somebody who has just copied an address does.
 */
async function pasteTemplate(user: ReturnType<typeof userEvent.setup>, template: string) {
  await user.click(screen.getByTestId('boards-new-template'));
  await user.paste(template);
}

/** Mount, and wait for the port's first answer to have landed. */
async function open(port: FakeBoardPort) {
  const user = userEvent.setup();
  const view = render(<BoardSettings port={port} />);
  await screen.findByTestId(`board-row-${FIRST}`);
  return { user, view };
}

/** Close the app and open it again, against the same store. */
async function restart(port: FakeBoardPort) {
  cleanup();
  return open(port);
}

function rowOrder(): string[] {
  return [...document.querySelectorAll('[data-testid^="board-row-"]')].map(
    (row) => row.getAttribute('data-testid')?.replace('board-row-', '') ?? '',
  );
}

afterEach(() => {
  cleanup();
});

describe('the board list', () => {
  it('lists every shipped board, all ticked, on a machine with no preferences', async () => {
    await open(createFakeBoardPort());

    expect(rowOrder()).toEqual(SHIPPED_BOARDS.map((board) => board.id));
    for (const board of SHIPPED_BOARDS) {
      const toggle = screen.getByTestId(`board-toggle-${board.id}`) as HTMLInputElement;
      expect(toggle.checked, board.id).toBe(true);
    }
  });

  it('SWITCHING A BOARD OFF SURVIVES A RESTART', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId(`board-toggle-${SECOND}`));
    expect(port.saved().disabled).toEqual([SECOND]);

    const { user: after } = await restart(port);

    expect((screen.getByTestId(`board-toggle-${SECOND}`) as HTMLInputElement).checked).toBe(false);
    // And the board is still listed, or it could never be switched back on.
    expect(rowOrder()).toContain(SECOND);

    // Switching it back on, in the restarted app, clears the stored flag.
    await after.click(screen.getByTestId(`board-toggle-${SECOND}`));
    expect(port.saved().disabled).toEqual([]);
  });

  it('REORDERING SURVIVES A RESTART', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId(`board-up-${SECOND}`));
    expect(rowOrder().slice(0, 2)).toEqual([SECOND, FIRST]);

    await restart(port);

    expect(rowOrder().slice(0, 2)).toEqual([SECOND, FIRST]);
  });

  it('boundary: the first cannot move up and the last cannot move down', async () => {
    await open(createFakeBoardPort());

    // Disabled, never hidden — a control that comes and goes cannot be learnt.
    expect((screen.getByTestId(`board-up-${FIRST}`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`board-down-${LAST}`) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId(`board-down-${FIRST}`) as HTMLButtonElement).disabled).toBe(false);
  });

  it('negative: a write that fails keeps the change on screen AND says it will be lost', async () => {
    // The alternative — silently putting the tick back — teaches the user that
    // the checkbox is broken rather than that the disk is.
    const port = createFakeBoardPort();
    port.failWrites('the disk is full');
    const { user } = await open(port);

    await user.click(screen.getByTestId(`board-toggle-${SECOND}`));

    expect((screen.getByTestId(`board-toggle-${SECOND}`) as HTMLInputElement).checked).toBe(false);
    expect((await screen.findByTestId('boards-problem')).textContent).toContain('disk is full');
  });

  it('negative: an unreadable store shows the shipped boards and explains, quietly', async () => {
    const port = createFakeBoardPort();
    port.failReads('the file is corrupt');
    await open(port);

    expect(rowOrder()).toEqual(SHIPPED_BOARDS.map((board) => board.id));
    expect((await screen.findByTestId('boards-read-problem')).textContent).toContain('corrupt');
    // Not an alert. Nothing the user just did has failed, and every board on
    // screen works.
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });
});

describe('adding a board of your own', () => {
  it('ADDS, PERSISTS AND RELOADS a custom board', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'eFinancialCareers');
    await pasteTemplate(user, A_GOOD_TEMPLATE);
    await user.click(screen.getByTestId('boards-add-submit'));

    const id = 'custom-efinancialcareers';
    expect(port.saved().custom).toEqual([
      { id, label: 'eFinancialCareers', urlTemplate: A_GOOD_TEMPLATE, encoding: 'plus' },
    ]);

    await restart(port);

    expect(screen.getByTestId(`board-row-${id}`).textContent).toContain('eFinancialCareers');
    expect((screen.getByTestId(`board-toggle-${id}`) as HTMLInputElement).checked).toBe(true);
  });

  it('removes a board of your own, and only your own', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'My Board');
    await pasteTemplate(user, A_GOOD_TEMPLATE);
    await user.click(screen.getByTestId('boards-add-submit'));

    const id = 'custom-my-board';
    await user.click(await screen.findByTestId(`board-remove-${id}`));

    expect(port.saved().custom).toEqual([]);
    expect(screen.queryByTestId(`board-row-${id}`)).toBeNull();
    // A shipped board has no Remove button at all — it can only be switched off.
    expect(screen.queryByTestId(`board-remove-${FIRST}`)).toBeNull();
  });

  it('previews the URL the template would open, before it is saved', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await pasteTemplate(user, A_GOOD_TEMPLATE);

    expect((await screen.findByTestId('boards-new-preview')).textContent).toContain(
      'https://www.example.com/jobs?q=business+analyst&where=Milton+Keynes',
    );
  });

  it('changes the encoding, and saves the one that was chosen', async () => {
    // Regression: this handler read `event.currentTarget` inside a lazy state
    // updater, which runs after React has finished with the event. It threw the
    // moment anybody touched the dropdown.
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'Path Board');
    await pasteTemplate(user, A_GOOD_TEMPLATE);
    await user.selectOptions(screen.getByTestId('boards-new-encoding'), 'hyphen');
    await user.click(screen.getByTestId('boards-add-submit'));

    expect(port.saved().custom.map((board) => board.encoding)).toEqual(['hyphen']);
  });

  it('negative: refuses a template with no {keyword}, and saves nothing', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'No Keyword');
    await pasteTemplate(user, 'https://www.example.com/jobs');
    await user.click(screen.getByTestId('boards-add-submit'));

    expect((await screen.findByTestId('boards-new-template-error')).textContent).toContain(
      '{keyword}',
    );
    expect(port.saved().custom).toEqual([]);
    // The form stays open with what they typed still in it.
    expect((screen.getByTestId('boards-new-label') as HTMLInputElement).value).toBe('No Keyword');
  });

  it('negative: refuses a javascript: template, and saves nothing', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'Nasty');
    await pasteTemplate(user, 'javascript:alert({keyword})');
    await user.click(screen.getByTestId('boards-add-submit'));

    expect(screen.getByTestId('boards-new-template-error')).toBeDefined();
    expect(screen.queryByTestId('boards-new-preview')).toBeNull();
    expect(port.saved().custom).toEqual([]);
  });

  it('negative: refuses a board with no name', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await pasteTemplate(user, A_GOOD_TEMPLATE);
    await user.click(screen.getByTestId('boards-add-submit'));

    expect(screen.getByTestId('boards-new-label-error')).toBeDefined();
    expect(port.saved().custom).toEqual([]);
  });

  it('boundary: an empty form refuses BOTH fields rather than saving a blank board', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.click(screen.getByTestId('boards-add-submit'));

    expect(screen.getByTestId('boards-new-label-error')).toBeDefined();
    expect(screen.getByTestId('boards-new-template-error')).toBeDefined();
    expect(port.saved().custom).toEqual([]);
    expect(port.calls.write).toBe(0);
  });

  it('boundary: a second board with the same name gets its own row', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    for (const _pass of [1, 2]) {
      await user.click(screen.getByTestId('boards-add-open'));
      await user.type(screen.getByTestId('boards-new-label'), 'Same Name');
      await pasteTemplate(user, A_GOOD_TEMPLATE);
      await user.click(screen.getByTestId('boards-add-submit'));
    }

    expect(port.saved().custom.map((board) => board.id)).toEqual([
      'custom-same-name',
      'custom-same-name-2',
    ]);
  });

  it('boundary: cancelling throws the draft away rather than keeping it for next time', async () => {
    const port = createFakeBoardPort();
    const { user } = await open(port);

    await user.click(screen.getByTestId('boards-add-open'));
    await user.type(screen.getByTestId('boards-new-label'), 'Abandoned');
    await user.click(screen.getByTestId('boards-add-cancel'));
    await user.click(screen.getByTestId('boards-add-open'));

    expect((screen.getByTestId('boards-new-label') as HTMLInputElement).value).toBe('');
    expect(port.saved().custom).toEqual([]);
  });
});
