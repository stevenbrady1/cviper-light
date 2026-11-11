// @vitest-environment jsdom
/**
 * One edit is saved ONCE (L-372).
 *
 * Clicking away saves the field at once (`flush`). Before L-372 the autosave
 * timer that was already counting kept running, so the same value was saved a
 * second time about 600 ms later. Mostly a wasted write — but when the first
 * save FAILED and showed its error, the second one could succeed and wipe the
 * error a moment later, so the screen told the user two different stories
 * about the same edit.
 *
 * The harness below saves the way the real screens do: `commit` clears the
 * error, starts an async write, and raises the error if the write fails
 * (`Profile.tsx`'s `apply`, `useTrackerEntries`'s `save`). Every test uses fake
 * timers and asserts exact call counts at each tick.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { useDebouncedField } from './useDebouncedField';

const DELAY = 500;

type Save = (value: string) => Promise<boolean>;

function SavingField({ initial, save }: { initial: string; save: Save }) {
  const [error, setError] = useState<string | null>(null);
  const field = useDebouncedField(
    initial,
    (value) => {
      setError(null);
      void save(value).then((saved) => {
        if (!saved) setError('That change could not be saved.');
      });
    },
    DELAY,
  );
  return (
    <>
      <input
        data-testid="field"
        value={field.draft}
        onChange={(event) => field.setDraft(event.currentTarget.value)}
        onBlur={field.flush}
      />
      <button type="button" data-testid="reset" onClick={() => field.reset('written elsewhere')}>
        reset
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </>
  );
}

function setup(initial = '', save: Mock<Save> = vi.fn<Save>(async () => true)) {
  const view = render(<SavingField initial={initial} save={save} />);
  return { ...view, save };
}

function field(): HTMLInputElement {
  return screen.getByTestId('field') as HTMLInputElement;
}

function type(value: string): void {
  fireEvent.change(field(), { target: { value } });
}

function blur(): void {
  fireEvent.blur(field());
}

/**
 * Let `ms` of fake time pass, inside `act` so the error state a settled save
 * sets has been rendered by the time the next line looks for it.
 */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDebouncedField — one edit, one save (L-372)', () => {
  it('happy: type, click away — saved exactly once, and not again after the delay', async () => {
    const { save } = setup();

    type('note');
    blur();
    expect(save).toHaveBeenCalledExactlyOnceWith('note');

    await tick(DELAY + 10);
    expect(save).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('edge (time): the count is 1 at the blur, just before the delay, just after it, and long after', async () => {
    const { save } = setup();

    type('note');
    await tick(DELAY / 2);
    expect(save).not.toHaveBeenCalled();

    blur();
    expect(save).toHaveBeenCalledTimes(1);

    // The timer armed by the keystroke would have fired at DELAY after it.
    await tick(DELAY / 2 - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await tick(2);
    expect(save).toHaveBeenCalledTimes(1);
    await tick(DELAY * 10);
    expect(save).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('negative: a save that fails on blur keeps its error, and the typed text, after the delay', async () => {
    // First write fails, every later one would succeed: exactly the shape that
    // let the timer's duplicate save wipe the error.
    const save = vi.fn<Save>().mockResolvedValueOnce(false).mockResolvedValue(true);
    setup('', save);

    type('Quant developer');
    blur();
    await tick(0);
    expect(screen.getByRole('alert').textContent).toContain('could not be saved');

    await tick(DELAY + 10);

    expect(screen.getByRole('alert').textContent).toContain('could not be saved');
    expect(field().value).toBe('Quant developer');
    expect(save).toHaveBeenCalledExactlyOnceWith('Quant developer');
  });

  it('negative: after a failed save, the next edit saves again (the retry the message promises)', async () => {
    const save = vi.fn<Save>().mockResolvedValueOnce(false).mockResolvedValue(true);
    setup('', save);

    type('Quant');
    blur();
    await tick(DELAY + 10);
    expect(screen.getByRole('alert')).toBeTruthy();

    type('Quant developer');
    blur();
    await tick(0);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(save.mock.calls).toEqual([['Quant'], ['Quant developer']]);
  });

  it('boundary: type, click away, type again within the delay — the second edit is saved once, at its own time', async () => {
    const { save } = setup();

    type('one');
    blur();
    await tick(DELAY / 2);
    type('two');

    // Not yet: the second edit has its own full delay.
    await tick(DELAY - 1);
    expect(save.mock.calls).toEqual([['one']]);

    await tick(2);
    expect(save.mock.calls).toEqual([['one'], ['two']]);

    await tick(DELAY * 10);
    expect(save.mock.calls).toEqual([['one'], ['two']]);
  });

  it('boundary: type, click away, type again, click away — each saved once, at its blur', async () => {
    const { save } = setup();

    type('one');
    blur();
    type('two');
    blur();
    expect(save.mock.calls).toEqual([['one'], ['two']]);

    await tick(DELAY * 10);
    expect(save.mock.calls).toEqual([['one'], ['two']]);
  });

  it('boundary: two rapid blurs save once', async () => {
    const { save } = setup();

    type('note');
    blur();
    blur();
    await tick(DELAY + 10);
    blur();

    expect(save).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('boundary: clicking away with nothing changed saves nothing, before or after the delay', async () => {
    const { save } = setup('hello');

    blur();
    await tick(DELAY + 10);
    blur();

    expect(save).not.toHaveBeenCalled();
  });

  it('boundary: unmounting with a pending change still saves it once', async () => {
    const { save, unmount } = setup();

    type('do not lose me');
    unmount();
    await tick(DELAY + 10);

    expect(save).toHaveBeenCalledExactlyOnceWith('do not lose me');
  });

  it('boundary: click away, then unmount before the delay — still once', async () => {
    const { save, unmount } = setup();

    type('note');
    blur();
    unmount();
    await tick(DELAY + 10);

    expect(save).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('boundary: click away, type again, unmount — the second edit is saved once on the way out', async () => {
    const { save, unmount } = setup();

    type('one');
    blur();
    type('two');
    unmount();
    await tick(DELAY + 10);

    expect(save.mock.calls).toEqual([['one'], ['two']]);
  });

  it('boundary: a save still in flight does not hold back or reorder the next edit', async () => {
    // Today's contract, kept: the hook never waits for a write. Each edit is
    // handed to `commit` in the order it was made, with its own value; keeping
    // the WRITES in order is the caller's job (Profile builds each change on
    // the last through its `latest` ref).
    let finishFirst: (saved: boolean) => void = () => undefined;
    const save = vi
      .fn<Save>()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(true);
    setup('', save);

    type('one');
    blur();
    type('two');
    await tick(DELAY + 10);
    expect(save.mock.calls).toEqual([['one'], ['two']]);

    await act(async () => {
      finishFirst(true);
      await Promise.resolve();
    });
    await tick(DELAY * 10);

    expect(save.mock.calls).toEqual([['one'], ['two']]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('boundary: no autosave timer is left armed after a click-away save', () => {
    setup();

    type('note');
    expect(vi.getTimerCount()).toBe(1);
    blur();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('negative: a reset to exactly the pending text saves nothing — the value is already stored', async () => {
    // Same root cause through the other door: `reset` marks its value
    // committed, and when that value equals the draft React does not re-render,
    // so the keystroke's timer is never cleared and used to save it anyway.
    const { save } = setup();

    type('written elsewhere');
    fireEvent.click(screen.getByTestId('reset'));
    await tick(DELAY + 10);
    blur();

    expect(save).not.toHaveBeenCalled();
    expect(field().value).toBe('written elsewhere');
  });
});
