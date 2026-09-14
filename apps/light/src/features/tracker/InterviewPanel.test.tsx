// @vitest-environment jsdom
/**
 * The interview panel, driven against a fake port and a fake transport.
 *
 * What is proved:
 *   - a canned valid pack renders as four sections;
 *   - "Save this pack" archives an `interview_pack` document through the port
 *     with the rendered text;
 *   - a pack saved earlier shows, collapsed, on mount;
 *   - with no AI on the machine the button is disabled with its reason and
 *     NO transport is ever built (counted at the factory, as
 *     `runExtraction.consent.test.ts` counts it);
 *   - a transport failure is a sentence, and nothing is saved.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ok, type Document, type Profile, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type Availability } from '../analysis/providers';

import { InterviewPanel, NO_AI_NOTE } from './InterviewPanel';
import { createEntry, EMPTY_DRAFT } from './model';
import { createFakeTrackerPort } from './test/fakePort';

const NOW = new Date(2026, 8, 14, 9, 0, 0);

const ENTRY = createEntry(
  {
    ...EMPTY_DRAFT,
    title: 'Credit Risk Analyst',
    company: 'Lloyds Banking Group',
    location: 'London',
    description: 'Second-line credit risk. SQL, Python, IFRS 9 models.',
  },
  { jobId: 'job-1', applicationId: 'app-1' },
  '2026-09-01T09:00:00.000Z',
);

const PROFILE: Profile = {
  id: 'me',
  headline: 'Credit risk analyst who ships models',
  languages: [],
  work_rights: null,
  deal_breakers: [],
  target_sectors: [],
  career_goals: ['Lead a model validation team'],
  energising: [],
  draining: [],
  writing_style: null,
  star_examples: [
    {
      title: 'Moved the risk book to Postgres',
      situation: 'The desk ran on a spreadsheet.',
      task: 'Replace it without an outage.',
      action: 'Built the schema and cut over at quarter end.',
      result: 'Zero outages.',
    },
  ],
  updated_at: '2026-09-01T09:00:00.000Z',
};

const PACK = {
  likely_questions: [
    {
      question: 'Tell me about a migration you led.',
      suggested_answer: 'The desk ran on a spreadsheet; I moved it to Postgres with no outage.',
    },
    { question: 'Why credit risk?', suggested_answer: 'Six years of it at a challenger bank.' },
  ],
  talking_points: ['Zero-outage cutover at quarter end'],
  questions_to_ask: ['How is IFRS 9 model ownership split between risk and finance?'],
  gaps_to_bridge: ['SAS', 'IFRS 9'],
};

/** Everything a machine with one local model reports. */
const LOCAL_ONLY: Availability = {
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:latest', label: 'llama3.2' }],
  anthropicKey: false,
  openaiKey: false,
};

const NOTHING: Availability = {
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
};

function ollamaBody(content: string): string {
  return JSON.stringify({ message: { content }, done_reason: 'stop' });
}

/** A transport factory that counts how many times it was asked to exist. */
function countingFactory(reply: Result<ProviderHttpResponse, ProviderError>): {
  readonly built: () => number;
  readonly factory: () => ChatTransport;
} {
  const state = { built: 0 };
  return {
    built: () => state.built,
    factory: () => {
      state.built += 1;
      return {
        chat: () => Promise.resolve(reply),
        listModels: () => {
          throw new Error('the panel must never list models');
        },
      };
    },
  };
}

const GOOD_REPLY = ok({ status: 200, body: ollamaBody(JSON.stringify(PACK)) });

function savedPack(): Document {
  return {
    id: 'pack-0',
    application_id: 'app-1',
    kind: 'interview_pack',
    title: 'Interview pack — 2026-09-01',
    text: 'LIKELY QUESTIONS\n\n1. An older question?\n   An older answer.\n',
    created_at: '2026-09-01T10:00:00.000Z',
  };
}

afterEach(() => {
  cleanup();
});

