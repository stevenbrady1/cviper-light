// @vitest-environment jsdom
/**
 * L-200 on the Tailor screen: the step bar for the job being tailored.
 *
 * Shown only when a tracked job is chosen; Tailor, ATS Score and Export are
 * this screen's own steps, Find and Analyse belong to the shell; nothing on
 * the bar ever starts a model call; and switching jobs switches the bar.
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

import type { StepId } from '../flow/steps';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createJobSessions } = await import('./jobSessions');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { createFakeProgressPort } = await import('../flow/test/fakeProgressPort');

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

function setup(
  options: {
    progress?: Parameters<typeof createFakeProgressPort>[0];
    entryStep?: 'tailor' | 'ats' | 'export';
    sessions?: ReturnType<typeof createJobSessions>;
  } = {},
) {
  let chats = 0;
  const chat = transport(['Draft one.', 'Draft two.']);
  const counting = {
    ...chat.chat,
    chat: (...args: Parameters<typeof chat.chat.chat>) => {
      chats += 1;
      return chat.chat.chat(...args);
    },
  };
  const onJobStep = vi.fn<(step: StepId, job: Job) => void>();
  const onTracker = vi.fn();
  const progressPort = createFakeProgressPort(options.progress ?? {});
  const port = createFakeTailorPort({
    cvs: CVS,
    jobs: [JOB_A, JOB_B],
    applications: [APPLICATION_A],
  });
  return { counting, onJobStep, onTracker, progressPort, port, chats: () => chats, ...options };
}

async function mount(s: ReturnType<typeof setup>) {
  const user = userEvent.setup();
  render(
    <Tailor
      port={s.port}
      filePort={createFakeFilePort()}
      createTransport={() => s.counting}
      consentPort={createFakeConsentPort()}
      now={NOW}
      jobSessions={s.sessions ?? createJobSessions()}
      progressPort={s.progressPort}
      onJobStep={s.onJobStep}
      onTracker={s.onTracker}
      entryStep={s.entryStep}
    />,
  );
  await screen.findByTestId('view-tailor');
  await vi.waitFor(() => expect(pick('tailor-provider').value).toBe('ollama:llama3.2:3b'));
  return user;
}

const pick = (id: string) => screen.getByTestId<HTMLSelectElement>(id);
const stateOf = (id: string) => screen.getByTestId(`job-step-${id}`).getAttribute('data-state');

async function tailor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
}

describe('the step bar on Tailor (L-200)', () => {
  it('negative: no tracked job (a pasted advert) means no bar', async () => {
    await mount(setup());
    expect(screen.queryByTestId('job-steps')).toBeNull();
  });

  it('happy: a tracked job shows its bar, on the Tailor step, naming the job', async () => {
    const s = setup({ progress: { 'job-a': { analysed: true } } });
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');

    expect(screen.getByTestId('job-steps-job').textContent).toBe(
      'Credit Risk Analyst · Lloyds · London',
    );
    await vi.waitFor(() => expect(stateOf('analyse')).toBe('done'));
    expect(stateOf('find')).toBe('done');
    expect(stateOf('tailor')).toBe('current');
    expect(stateOf('ats')).toBe('todo');
  });

  it('skipped: a job never analysed shows Analyse as ⊘, and Tailor still works', async () => {
    const s = setup();
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await vi.waitFor(() => expect(s.progressPort.asked).toContain('job-a'));

    expect(stateOf('analyse')).toBe('skipped');
    await tailor(user);
    expect(screen.getByTestId('tailor-cv').textContent).toContain('Draft one.');
  });

  it('Next walks Tailor → ATS Score → Export on this screen, and never runs a model', async () => {
    const s = setup();
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(user);
    expect(s.chats()).toBe(1);

    await user.click(screen.getByTestId('job-steps-next'));
    expect(stateOf('ats')).toBe('current');
    expect(stateOf('tailor')).toBe('done');
    await user.click(screen.getByTestId('job-steps-next'));
    expect(stateOf('export')).toBe('current');
    expect(stateOf('ats')).toBe('done');

    await user.click(screen.getByTestId('job-step-tailor'));
    expect(stateOf('tailor')).toBe('current');
    expect(s.chats()).toBe(1);
    expect(s.onJobStep).not.toHaveBeenCalled();
  });

  it('Find and Analyse belong to the shell: handed back with the job', async () => {
    const s = setup();
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');

    await user.click(screen.getByTestId('job-step-analyse'));
    await user.click(screen.getByTestId('job-step-find'));
    await user.click(screen.getByTestId('job-steps-tracker'));

    expect(s.onJobStep.mock.calls.map(([step, job]) => [step, job.id])).toEqual([
      ['analyse', 'job-a'],
      ['find', 'job-a'],
    ]);
    expect(s.onTracker).toHaveBeenCalledTimes(1);
  });

  it('saving the CV marks Export done', async () => {
    const s = setup();
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(user);
    expect(stateOf('export')).toBe('todo');

    await user.click(screen.getByTestId('tailor-save-application'));
    await vi.waitFor(() => expect(stateOf('export')).toBe('done'));
  });

  it('switching jobs switches the bar: name, progress and step', async () => {
    const s = setup({ progress: { 'job-b': { analysed: true, exported: true } } });
    const user = await mount(s);
    await user.selectOptions(pick('tailor-job-pick'), 'job-a');
    await tailor(user);
    await user.click(screen.getByTestId('job-steps-next'));
    expect(stateOf('ats')).toBe('current');

    await user.selectOptions(pick('tailor-job-pick'), 'job-b');

    expect(screen.getByTestId('job-steps-job').textContent).toContain('Model Validation Analyst');
    expect(stateOf('tailor')).toBe('current');
    await vi.waitFor(() => expect(stateOf('export')).toBe('done'));
    expect(stateOf('analyse')).toBe('done');
    // Job B has no draft of its own.
    expect(screen.queryByTestId('tailor-result')).toBeNull();
  });

  it('boundary: arriving on a later step from another screen starts there; a new job starts on Tailor', async () => {
    const sessions = createJobSessions();
    sessions.open('job-a', () => ({}));
    const s = setup({ entryStep: 'export', sessions });
    const user = await mount(s);

    await vi.waitFor(() => expect(stateOf('export')).toBe('current'));

    await user.selectOptions(pick('tailor-job-pick'), 'job-b');
    expect(stateOf('tailor')).toBe('current');
  });
});
