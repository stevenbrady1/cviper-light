// @vitest-environment jsdom
/**
 * L-324: Tracker asked to open with the paste pane, from Search's "Found one?
 * Bring it in". The pane is open on the first paint with the cursor in the
 * link box, and the shell is told once so the next visit opens shut.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type TrackerEntry } from './model';
import { Tracker } from './Tracker';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 7, 19, 9, 0, 0);

const ONE_CARD: TrackerEntry = {
  job: {
    id: 'job-1',
    source: 'manual',
    external_id: null,
    title: 'Role 1',
    company: 'Acme',
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description: null,
    url: null,
    posted_date: null,
    created_at: NOW.toISOString(),
  },
  application: {
    id: '1',
    job_id: 'job-1',
    status: 'saved',
    applied_date: null,
    notes: null,
    next_action: null,
    next_action_date: null,
    updated_at: NOW.toISOString(),
  },
};

function renderTracker(
  props: { openPaste?: boolean; onOpened?: () => void },
  entries: readonly TrackerEntry[] = [ONE_CARD],
) {
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  render(
    <Tracker
      port={createFakeTrackerPort(entries)}
      now={NOW}
      readAvailability={() =>
        Promise.resolve({
          ollamaRunning: false,
          ollamaModels: [],
          anthropicKey: false,
          openaiKey: false,
        })
      }
      {...props}
    />,
  );
  return { focus };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Tracker opened with the paste pane', () => {
  it('openPaste: the pane is open on first paint, the link box has focus, onOpened is called once', async () => {
    const onOpened = vi.fn();
    renderTracker({ openPaste: true, onOpened });

    // First paint: no wait for the board to load.
    expect(screen.getByTestId('paste-job-form')).toBeTruthy();
    const link = screen.getByLabelText('Link to the advert');
    expect(link).toBe(screen.getByTestId('paste-job-url'));
    expect(document.activeElement).toBe(link);
    expect(onOpened).toHaveBeenCalledTimes(1);

    // Once the board is in, both new-card buttons are held while the pane is up.
    await screen.findByTestId('tracker-column-saved');
    expect((screen.getByTestId('tracker-paste') as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(link);
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('negative: without it the pane is closed and focus is not moved', async () => {
    const onOpened = vi.fn();
    const { focus } = renderTracker({ onOpened });
    await screen.findByTestId('tracker-column-saved');

    expect(screen.queryByTestId('paste-job-form')).toBeNull();
    expect(screen.queryByTestId('detail-pane')).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('boundary: an empty board — the pane opens beside the empty board', async () => {
    renderTracker({ openPaste: true, onOpened: vi.fn() }, []);
    await screen.findByTestId('tracker-empty');

    expect(screen.getByTestId('paste-job-form')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('paste-job-url'));
    // The empty board's own buttons are held while the pane is open.
    expect((screen.getByTestId('tracker-empty-paste') as HTMLButtonElement).disabled).toBe(true);
  });

  it('edge: Close shuts the pane and "Paste a job" is enabled again', async () => {
    const user = userEvent.setup();
    renderTracker({ openPaste: true, onOpened: vi.fn() });
    await screen.findByTestId('tracker-column-saved');

    await user.click(screen.getByTestId('detail-pane-close'));

    expect(screen.queryByTestId('paste-job-form')).toBeNull();
    const paste = screen.getByTestId('tracker-paste') as HTMLButtonElement;
    expect(paste.disabled).toBe(false);
    await user.click(paste);
    expect(screen.getByTestId('paste-job-form')).toBeTruthy();
  });
});
