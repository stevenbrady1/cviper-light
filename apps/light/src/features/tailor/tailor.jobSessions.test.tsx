// @vitest-environment jsdom
/**
 * L-199 on the Tailor screen: the work belongs to a JOB, and outlives the view.
 *
 *   - Leaving the screen and coming back keeps the draft.
 *   - Two jobs each keep their own draft; neither leaks into the other.
 *   - A run's answer lands on the job it was started for, even if the user
 *     has switched to another job while it was thinking.
 *   - Editing the advert KEEPS the job link (owner decision, 2026-10-01): it
 *     says "Advert edited", the original can be restored, and saving to the
 *     application still works — with the edited advert saved beside the CV.
 *   - A job with no application gets a `saved` one when the user saves, rather
 *     than being sent to the tracker first.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Application, type Cv, type Job, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createJobSessions } = await import('./jobSessions');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { jobAdvertText } = await import('../analysis/model');

type JobSessions = ReturnType<typeof createJobSessions>;
type FakeTailorPort = ReturnType<typeof createFakeTailorPort>;

const NOW = new Date('2026-10-06T09:00:00.000Z');

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
BSc Mathematics, University of Leeds, 2016`;

const CVS: Cv[] = [
  {
    id: 'cv-1',
    name: 'CV.docx',
    file_path: null,
    extracted_text: CV_TEXT,
    json_resume: null,
    created_at: '2026-08-01T09:00:00.000Z',
  },
];

function job(id: string, title: string, company: string, description: string): Job {
  return {
    id,
    source: 'manual',
    external_id: null,
    title,
    company,
    agency: null,
    location: 'London',
    salary_min: null,
    salary_max: null,
    salary_currency: null,
    salary_period: null,
    description,
    url: null,
    posted_date: null,
    created_at: '2026-08-01T09:00:00.000Z',
  };
}

const JOB_A = job(
  'job-a',
  'Credit Risk Analyst',
  'Lloyds',
  'You will build SQL models and report on IFRS 9 impairment. Python essential.',
);
const JOB_B = job(
  'job-b',
  'Model Validation Analyst',
  'Barclays',
  'Validate IFRS 9 and Basel models. Python and SQL. Strong written communication.',
);

/** Job A has an application; job B has none. */
const APPLICATION_A: Application = {
  id: 'app-a',
  job_id: 'job-a',
  status: 'saved',
  applied_date: null,
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-09-29T09:00:00.000Z',
};

const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3B' },
    },
  ],
});

function draft(summary: string) {
  return {
    summary,
    key_skills: ['Python', 'IFRS 9'],
    experience: [
      {
        title: 'Senior Credit Risk Analyst',
        company: 'Lloyds Banking Group',
        location: 'London',
        dates: 'Jan 2020 – Present',
        bullets: ['Built IFRS 9 impairment models in Python, cutting run time by 40%.'],
      },
    ],
    education: ['BSc Mathematics, University of Leeds, 2016'],
    certifications: [],
  };
}

function reply(content: unknown): Result<ProviderHttpResponse, ProviderError> {
  return ok({
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(content) },
      done_reason: 'stop',
    }),
  });
}

/**
 * Answers each chat with the next summary in the queue. `hold()` makes the
 * NEXT chat wait until `release()` — for the late-answer test.
 */
