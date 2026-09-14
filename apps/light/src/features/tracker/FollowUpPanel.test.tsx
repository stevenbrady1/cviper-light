// @vitest-environment jsdom
/**
 * The follow-up panel against a fake port and a fake transport.
 *
 * What is proved here, in order: the sentence and the button follow the state
 * from `followUp.ts`; a run puts an EDITABLE draft on screen; "Mark as sent"
 * records the marker through `onEdit` and archives the text through the port;
 * a status change into interviewing offers a thank-you; and a failed run shows
 * the reason and archives NOTHING.
 *
 * The transport is counted, not just answered, so "disabled" means "no request
 * was made" rather than "the button looked grey".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok, type Application, type Document, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { FollowUpPanel, NO_AI_NOTE, THANK_YOU_OFFER, materialsFrom } from './FollowUpPanel';
import { createEntry, EMPTY_DRAFT, type TrackerEntry } from './model';
import { createFakeTrackerPort, type FakePortSeed, type FakeTrackerPort } from './test/fakePort';

const NOW = '2026-09-01T09:00:00.000Z';
const TODAY_DUE = '2026-09-13';
const TODAY_TOO_SOON = '2026-09-04';

const DRAFT = {
  subject: 'Following up on my Credit Risk Analyst application',
  body: 'Hello Dana,\n\nI wanted to check in on my application.\n\nKind regards,\nJane Doe',
};

const WITH_OLLAMA: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2 (3.2B)' }],
  anthropicKey: false,
  openaiKey: false,
};

const TWO_OPTIONS: Availability = { ...WITH_OLLAMA, openaiKey: true };

const NOTHING_CONFIGURED: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

function entryWith(overrides: Partial<Application> = {}): TrackerEntry {
  const base = createEntry(
    {
      ...EMPTY_DRAFT,
      title: 'Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      status: 'applied',
      description: 'Second-line credit risk for the wholesale book.',
    },
    { jobId: 'job-1', applicationId: 'app-1' },
    NOW,
  );
  return {
    ...base,
    application: { ...base.application, applied_date: '2026-09-01', ...overrides },
  };
}

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/** A transport that answers with a queue of replies and counts the calls. */
function transportFor(replies: readonly string[]): ChatTransport & { readonly calls: number } {
  const queue = [...replies];
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      state.calls += 1;
      const body = queue.length > 1 ? (queue.shift() ?? '') : (queue[0] ?? '');
      return Promise.resolve(ok({ status: 200, body }));
    },
    listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      throw new Error('the follow-up panel must never list models');
    },
  };
}

function renderPanel(options: {
  entry?: TrackerEntry;
  today?: string;
  availability?: Availability;
  transport?: ChatTransport;
  seed?: FakePortSeed;
  onEdit?: (changes: Partial<Pick<Application, 'notes'>>) => void;
}): {
  port: FakeTrackerPort;
  onEdit: ReturnType<typeof vi.fn>;
  rerender: (e: TrackerEntry) => void;
} {
  const entry = options.entry ?? entryWith();
  const port = createFakeTrackerPort([entry], options.seed ?? {});
  const onEdit = vi.fn(options.onEdit ?? (() => {}));
  const transport = options.transport ?? transportFor([ollamaBody(JSON.stringify(DRAFT))]);

  const props = (current: TrackerEntry) => ({
    entry: current,
    today: options.today ?? TODAY_DUE,
    port,
    readAvailability: () => Promise.resolve(options.availability ?? WITH_OLLAMA),
    createTransport: () => transport,
    onEdit,
  });

  const view = render(<FollowUpPanel {...props(entry)} />);
  return {
    port,
    onEdit,
    rerender: (next) => view.rerender(<FollowUpPanel {...props(next)} />),
  };
}

afterEach(() => {
  cleanup();
});