describe('InterviewPanel — preparing a pack', () => {
  it('renders the four sections from a canned pack, gaps as chips', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE, cvText: 'Jane Doe. SQL.' });
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );

    // Nothing is built by mounting.
    expect(transport.built()).toBe(0);

    fireEvent.click(screen.getByTestId('detail-interview-prepare'));

    const pack = await screen.findByTestId('detail-interview-pack');
    expect(transport.built()).toBe(1);

    expect(within(pack).getByText('Likely questions')).toBeTruthy();
    expect(within(pack).getByText('Talking points')).toBeTruthy();
    expect(within(pack).getByText('Questions to ask')).toBeTruthy();
    expect(within(pack).getByText('Gaps to bridge')).toBeTruthy();

    const question = within(pack).getByText('Tell me about a migration you led.');
    expect(question.className).toContain('font-medium');
    expect(within(pack).getByText(/moved it to Postgres with no outage/)).toBeTruthy();
    expect(within(pack).getByText('Zero-outage cutover at quarter end')).toBeTruthy();
    expect(within(pack).getByText(/IFRS 9 model ownership/)).toBeTruthy();

    const gaps = within(pack).getByTestId('detail-interview-gaps');
    expect(
      within(gaps)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['SAS', 'IFRS 9']);
    expect(within(gaps).getByText('SAS').className).toContain('text-gold');

    // Nothing was archived just by preparing.
    expect(port.documents()).toEqual([]);
  });

  it('sends the archived materials and the profile, with the CV fallback when none was archived', async () => {
    const seen: string[] = [];
    const factory = (): ChatTransport => ({
      chat: (_provider, body) => {
        seen.push(body);
        return Promise.resolve(GOOD_REPLY);
      },
      listModels: () => {
        throw new Error('never');
      },
    });
    const port = createFakeTrackerPort([ENTRY], {
      profile: PROFILE,
      cvText: 'FALLBACK CV TEXT',
      documents: [
        {
          id: 'letter-1',
          application_id: 'app-1',
          kind: 'cover_letter',
          title: 'Cover letter',
          text: 'ARCHIVED LETTER TEXT',
          created_at: '2026-09-02T09:00:00.000Z',
        },
      ],
    });

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={factory}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('detail-interview-pack');

    expect(seen).toHaveLength(1);
    const body = seen[0] ?? '';
    expect(body).toContain('FALLBACK CV TEXT');
    expect(body).toContain('ARCHIVED LETTER TEXT');
    // The job's description stands in for an advert that was never archived.
    expect(body).toContain('Second-line credit risk');
    expect(body).toContain('Moved the risk book to Postgres');
    expect(body).toContain('Credit risk analyst who ships models');
    expect(port.calls.latestCvText).toBe(1);
  });

  it('shows the elapsed seconds while a model is thinking', async () => {
    vi.useFakeTimers();
    try {
      let resolve: ((value: Result<ProviderHttpResponse, ProviderError>) => void) | null = null;
      const factory = (): ChatTransport => ({
        chat: () =>
          new Promise((done) => {
            resolve = done;
          }),
        listModels: () => {
          throw new Error('never');
        },
      });
      const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });

      render(
        <InterviewPanel
          entry={ENTRY}
          port={port}
          availability={LOCAL_ONLY}
          createTransport={factory}
          now={NOW}
        />,
      );
      fireEvent.click(screen.getByTestId('detail-interview-prepare'));

      const progress = await vi.waitFor(() => screen.getByTestId('detail-interview-progress'));
      expect(progress.textContent).toContain('0s');
      await vi.advanceTimersByTimeAsync(2000);
      expect(screen.getByTestId('detail-interview-progress').textContent).toContain('2s');

      expect(resolve).not.toBeNull();
      (resolve as unknown as (value: Result<ProviderHttpResponse, ProviderError>) => void)(
        GOOD_REPLY,
      );
      await vi.waitFor(() => screen.getByTestId('detail-interview-pack'));
      expect(screen.queryByTestId('detail-interview-progress')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('InterviewPanel — saving', () => {
  it('archives an interview_pack document with the rendered text, titled by date', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('detail-interview-pack');

    fireEvent.click(screen.getByTestId('detail-interview-save'));

    await vi.waitFor(() => {
      expect(port.calls.saveDocument).toBe(1);
    });
    const [written] = port.documents();
    expect(written).toBeDefined();
    expect(written?.kind).toBe('interview_pack');
    expect(written?.application_id).toBe('app-1');
    expect(written?.title).toBe('Interview pack — 2026-09-14');
    expect(written?.text).toContain('LIKELY QUESTIONS');
    expect(written?.text).toContain('1. Tell me about a migration you led.');
    expect(written?.text).toContain('- SAS');

    // The saved pack now shows under "Last saved pack".
    const saved = await screen.findByTestId('detail-interview-saved');
    expect(saved.textContent).toContain('Interview pack — 2026-09-14');
  });

  it('negative: a failed save is a sentence, and the pack stays on screen', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));
    await screen.findByTestId('detail-interview-pack');

    port.failNext('saveDocument');
    fireEvent.click(screen.getByTestId('detail-interview-save'));

    const note = await screen.findByTestId('detail-interview-note');
    expect(note.textContent).toContain('could not be saved');
    expect(port.documents()).toEqual([]);
    expect(screen.getByTestId('detail-interview-pack')).toBeTruthy();
  });
});

