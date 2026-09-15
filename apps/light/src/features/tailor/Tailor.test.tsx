// @vitest-environment jsdom
/**
 * The tailor view, driven the way a user drives it: a local model answers
 * with a canned tailored CV, and the screen shows the fabrication report, the
 * CV, the diff, the review, the letter, and saves both.
 *
 * The transport is a fake answering Ollama's envelope, exactly as
 * `analysis.aiPath.test.tsx` does. The real pipeline, the real fabrication
 * check and the real renderers run over it — every flag in this file is a
 * real flag.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
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
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT = `Steve Brady
Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
Analyst, Barclays, 2016 – 2019
- Ran stress tests.
BSc Mathematics, University of Leeds, 2016`;

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Credit Risk Analyst',
  company: 'Lloyds',
  location: 'London',
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  salary_period: null,
  description: 'You will build SQL models and report on IFRS 9 impairment. Python essential.',
  url: null,
  posted_date: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const APPLICATION: Application = {
  id: 'app-1',
  job_id: 'job-1',
  status: 'applied',
  applied_date: '2026-08-10',
  notes: null,
  next_action: null,
  next_action_date: null,
  updated_at: '2026-08-10T09:00:00.000Z',
};

/** A daemon with one chat model pulled. */
const TAGS = JSON.stringify({
  models: [
    {
      model: 'llama3.2:3b',
      name: 'llama3.2:3b',
      capabilities: ['completion'],
      details: { parameter_size: '3.2B' },
    },
  ],
});

/** A faithful tailored CV. */
const FAITHFUL = {
  summary: 'Credit risk analyst who cut IFRS 9 model run time by 40% at Lloyds Banking Group.',
  key_skills: ['Python', 'IFRS 9', 'Stress testing'],
  experience: [
    {
      title: 'Senior Credit Risk Analyst',
      company: 'Lloyds Banking Group',
      location: 'London',
      dates: 'Jan 2020 – Present',
      bullets: ['Built IFRS 9 impairment models in Python, cutting run time by 40%.'],
    },
    {
      title: 'Analyst',
      company: 'Barclays',
      location: '',
      dates: '2016 – 2019',
      bullets: ['Ran stress tests.'],
    },
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
};

/** The same CV with an employer the original never had. */
const INVENTED = {
  ...FAITHFUL,
  experience: [
    ...FAITHFUL.experience,
    {
      title: 'Consultant',
      company: 'Goldman Sachs',
      location: 'London',
      dates: '2014 – 2016',
      bullets: ['Advised on credit models.'],
    },
  ],
};

const REVIEW = {
  issues: [
    {
      section: 'Summary',
      problem: 'It does not mention SQL, which the advert asks for and the CV shows.',
      suggestion: 'Name SQL in the first sentence.',
    },
  ],
  verdict: 'revise',
};

const LETTER = {
  greeting: 'Dear Hiring Manager,',
  paragraphs: [
    'Having spent eight years in credit risk, I was drawn to the Credit Risk Analyst role.',
    'At Lloyds Banking Group I cut IFRS 9 model run time by 40%.',
  ],
  sign_off: 'Yours sincerely,\nSteve Brady',
};

function ollamaEnvelope(content: unknown): ProviderHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({
      message: { role: 'assistant', content: JSON.stringify(content) },
      done_reason: 'stop',
    }),
  };
}