describe('the state sentence and the button', () => {
  it('due: says so and enables the button once a model is known', async () => {
    renderPanel({});

    expect(screen.getByTestId('detail-followup-state').textContent).toBe(
      'Quiet for 12 days. Worth a nudge.',
    );
    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
  });

  it('too soon: says which day to wait for, and the button stays disabled', async () => {
    renderPanel({ today: TODAY_TOO_SOON });

    expect(screen.getByTestId('detail-followup-state').textContent).toBe(
      'Sent 3 days ago — give it until 2026-09-11.',
    );
    // Give the probe time to land, so this is "disabled because too soon" and
    // not "disabled because the probe has not answered yet".
    await waitFor(() => expect(screen.queryByTestId('detail-followup-reason')).toBeNull());
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(true);
  });

  it('negative: nothing configured disables the button with the reason, even when due', async () => {
    renderPanel({ availability: NOTHING_CONFIGURED });

    expect((await screen.findByTestId('detail-followup-reason')).textContent).toBe(NO_AI_NOTE);
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(true);
  });

  it('exhausted after two markers, whatever the model situation', async () => {
    renderPanel({
      entry: entryWith({ notes: 'followed up 2026-09-11\nfollowed up 2026-09-21' }),
      today: '2027-01-01',
    });

    expect(screen.getByTestId('detail-followup-state').textContent).toBe(
      'Two follow-ups sent and no reply. The honest next step is recording the outcome.',
    );
    await waitFor(() => expect(screen.queryByTestId('detail-followup-reason')).toBeNull());
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(true);
  });

  it('boundary: the picker appears only when there is a choice', async () => {
    renderPanel({ availability: TWO_OPTIONS });
    expect(await screen.findByTestId('detail-followup-provider')).toBeTruthy();

    cleanup();
    renderPanel({ availability: WITH_OLLAMA });
    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    expect(screen.queryByTestId('detail-followup-provider')).toBeNull();
  });
});

describe('a run', () => {
  it('shows the draft in an editable subject and body', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(DRAFT))]);
    renderPanel({ transport });

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));

    const subject = (await screen.findByTestId('detail-followup-subject')) as HTMLInputElement;
    const body = screen.getByTestId('detail-followup-body') as HTMLTextAreaElement;
    expect(subject.value).toBe(DRAFT.subject);
    expect(body.value).toBe(DRAFT.body);
    expect(transport.calls).toBe(1);

    await user.type(subject, ' — Jane');
    expect(subject.value).toBe(`${DRAFT.subject} — Jane`);
  });

  it('reads the archived materials and the profile through the port before asking', async () => {
    const user = userEvent.setup();
    const { port } = renderPanel({});

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('detail-followup-editor');

    expect(port.calls.documentsFor).toBe(1);
    expect(port.calls.profile).toBe(1);
  });

  it('negative: a transport failure shows the reason in the panel and archives nothing', async () => {
    const user = userEvent.setup();
    const failing: ChatTransport = {
      chat: () =>
        Promise.resolve(ok({ status: 500, body: JSON.stringify({ error: 'model exploded' }) })),
      listModels: () => {
        throw new Error('unused');
      },
    };
    const { port, onEdit } = renderPanel({ transport: failing });

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));

    const error = await screen.findByTestId('detail-followup-error');
    expect(error.textContent?.length).toBeGreaterThan(0);
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
    expect(port.documents()).toHaveLength(0);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('negative: a model answering prose twice shows a sentence, never a blank editor', async () => {
    const user = userEvent.setup();
    renderPanel({ transport: transportFor([ollamaBody('nope'), ollamaBody('still nope')]) });

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));

    expect((await screen.findByTestId('detail-followup-error')).textContent).toContain(
      'write it by hand',
    );
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
  });
});

describe('"Mark as sent"', () => {
  it('writes the marker into the notes via onEdit and archives a follow_up document', async () => {
    const user = userEvent.setup();
    const { port, onEdit } = renderPanel({ entry: entryWith({ notes: 'Spoke to Dana.' }) });

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('detail-followup-editor');
    await user.click(screen.getByTestId('detail-followup-sent'));

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith({ notes: `Spoke to Dana.\nfollowed up ${TODAY_DUE}` });

    const archived = port.documents();
    expect(archived).toHaveLength(1);
    const document = archived[0] as Document;
    expect(document.kind).toBe('follow_up');
    expect(document.application_id).toBe('app-1');
    expect(document.title).toBe(`Follow-up — ${TODAY_DUE}`);
    expect(document.text).toBe(`${DRAFT.subject}\n\n${DRAFT.body}`);

    // The editor closes: the draft has gone where it was going.
    expect(screen.queryByTestId('detail-followup-editor')).toBeNull();
  });

  it('archives what the user EDITED, not what the model said', async () => {
    const user = userEvent.setup();
    const { port } = renderPanel({});

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));
    const subject = await screen.findByTestId('detail-followup-subject');
    await user.clear(subject);
    await user.type(subject, 'Quick check-in');
    await user.click(screen.getByTestId('detail-followup-sent'));

    await waitFor(() => expect(port.documents()).toHaveLength(1));
    expect(port.documents()[0]?.text.startsWith('Quick check-in\n\n')).toBe(true);
  });

  it('negative: an archive failure changes nothing — no marker, no document, a message', async () => {
    const user = userEvent.setup();
    const { port, onEdit } = renderPanel({});

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('detail-followup-editor');

    port.failNext('saveDocument');
    await user.click(screen.getByTestId('detail-followup-sent'));

    await screen.findByTestId('detail-followup-error');
    expect(onEdit).not.toHaveBeenCalled();
    expect(port.documents()).toHaveLength(0);
    // The draft is still there to try again with.
    expect(screen.getByTestId('detail-followup-editor')).toBeTruthy();
  });

  it('Copy puts the subject and body on the clipboard', async () => {
    const user = userEvent.setup();
    renderPanel({});

    await waitFor(() => {
      expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(
        false,
      );
    });
    await user.click(screen.getByTestId('detail-followup-draft'));
    await screen.findByTestId('detail-followup-editor');
    await user.click(screen.getByTestId('detail-followup-copy'));

    expect((await screen.findByTestId('detail-followup-note')).textContent).toBe('Copied.');
    expect(await navigator.clipboard.readText()).toBe(`${DRAFT.subject}\n\n${DRAFT.body}`);
  });
});