function transport(summaries: string[]) {
  let gate: Promise<void> | null = null;
  let open: () => void = () => {};
  const chat: ChatTransport = {
    chat: async () => {
      if (gate !== null) {
        const waiting = gate;
        gate = null;
        await waiting;
      }
      return reply(draft(summaries.shift() ?? 'Out of answers.'));
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
  return {
    chat,
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
  };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

interface Setup {
  readonly sessions: JobSessions;
  readonly port: FakeTailorPort;
  readonly chat: ReturnType<typeof transport>;
}

function setup(summaries: string[] = ['Draft one.', 'Draft two.', 'Draft three.']): Setup {
  return {
    sessions: createJobSessions(),
    port: createFakeTailorPort({ cvs: CVS, jobs: [JOB_A, JOB_B], applications: [APPLICATION_A] }),
    chat: transport(summaries),
  };
}

async function mount({ sessions, port, chat }: Setup) {
  const user = userEvent.setup();
  const view = render(
    <Tailor
      port={port}
      filePort={createFakeFilePort()}
      createTransport={() => chat.chat}
      consentPort={createFakeConsentPort()}
      now={NOW}
      jobSessions={sessions}
    />,
  );
  await screen.findByTestId('view-tailor');
  await vi.waitFor(() => expect(pick('tailor-provider').value).toBe('ollama:llama3.2:3b'));
  await vi.waitFor(() => expect(screen.getByTestId('tailor-job-pick')).toBeTruthy());
  return { user, view };
}

const pick = (id: string) => screen.getByTestId<HTMLSelectElement>(id);
const advert = () => screen.getByTestId<HTMLTextAreaElement>('tailor-job-text');
const summaryShown = () => screen.getByTestId('tailor-cv').textContent ?? '';

async function tailor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
}

describe('the draft belongs to the job, and outlives the screen (L-199)', () => {
  it('happy: leaving the screen and coming back keeps the job, the advert and the draft', async () => {
    const s = setup();
    const first = await mount(s);
    await first.user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(first.user);
    expect(summaryShown()).toContain('Draft one.');

    first.view.unmount();
    await mount(s);

    expect(pick('tailor-job-pick').value).toBe('job-a');
    expect(advert().value).toBe(jobAdvertText(JOB_A));
    expect(summaryShown()).toContain('Draft one.');
  });

  it('two jobs keep their own drafts, and neither leaks into the other', async () => {
    const s = setup();
    const { user } = await mount(s);

    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(user);
    expect(summaryShown()).toContain('Draft one.');

    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    expect(advert().value).toBe(jobAdvertText(JOB_B));
    expect(screen.queryByTestId('tailor-result')).toBeNull();
    await tailor(user);
    expect(summaryShown()).toContain('Draft two.');

    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    expect(advert().value).toBe(jobAdvertText(JOB_A));
    expect(summaryShown()).toContain('Draft one.');
  });

  it('edge: an answer that arrives after switching jobs lands on the job it was for', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');

    s.chat.hold();
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-progress');
    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    s.chat.release();

    // Job B: nothing arrived, and nothing is running.
    await vi.waitFor(() => expect(s.sessions.session('job-a').result).not.toBeNull());
    expect(screen.queryByTestId('tailor-result')).toBeNull();
    expect(screen.queryByTestId('tailor-progress')).toBeNull();

    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    expect(summaryShown()).toContain('Draft one.');
  });
});

describe('editing the advert keeps the job (owner decision, 2026-10-01)', () => {
  it('happy: the job stays selected, "Advert edited" shows, and the original can be restored', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    expect(screen.queryByTestId('tailor-advert-edited')).toBeNull();

    await user.type(advert(), ' Also Tableau.');

    expect(pick('tailor-job-pick').value).toBe('job-a');
    expect(screen.getByTestId('tailor-advert-edited').textContent).toContain('Advert edited');

    await user.click(screen.getByTestId('tailor-advert-restore'));
    expect(advert().value).toBe(jobAdvertText(JOB_A));
    expect(screen.queryByTestId('tailor-advert-edited')).toBeNull();
  });

  it('saving after an edit still goes to the application, with the edited advert beside the CV', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await user.type(advert(), ' Also Tableau.');
    await tailor(user);

    await user.click(screen.getByTestId('tailor-save-application'));

    await vi.waitFor(() => expect(s.port.storedDocuments()).toHaveLength(2));
    const kinds = s.port.storedDocuments().map((document) => document.kind);
    expect([...kinds].sort()).toEqual(['advert', 'cv']);
    const saved = s.port.storedDocuments().find((document) => document.kind === 'advert');
    expect(saved?.application_id).toBe('app-a');
    expect(saved?.title).toBe('Advert (edited) — Credit Risk Analyst');
    expect(saved?.text).toContain('Also Tableau.');
  });

  it('negative: an unedited advert is not saved again — only the CV', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(user);

    await user.click(screen.getByTestId('tailor-save-application'));

    await vi.waitFor(() => expect(s.port.storedDocuments()).toHaveLength(1));
    expect(s.port.storedDocuments()[0]?.kind).toBe('cv');
  });

  it('boundary: editing the advert back to the original text clears the marker', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await user.type(advert(), 'X');
    expect(screen.getByTestId('tailor-advert-edited')).toBeTruthy();
    await user.type(advert(), '{Backspace}');
    expect(screen.queryByTestId('tailor-advert-edited')).toBeNull();
  });
});

describe('saving to a job with no application (L-199)', () => {
  it('happy: creates a saved application for the job, and saves the CV into it', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    await tailor(user);

    expect(screen.getByTestId('tailor-save-application')).toHaveProperty('disabled', false);
    expect(screen.queryByTestId('tailor-save-application-reason')).toBeNull();
    await user.click(screen.getByTestId('tailor-save-application'));

    await vi.waitFor(() => expect(s.port.storedDocuments()).toHaveLength(1));
    const created = s.port.storedApplications().filter((app) => app.job_id === 'job-b');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ status: 'saved', applied_date: null });
    expect(s.port.storedDocuments()[0]?.application_id).toBe(created[0]?.id);
    expect(screen.getByTestId('tailor-save-message').textContent).toContain('Saved');
  });

  it('a second save reuses the application it created, never a second one', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    await tailor(user);
    await user.click(screen.getByTestId('tailor-save-application'));
    await vi.waitFor(() => expect(s.port.storedDocuments()).toHaveLength(1));

    await user.click(screen.getByTestId('tailor-save-application'));
    await vi.waitFor(() => expect(s.port.storedDocuments()).toHaveLength(2));
    expect(s.port.storedApplications().filter((app) => app.job_id === 'job-b')).toHaveLength(1);
  });

  it('negative: if the application cannot be created, nothing is saved and it says so', async () => {
    const s = setup();
    const { user } = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    await tailor(user);

    s.port.failNext('createApplication');
    await user.click(screen.getByTestId('tailor-save-application'));

    const error = await screen.findByTestId('tailor-error');
    expect(error.textContent).toContain('could not be saved');
    expect(s.port.storedDocuments()).toHaveLength(0);
    // The draft is still there to try again.
    expect(screen.getByTestId('tailor-result')).toBeTruthy();
  });
});
