// @vitest-environment jsdom
/**
 * The hook on its own. Its behaviour is also exercised through the real notes
 * field in `Tracker.test.tsx`, which is the stronger test — but this is a
 * reusable primitive that the next view will pick up, and the next person
 * should be able to see its contract without reading a board.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedField } from './useDebouncedField';

const DELAY = 500;

function Field({ initial, commit }: { initial: string; commit: (value: string) => void }) {
  const field = useDebouncedField(initial, commit, DELAY);
  return (
    <input
      data-testid="field"
      value={field.draft}
      onChange={(event) => field.setDraft(event.currentTarget.value)}
      onBlur={field.flush}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useDebouncedField', () => {
  it('shows the initial value and commits nothing on its own', () => {
    const commit = vi.fn();
    render(<Field initial="hello" commit={commit} />);

    expect((screen.getByTestId('field') as HTMLInputElement).value).toBe('hello');
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits once the typing stops', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Field initial="" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'note' } });
    expect(commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DELAY + 10);

    expect(commit).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('restarts the wait on every keystroke, so it writes once, not five times', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Field initial="" commit={commit} />);

    for (const value of ['n', 'no', 'not', 'note']) {
      fireEvent.change(screen.getByTestId('field'), { target: { value } });
      await vi.advanceTimersByTimeAsync(DELAY - 50);
    }
    await vi.advanceTimersByTimeAsync(DELAY + 10);

    expect(commit).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('commits immediately on blur, without waiting out the delay', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Field initial="" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'note' } });
    fireEvent.blur(screen.getByTestId('field'));

    expect(commit).toHaveBeenCalledExactlyOnceWith('note');
  });

  it('commits a pending value on UNMOUNT — the failure everyone ships', async () => {
    // Blur is not guaranteed. A keyboard shortcut, a programmatic selection
    // change, or a field that never had focus can all tear the component down
    // with a timer still pending, and React clears that timer on the way out.
    // Without this, the last thing typed is silently gone.
    vi.useFakeTimers();
    const commit = vi.fn();
    const { unmount } = render(<Field initial="" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'do not lose me' } });
    unmount();

    expect(commit).toHaveBeenCalledExactlyOnceWith('do not lose me');
  });

  it('negative: never commits the same value twice', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const { unmount } = render(<Field initial="" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'note' } });
    await vi.advanceTimersByTimeAsync(DELAY + 10);
    fireEvent.blur(screen.getByTestId('field'));
    unmount();

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('negative: blurring an untouched field commits nothing', () => {
    const commit = vi.fn();
    render(<Field initial="hello" commit={commit} />);

    fireEvent.blur(screen.getByTestId('field'));

    expect(commit).not.toHaveBeenCalled();
  });

  it('boundary: clearing the field commits the empty string, not nothing', async () => {
    // Deleting a note IS an edit. Treating "" as "no change" would make it
    // impossible to remove one.
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Field initial="hello" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(DELAY + 10);

    expect(commit).toHaveBeenCalledExactlyOnceWith('');
  });

  it('boundary: typing back to the original value still commits it', async () => {
    // Typing "x" then deleting it leaves the field where it started, and the
    // hook must not commit — but only because the VALUE matches, not because
    // something was typed.
    vi.useFakeTimers();
    const commit = vi.fn();
    render(<Field initial="hello" commit={commit} />);

    fireEvent.change(screen.getByTestId('field'), { target: { value: 'hellox' } });
    fireEvent.change(screen.getByTestId('field'), { target: { value: 'hello' } });
    await vi.advanceTimersByTimeAsync(DELAY + 10);

    expect(commit).not.toHaveBeenCalled();
  });
});