describe('the thank-you offer', () => {
  it('appears on a status change INTO interviewing, and drafts a thank-you', async () => {
    const user = userEvent.setup();
    const transport = transportFor([ollamaBody(JSON.stringify(DRAFT))]);
    const { port, onEdit, rerender } = renderPanel({ today: TODAY_TOO_SOON, transport });

    expect(screen.queryByTestId('detail-thankyou-offer')).toBeNull();

    rerender(entryWith({ status: 'interviewing' }));

    expect(screen.getByTestId('detail-thankyou-offer').textContent).toBe(THANK_YOU_OFFER);
    const button = screen.getByTestId('detail-thankyou-draft') as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    // No quiet rule: the follow-up button is still too soon, the thank-you is not.
    expect((screen.getByTestId('detail-followup-draft') as HTMLButtonElement).disabled).toBe(true);

    await user.click(button);
    await screen.findByTestId('detail-followup-editor');
    expect(transport.calls).toBe(1);

    await user.click(screen.getByTestId('detail-followup-sent'));
    await waitFor(() => expect(port.documents()).toHaveLength(1));
    expect(port.documents()[0]?.kind).toBe('follow_up');
    expect(port.documents()[0]?.title).toBe(`Thank-you — ${TODAY_TOO_SOON}`);
    // Recorded in the notes in words the follow-up count does not read.
    expect(onEdit).toHaveBeenCalledWith({ notes: `thank-you sent ${TODAY_TOO_SOON}` });
    expect(screen.queryByTestId('detail-thankyou-offer')).toBeNull();
  });

  it('negative: is not offered when the panel opens already interviewing', () => {
    renderPanel({ entry: entryWith({ status: 'interviewing' }) });
    expect(screen.queryByTestId('detail-thankyou-offer')).toBeNull();
  });

  it('boundary: goes away again when the status moves out of interviewing', () => {
    const { rerender } = renderPanel({});
    rerender(entryWith({ status: 'interviewing' }));
    expect(screen.getByTestId('detail-thankyou-offer')).toBeTruthy();
    rerender(entryWith({ status: 'offer' }));
    expect(screen.queryByTestId('detail-thankyou-offer')).toBeNull();
  });
});

describe('materialsFrom — the newest of each kind, advert falling back to the job', () => {
  const doc = (id: string, kind: Document['kind'], text: string, at: string): Document => ({
    id,
    application_id: 'app-1',
    kind,
    title: id,
    text,
    created_at: at,
  });

  it('picks the newest of each kind whichever order the port returned them in', () => {
    const materials = materialsFrom(
      [
        doc('cv-new', 'cv', 'CV v2', '2026-09-02T00:00:00.000Z'),
        doc('cv-old', 'cv', 'CV v1', '2026-09-01T00:00:00.000Z'),
        doc('letter', 'cover_letter', 'Dear Dana', '2026-09-01T00:00:00.000Z'),
        doc('advert', 'advert', 'The advert', '2026-09-01T00:00:00.000Z'),
      ],
      'fallback',
    );
    expect(materials).toEqual({ advert: 'The advert', cv: 'CV v2', coverLetter: 'Dear Dana' });
  });

  it('boundary: the job description stands in for a missing advert, and only for that', () => {
    expect(materialsFrom([], 'From the job')).toEqual({
      advert: 'From the job',
      cv: null,
      coverLetter: null,
    });
    expect(materialsFrom([], null)).toEqual({ advert: null, cv: null, coverLetter: null });
  });

  it('negative: an interview pack or an earlier follow-up is never a material', () => {
    const materials = materialsFrom(
      [
        doc('pack', 'interview_pack', 'Questions', '2026-09-01T00:00:00.000Z'),
        doc('fu', 'follow_up', 'Earlier follow-up', '2026-09-01T00:00:00.000Z'),
      ],
      null,
    );
    expect(materials).toEqual({ advert: null, cv: null, coverLetter: null });
  });
});