describe('InterviewPanel — the last saved pack', () => {
  it('shows a previously saved pack, collapsed, on mount', async () => {
    const port = createFakeTrackerPort([ENTRY], { documents: [savedPack()] });

    render(<InterviewPanel entry={ENTRY} port={port} availability={LOCAL_ONLY} now={NOW} />);

    const saved = await screen.findByTestId('detail-interview-saved');
    expect(saved.tagName).toBe('DETAILS');
    expect((saved as HTMLDetailsElement).open).toBe(false);
    expect(saved.textContent).toContain('Interview pack — 2026-09-01');
    expect(saved.textContent).toContain('An older question?');
  });

  it('boundary: ignores other kinds of document and shows the newest pack', async () => {
    const older = savedPack();
    const newer: Document = {
      ...savedPack(),
      id: 'pack-1',
      title: 'Interview pack — 2026-09-10',
      created_at: '2026-09-10T10:00:00.000Z',
    };
    const letter: Document = {
      id: 'letter-1',
      application_id: 'app-1',
      kind: 'cover_letter',
      title: 'Cover letter',
      text: 'Dear hiring manager',
      created_at: '2026-09-12T10:00:00.000Z',
    };
    const port = createFakeTrackerPort([ENTRY], { documents: [older, newer, letter] });

    render(<InterviewPanel entry={ENTRY} port={port} availability={LOCAL_ONLY} now={NOW} />);

    const saved = await screen.findByTestId('detail-interview-saved');
    expect(saved.textContent).toContain('2026-09-10');
    expect(saved.textContent).not.toContain('Dear hiring manager');
  });

  it('boundary: no saved pack, no section', async () => {
    const port = createFakeTrackerPort([ENTRY]);
    render(<InterviewPanel entry={ENTRY} port={port} availability={LOCAL_ONLY} now={NOW} />);
    await vi.waitFor(() => {
      expect(port.calls.documentsFor).toBe(1);
    });
    expect(screen.queryByTestId('detail-interview-saved')).toBeNull();
  });
});

describe('InterviewPanel — when it cannot run', () => {
  it('negative: no AI on the machine — disabled, with the reason, and no transport built', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={NOTHING}
        createTransport={transport.factory}
        now={NOW}
      />,
    );

    const button = screen.getByTestId('detail-interview-prepare') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId('detail-interview-no-ai').textContent).toBe(NO_AI_NOTE);

    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(port.calls.documentsFor).toBe(1);
    });
    expect(transport.built()).toBe(0);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
  });

  it('boundary: while the board is still probing, disabled without the reason', () => {
    const port = createFakeTrackerPort([ENTRY]);
    render(<InterviewPanel entry={ENTRY} port={port} now={NOW} />);

    expect((screen.getByTestId('detail-interview-prepare') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByTestId('detail-interview-no-ai')).toBeNull();
  });

  it('negative: a transport failure is a sentence, and nothing is saved', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });
    const transport = countingFactory(
      ok({ status: 500, body: JSON.stringify({ error: 'model crashed' }) }),
    );

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));

    const note = await screen.findByTestId('detail-interview-note');
    expect(note.textContent?.length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
    expect(screen.queryByTestId('detail-interview-save')).toBeNull();
    expect(port.calls.saveDocument).toBe(0);
    expect(port.documents()).toEqual([]);
  });

  it('negative: no material at all is refused with a sentence before any transport is built', async () => {
    // No profile, no CV anywhere, nothing archived: nothing real to answer from.
    const port = createFakeTrackerPort([ENTRY]);
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));

    const note = await screen.findByTestId('detail-interview-note');
    expect(note.textContent).toContain('nothing to prepare from');
    expect(transport.built()).toBe(1);
    expect(screen.queryByTestId('detail-interview-pack')).toBeNull();
  });

  it('negative: a port read failure stops the run with its own sentence', async () => {
    const port = createFakeTrackerPort([ENTRY], { profile: PROFILE });
    const transport = countingFactory(GOOD_REPLY);

    render(
      <InterviewPanel
        entry={ENTRY}
        port={port}
        availability={LOCAL_ONLY}
        createTransport={transport.factory}
        now={NOW}
      />,
    );
    await vi.waitFor(() => {
      expect(port.calls.documentsFor).toBe(1);
    });

    port.failNext('profile');
    fireEvent.click(screen.getByTestId('detail-interview-prepare'));

    const note = await screen.findByTestId('detail-interview-note');
    expect(note.textContent).toContain('profile could not be read');
    expect(transport.built()).toBe(0);
  });
});