/** A transport that answers each chat from a queue, in order. */
function queuedTransport(replies: readonly unknown[]): ChatTransport {
  const queue = [...replies];
  return {
    chat(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      const next = queue.shift();
      if (next === undefined) throw new Error('the transport was asked more than the test allows');
      return Promise.resolve(ok(ollamaEnvelope(next)));
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
}

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.invoke.mockImplementation(async (command) => {
    // Ollama running, no cloud keys — the setup a privacy-minded user has.
    if (command === 'ollama_probe') return TAGS;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
});

afterEach(() => {
  cleanup();
});

async function renderReady(replies: readonly unknown[]) {
  const port = createFakeTailorPort({ cvs: [CV], jobs: [JOB], applications: [APPLICATION] });
  const filePort = createFakeFilePort();
  const user = userEvent.setup();

  render(
    <Tailor
      port={port}
      filePort={filePort}
      createTransport={() => queuedTransport(replies)}
      consentPort={createFakeConsentPort()}
      now={NOW}
    />,
  );

  await screen.findByDisplayValue('CV.docx');
  await vi.waitFor(() =>
    expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return { port, filePort, user };
}

describe('the empty screen', () => {
  it('has exactly one primary button, and it explains why it cannot be pressed', async () => {
    await renderReady([]);

    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
    expect(screen.getByTestId('tailor-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('tailor-run-reason').textContent).toContain('Paste the job advert');
    expect(screen.getByTestId('tailor-empty')).toBeTruthy();
  });

  it('does not offer the basic match', async () => {
    await renderReady([]);
    const picker = screen.getByTestId('tailor-provider') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['ollama:llama3.2:3b']);
  });
});

describe('tailoring', () => {
  it('renders the CV, the clean report first, and the diff', async () => {
    const { user } = await renderReady([FAITHFUL]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const result = await screen.findByTestId('tailor-result');
    // Report FIRST, and teal, never red.
    const fabrication = screen.getByTestId('tailor-fabrication');
    expect(result.firstElementChild).toBe(fabrication);
    expect(fabrication.getAttribute('data-clean')).toBe('true');
    expect(fabrication.className).toContain('text-teal');
    expect(fabrication.className).not.toContain('danger');

    const cv = screen.getByTestId('tailor-cv');
    expect(cv.textContent).toContain('PROFESSIONAL SUMMARY');
    expect(cv.textContent).toContain('Lloyds Banking Group | London | Jan 2020 – Present');
    expect(cv.textContent).not.toContain('CERTIFICATIONS');

    const diff = screen.getByTestId('tailor-diff');
    const kinds = [...diff.querySelectorAll('li')].map((li) => li.getAttribute('data-diff'));
    expect(kinds).toContain('same');
    expect(kinds).toContain('added');
    expect(kinds).toContain('removed');
    expect(diff.querySelector('[data-diff="added"]')?.className).toContain('bg-teal/10');
    expect(diff.querySelector('[data-diff="removed"]')?.className).toContain('line-through');

    expect(screen.getByTestId('tailor-provenance').textContent).toContain('Ollama · llama3.2:3b');
  });

  it('negative: flags an invented employer in gold, above the CV, and still shows the CV', async () => {
    const { user } = await renderReady([INVENTED]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const fabrication = await screen.findByTestId('tailor-fabrication');
    expect(fabrication.getAttribute('data-clean')).toBe('false');
    expect(fabrication.className).toContain('text-gold');
    expect(fabrication.className).not.toContain('danger');
    expect(fabrication.textContent).toContain('Goldman Sachs');
    expect(fabrication.textContent).toContain('2014');
    expect(screen.getByTestId('tailor-cv').textContent).toContain('Goldman Sachs');
    expect(screen.queryByTestId('tailor-error')).toBeNull();
  });

  it('shows the wait, with the elapsed counter, while the model thinks', async () => {
    let release: (value: Result<ProviderHttpResponse, ProviderError>) => void = () => undefined;
    const pending = new Promise<Result<ProviderHttpResponse, ProviderError>>((resolve) => {
      release = resolve;
    });
    const port = createFakeTailorPort({ cvs: [CV] });
    const user = userEvent.setup();
    render(
      <Tailor
        port={port}
        filePort={createFakeFilePort()}
        createTransport={() => ({
          chat: () => pending,
          listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
        })}
        consentPort={createFakeConsentPort()}
        now={NOW}
      />,
    );
    await screen.findByDisplayValue('CV.docx');
    await vi.waitFor(() =>
      expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).value).toBe(
        'ollama:llama3.2:3b',
      ),
    );
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const progress = await screen.findByTestId('tailor-progress');
    expect(progress.textContent).toContain('llama3.2:3b');
    expect(progress.textContent).toContain('5 to 30 seconds');
    expect(progress.getAttribute('role')).toBe('status');
    expect(screen.getByTestId('tailor-run').textContent).toContain('Tailoring');
    expect(screen.getByTestId('tailor-run-reason').textContent).toContain('Already running');

    release(ok(ollamaEnvelope(FAITHFUL)));
    await screen.findByTestId('tailor-result');
    expect(screen.queryByTestId('tailor-progress')).toBeNull();
  });

  it('negative: a model that cannot be reached is reported, and nothing is rendered as a result', async () => {
    const port = createFakeTailorPort({ cvs: [CV] });
    const user = userEvent.setup();
    render(
      <Tailor
        port={port}
        filePort={createFakeFilePort()}
        createTransport={() => ({
          chat: () =>
            Promise.resolve({
              ok: false,
              error: { provider: 'ollama', kind: 'not-running', message: 'Ollama is not running.' },
            }),
          listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
        })}
        consentPort={createFakeConsentPort()}
        now={NOW}
      />,
    );
    await screen.findByDisplayValue('CV.docx');
    await vi.waitFor(() =>
      expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).value).toBe(
        'ollama:llama3.2:3b',
      ),
    );
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));

    const error = await screen.findByTestId('tailor-error');
    expect(error.textContent).toContain('Ollama is not running.');
    expect(screen.queryByTestId('tailor-result')).toBeNull();
  });
});

