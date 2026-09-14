// @vitest-environment jsdom
/**
 * The marker survives the Notes box — through the REAL board, not the panel
 * on its own.
 *
 * ============================================================================
 * THE BUG THIS PREVENTS
 * ============================================================================
 * `ApplicationDetail`'s Notes box is a `useDebouncedField`, and a debounced
 * field holds its own draft. "Mark as sent" writes `followed up <date>` into
 * the notes through `onEdit` — which the board saves — but the Notes box, one
 * component up from the panel, would still be holding the text from BEFORE.
 * The next keystroke there would commit that stale draft and the marker would
 * be gone, silently, from a box the user was looking at the whole time.
 *
 * The fix is `notes.reset(...)` in `ApplicationDetail`'s wrapper around the
 * panel's `onEdit`. This test drives the whole thing — board, pane, panel,
 * fake port, fake model — marks a follow-up as sent, then TYPES in the Notes
 * box and checks the stored notes still carry the marker. The panel's own
 * tests cannot see this: the stale draft lives in the component above it.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { AUTOSAVE_DELAY_MS } from './ApplicationDetail';
import { followUpsSent } from './followUp';
import { createEntry, EMPTY_DRAFT, type TrackerEntry } from './model';
import { createFakeTrackerPort } from './test/fakePort';
import { Tracker } from './Tracker';

const NOW = new Date('2026-09-13T09:00:00.000Z');

const WITH_OLLAMA: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
  anthropicKey: false,
  openaiKey: false,
};

const DRAFT = {
  subject: 'Following up on my application',
  body: 'Hello Dana,\n\nChecking in.\n\nKind regards,\nJane Doe',
};

function transport(): ChatTransport {
  const body = JSON.stringify({
    message: { content: JSON.stringify(DRAFT) },
    done_reason: 'stop',
  });
  return {
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      return Promise.resolve(ok({ status: 200, body }));
    },
    listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      throw new Error('the board must never list models');
    },
  };
}

function appliedEntry(): TrackerEntry {
  const base = createEntry(
    { ...EMPTY_DRAFT, title: 'Credit Risk Analyst', company: 'Lloyds', status: 'applied' },
    { jobId: 'job-a', applicationId: 'a' },
    '2026-09-01T09:00:00.000Z',
  );
  return {
    ...base,
    application: { ...base.application, applied_date: '2026-09-01', notes: 'Spoke to Dana.' },
  };
}

afterEach(() => {
  cleanup();
});

describe('marking a follow-up as sent, through the board', () => {
  it('records the marker, and typing in Notes afterwards keeps it', async () => {
    const user = userEvent.setup();
    const port = createFakeTrackerPort([appliedEntry()]);
    render(
      <Tracker
        port={port}
        now={NOW}
        readAvailability={() => Promise.resolve(WITH_OLLAMA)}
        createTransport={transport}
      />,
    );

    await screen.findByTestId('tracker-column-applied');
    await user.click(screen.getByTestId('tracker-card-a'));

    const draftButton = (await screen.findByTestId('detail-followup-draft')) as HTMLButtonElement;
    await waitFor(() => expect(draftButton.disabled).toBe(false));
    await user.click(draftButton);
    await screen.findByTestId('detail-followup-editor');
    await user.click(screen.getByTestId('detail-followup-sent'));

    // Stored, immediately, with the marker on its own line.
    await waitFor(() => {
      expect(port.entries()[0]?.application.notes).toBe('Spoke to Dana.\nfollowed up 2026-09-13');
    });
    // And shown in the Notes box the user is looking at.
    const notes = screen.getByTestId('detail-notes') as HTMLTextAreaElement;
    expect(notes.value).toBe('Spoke to Dana.\nfollowed up 2026-09-13');
    expect(port.documents()).toHaveLength(1);

    // Now the part that used to lose it: type in Notes and let it autosave.
    await user.type(notes, '\nThey replied!');
    await waitFor(
      () => {
        expect(port.entries()[0]?.application.notes).toBe(
          'Spoke to Dana.\nfollowed up 2026-09-13\nThey replied!',
        );
      },
      { timeout: AUTOSAVE_DELAY_MS * 4 },
    );
    expect(followUpsSent(port.entries()[0]?.application.notes ?? null)).toEqual(['2026-09-13']);

    // One follow-up recorded means the panel now says so.
    expect(screen.getByTestId('detail-followup-state').getAttribute('data-state')).toBe('too-soon');
  });
});