describe('the review', () => {
  it('renders the verdict and the issues, and never a rewritten draft', async () => {
    const { user } = await renderReady([FAITHFUL, REVIEW]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    await user.click(screen.getByTestId('tailor-review-run'));

    const review = await screen.findByTestId('tailor-review');
    expect(review.getAttribute('data-verdict')).toBe('revise');
    expect(review.textContent).toContain('send this back');
    const issues = within(review).getAllByTestId('tailor-review-issue');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.textContent).toContain('Summary');
    expect(issues[0]?.textContent).toContain('Name SQL in the first sentence.');
    // The CV on screen is the one the check ran on — untouched by the review.
    expect(screen.getByTestId('tailor-cv').textContent).toContain('cutting run time by 40%');
  });
});

describe('the cover letter (L-161)', () => {
  it('renders the letter with its word count, and its own figure check', async () => {
    const { user } = await renderReady([FAITHFUL, LETTER]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    await user.click(screen.getByTestId('tailor-letter-run'));

    const letter = await screen.findByTestId('tailor-letter');
    expect(letter.textContent).toContain('Dear Hiring Manager,');
    expect(letter.textContent).toContain('cut IFRS 9 model run time by 40%.');
    expect(screen.getByTestId('tailor-letter-words').textContent).toMatch(/\d+ words/);
    // 40% is in the CV: nothing to flag, no note about length.
    expect(screen.queryByTestId('tailor-letter-claims')).toBeNull();
    expect(screen.queryByTestId('tailor-letter-long')).toBeNull();
  });

  it('negative: flags a figure the CV never gave, and warns when the letter runs long', async () => {
    const long = {
      ...LETTER,
      paragraphs: [
        'I grew the book by 250% in a year.',
        ...Array.from({ length: 5 }, () => Array.from({ length: 85 }, () => 'word').join(' ')),
      ],
    };
    const { user } = await renderReady([FAITHFUL, long]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');
    await user.click(screen.getByTestId('tailor-letter-run'));
    await screen.findByTestId('tailor-letter');

    const claims = screen.getByTestId('tailor-letter-claims');
    expect(claims.textContent).toContain('250%');
    expect(claims.className).toContain('text-gold');
    const note = screen.getByTestId('tailor-letter-long');
    expect(note.textContent).toContain('Over 400 words');
    expect(note.className).toContain('text-gold');
  });
});

describe('saving', () => {
  it('saves the CV as a document of kind cv against the chosen application, and the letter too', async () => {
    const { user, port } = await renderReady([FAITHFUL, LETTER]);

    // From a tracked job, so there is an application to save into.
    await user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
    expect((screen.getByTestId('tailor-job-text') as HTMLTextAreaElement).value).toContain(
      'Credit Risk Analyst',
    );
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    const save = screen.getByTestId('tailor-save-application');
    expect(save).toHaveProperty('disabled', false);
    await user.click(save);

    await screen.findByTestId('tailor-save-message');
    expect(port.storedDocuments()).toHaveLength(1);
    expect(port.storedDocuments()[0]).toMatchObject({
      application_id: 'app-1',
      kind: 'cv',
      title: 'Tailored CV — Credit Risk Analyst',
      created_at: NOW.toISOString(),
    });
    expect(port.storedDocuments()[0]?.text).toContain('PROFESSIONAL SUMMARY');

    await user.click(screen.getByTestId('tailor-letter-run'));
    await screen.findByTestId('tailor-letter');
    await user.click(screen.getByTestId('tailor-save-application'));
    await vi.waitFor(() => expect(port.storedDocuments()).toHaveLength(3));
    expect(
      port
        .storedDocuments()
        .map((document) => document.kind)
        .sort(),
    ).toEqual(['cover_letter', 'cv', 'cv']);
    expect(port.storedDocuments().find((document) => document.kind === 'cover_letter')?.title).toBe(
      'Cover letter — Credit Risk Analyst',
    );
  });

  it('boundary: a pasted advert has no application to save into, and says so — disabled, never hidden', async () => {
    const { user } = await renderReady([FAITHFUL]);

    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    expect(screen.getByTestId('tailor-save-application')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('tailor-save-application-reason').textContent).toContain(
      'tracked job',
    );
  });

  it('negative: a failed save is reported and the draft stays on screen', async () => {
    const { user, port } = await renderReady([FAITHFUL]);
    await user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    port.failNext('saveDocument');
    await user.click(screen.getByTestId('tailor-save-application'));

    const error = await screen.findByTestId('tailor-error');
    expect(error.textContent).toContain('could not be saved');
    expect(screen.getByTestId('tailor-cv')).toBeTruthy();
    expect(port.storedDocuments()).toHaveLength(0);
  });

  it('saves the CV as a .txt file through the file port, and reports where', async () => {
    const { user, filePort } = await renderReady([FAITHFUL]);
    await user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    filePort.nextSavePath('C:\\Users\\steve\\Documents\\Tailored CV.txt');
    await user.click(screen.getByTestId('tailor-save-text'));

    const message = await screen.findByTestId('tailor-save-message');
    expect(message.textContent).toContain('Tailored CV.txt');
    expect(filePort.writtenText()).toHaveLength(1);
    expect(filePort.writtenText()[0]?.extension).toBe('txt');
    expect(filePort.writtenText()[0]?.contents).toContain('PROFESSIONAL SUMMARY');
  });

  it('boundary: cancelling the save dialog says nothing', async () => {
    const { user, filePort } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    filePort.nextSavePath(null);
    await user.click(screen.getByTestId('tailor-save-text'));

    expect(filePort.calls.saveText).toBe(1);
    expect(screen.queryByTestId('tailor-save-message')).toBeNull();
    expect(screen.queryByTestId('tailor-error')).toBeNull();
  });
});

describe('saving as a Word document (L-165)', () => {
  /** `PK\x03\x04`: the signature every zip — and so every .docx — opens with. */
  const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

  it('builds the CV into .docx bytes, hands them to the file port under a .docx name, and reports where', async () => {
    const { user, filePort } = await renderReady([FAITHFUL]);
    await user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    filePort.nextSavePath('C:\\Users\\steve\\Documents\\Tailored CV.docx');
    await user.click(screen.getByTestId('tailor-save-docx-cv'));

    const message = await screen.findByTestId('tailor-save-message');
    expect(message.textContent).toContain('Tailored CV.docx');
    expect(filePort.writtenBytes()).toHaveLength(1);
    const written = filePort.writtenBytes()[0];
    expect(written?.extension).toBe('docx');
    expect(written?.suggestedName).toBe('Tailored CV — Credit Risk Analyst.docx');
    expect([...(written?.bytes.subarray(0, 4) ?? [])]).toEqual(ZIP_SIGNATURE);
    // The Word save is its own path: nothing went out as text.
    expect(filePort.writtenText()).toHaveLength(0);
  });

  it('builds the letter into .docx bytes under its own name', async () => {
    const { user, filePort } = await renderReady([FAITHFUL, LETTER]);
    await user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');
    await user.click(screen.getByTestId('tailor-letter-run'));
    await screen.findByTestId('tailor-letter');

    filePort.nextSavePath('C:\\Users\\steve\\Documents\\Cover letter.docx');
    await user.click(screen.getByTestId('tailor-save-docx-letter'));

    await screen.findByTestId('tailor-save-message');
    const written = filePort.writtenBytes()[0];
    expect(written?.suggestedName).toBe('Cover letter — Credit Risk Analyst.docx');
    expect([...(written?.bytes.subarray(0, 4) ?? [])]).toEqual(ZIP_SIGNATURE);
  });

  it('boundary: cancelling the save dialog says nothing', async () => {
    const { user, filePort } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    filePort.nextSavePath(null);
    await user.click(screen.getByTestId('tailor-save-docx-cv'));

    await vi.waitFor(() => expect(filePort.calls.saveBytes).toBe(1));
    expect(screen.queryByTestId('tailor-save-message')).toBeNull();
    expect(screen.queryByTestId('tailor-error')).toBeNull();
  });

  it('negative: a refused write is reported and the draft stays on screen', async () => {
    const { user, filePort } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    filePort.failSave('Windows would not let CViper write there.');
    await user.click(screen.getByTestId('tailor-save-docx-cv'));

    const error = await screen.findByTestId('tailor-error');
    expect(error.textContent).toContain('Windows would not let CViper write there.');
    expect(screen.getByTestId('tailor-cv')).toBeTruthy();
    expect(filePort.writtenBytes()).toHaveLength(0);
  });
});
