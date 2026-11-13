// @vitest-environment jsdom
/**
 * L-346, driven the way a user drives it: a local model answers with a canned
 * tailored CV, the user presses a Save CV button, checks their details in the
 * dialog, and the file they get has them at the top.
 *
 * The real pipeline, the real exports and the real ATS checks run; only the
 * model and the disk are fakes. Every saved file is READ BACK with the app's
 * own readers, so the assertions are about the bytes a user would send.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ok,
  renderTailoredCv,
  type Application,
  type Cv,
  type Job,
  type Result,
} from '@cviper/core-types';
import {
  extractDocxText,
  extractPdfText,
  resetPdfJs,
  setPdfJsLoader,
  type PdfJsLike,
} from '@cviper/cv-parsing';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { openMoreFormats } from './test/moreFormats';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { Tailor } = await import('./Tailor');
const { createJobSessions } = await import('./jobSessions');
const { hydrateJobSessions, toRow } = await import('./persistence');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

const NOW = new Date('2026-11-06T09:00:00.000Z');

const BODY = `Senior Credit Risk Analyst, Lloyds Banking Group, London, Jan 2020 – Present
- Built IFRS 9 impairment models in Python, cutting run time by 40%.
Analyst, Barclays, 2016 – 2019
- Ran stress tests.
BSc Mathematics, University of Leeds, 2016`;

const JANE_TEXT = `Jane Smith | jane@x.com | 07700 900 123\n${BODY}`;
const JANE = { name: 'Jane Smith', email: 'jane@x.com', phone: '07700 900 123' };

const CV: Cv = {
  id: 'cv-1',
  name: 'CV.docx',
  file_path: null,
  extracted_text: JANE_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const OTHER_CV: Cv = {
  ...CV,
  id: 'cv-2',
  name: 'Other CV.docx',
  extracted_text: `Jamie Lewis\njamie@example.com\n+44 7700 900456\n${BODY}`,
  created_at: '2026-08-02T09:00:00.000Z',
};

const JOB: Job = {
  id: 'job-1',
  source: 'manual',
  external_id: null,
  title: 'Credit Risk Analyst',
  company: 'Lloyds',
  agency: null,
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
  ],
  education: ['BSc Mathematics, University of Leeds, 2016'],
  certifications: [],
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
  sign_off: 'Yours sincerely,\nJane Smith',
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

/**
 * Answers each chat from one queue shared by every run (each run builds its
 * own transport), and keeps every request body it was sent.
 */
function recordingTransport(queue: unknown[], sent: string[]): ChatTransport {
  return {
    chat(_provider, body): Promise<Result<ProviderHttpResponse, ProviderError>> {
      sent.push(body);
      const next = queue.shift();
      if (next === undefined) throw new Error('the transport was asked more than the test allows');
      return Promise.resolve(ok(ollamaEnvelope(next)));
    },
    listModels: () => Promise.resolve(ok({ status: 200, body: TAGS })),
  };
}

const loadLegacyBuild = async (): Promise<PdfJsLike> =>
  (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsLike;

beforeAll(() => {
  setPdfJsLoader(loadLegacyBuild);
});

beforeEach(() => {
  resetPdfJs();
  setPdfJsLoader(loadLegacyBuild);
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

async function renderReady(
  replies: readonly unknown[],
  options: {
    cvs?: readonly Cv[];
    sessions?: ReturnType<typeof createJobSessions>;
  } = {},
) {
  const port = createFakeTailorPort({
    cvs: options.cvs ?? [CV],
    jobs: [JOB],
    applications: [APPLICATION],
  });
  const filePort = createFakeFilePort();
  const sessions = options.sessions ?? createJobSessions();
  const sent: string[] = [];
  const queue = [...replies];
  const user = userEvent.setup();

  render(
    <Tailor
      port={port}
      filePort={filePort}
      createTransport={() => recordingTransport(queue, sent)}
      consentPort={createFakeConsentPort()}
      jobSessions={sessions}
      now={NOW}
    />,
  );

  await screen.findByTestId('tailor-cv-pick');
  await vi.waitFor(() =>
    expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).value).toBe(
      'ollama:llama3.2:3b',
    ),
  );
  return { port, filePort, sessions, sent, user };
}

async function tailored(replies: readonly unknown[] = [FAITHFUL], cvs?: readonly Cv[]) {
  const ready = await renderReady(replies, cvs === undefined ? {} : { cvs });
  await ready.user.selectOptions(screen.getByTestId('tailor-job-pick'), 'job-1');
  await ready.user.click(screen.getByTestId('tailor-run'));
  await screen.findByTestId('tailor-result');
  return ready;
}

function field(name: 'name' | 'email' | 'phone'): HTMLInputElement {
  return screen.getByTestId(`tailor-contact-${name}`) as HTMLInputElement;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const read = await extractPdfText(bytes);
  if (!read.ok) throw new Error(read.error.message);
  return read.value.text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const read = await extractDocxText(bytes);
  if (!read.ok) throw new Error(read.error.message);
  return read.value.text;
}

describe('the first Save CV asks for the details (happy)', () => {
  it('opens "Check your details" with what the CV says, in the approved words', async () => {
    const { user, filePort } = await tailored();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('data-testid')).toBe('tailor-contact-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Check your details');
    expect(dialog.textContent).toContain(
      "These go at the top of your CV. We read them from the CV you uploaded, so please change anything that isn't right.",
    );
    expect(field('name').value).toBe(JANE.name);
    expect(field('email').value).toBe(JANE.email);
    expect(field('phone').value).toBe(JANE.phone);
    expect(screen.getByTestId('tailor-contact-confirm').textContent).toBe(
      'Save with these details',
    );
    expect(screen.getByTestId('tailor-contact-cancel').textContent).toBe('Not now');
    // Nothing is saved until the user confirms.
    expect(filePort.calls.saveText).toBe(0);
  });

  it('one confirm saves the text with the details, and the next save does not ask again', async () => {
    const { user, filePort } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.txt');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));

    await screen.findByTestId('tailor-save-message');
    const written = filePort.writtenText()[0]?.contents ?? '';
    expect(written.split('\n').slice(0, 3)).toEqual([
      'Jane Smith',
      'jane@x.com | 07700 900 123',
      '',
    ]);
    expect(screen.getByTestId('tailor-contact-line').textContent).toContain(
      'At the top of this CV: Jane Smith | jane@x.com | 07700 900 123',
    );

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.docx');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-docx-cv'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(1));
    expect(screen.queryByTestId('tailor-contact-dialog')).toBeNull();
  });
});

describe('E2E: the files a user gets', () => {
  it('edited details are what the PDF and the Word file say, read back', async () => {
    const { user, filePort } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.pdf');
    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('name'));
    await user.type(field('name'), 'Jane Q Smith');
    await user.clear(field('phone'));
    await user.type(field('phone'), '+44 7700 900 999');
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(1));

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.docx');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-docx-cv'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(2));

    const [pdf, word] = filePort.writtenBytes();
    const fromPdf = await pdfText(pdf?.bytes ?? new Uint8Array());
    expect(fromPdf.startsWith('Jane Q Smith\njane@x.com | +44 7700 900 999')).toBe(true);
    const fromWord = (await docxText(word?.bytes ?? new Uint8Array()))
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(fromWord.slice(0, 2)).toEqual(['Jane Q Smith', 'jane@x.com | +44 7700 900 999']);
  });

  it('the ATS contact row turns to pass once the details will be saved', async () => {
    const { user } = await tailored();

    expect(screen.getByTestId('tailor-ats-check-contact_info').getAttribute('data-after')).toBe(
      'warn',
    );
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));

    await vi.waitFor(() =>
      expect(screen.getByTestId('tailor-ats-check-contact_info').getAttribute('data-after')).toBe(
        'pass',
      ),
    );
  });

  it('the details are restored after a restart, and saving does not ask again', async () => {
    const first = await tailored();
    await openMoreFormats(first.user);
    await first.user.click(screen.getByTestId('tailor-save-text'));
    await first.user.click(await screen.findByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-contact-line');

    // The app closes. What survives is the job's row, read back at launch.
    const row = toRow('job-1', first.sessions.session('job-1'), NOW.toISOString());
    cleanup();
    const restarted = createJobSessions();
    await hydrateJobSessions(restarted, {
      load: async () => ok([row]),
      save: async () => ok(undefined),
      readLastJob: async () => 'job-1',
      writeLastJob: async () => undefined,
    });

    const again = await renderReady([], { sessions: restarted });
    expect((await screen.findByTestId('tailor-contact-line')).textContent).toContain(
      'Jane Smith | jane@x.com | 07700 900 123',
    );
    again.filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.txt');
    await openMoreFormats(again.user);
    await again.user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-save-message');
    expect(screen.queryByTestId('tailor-contact-dialog')).toBeNull();
    expect(again.filePort.writtenText()[0]?.contents.startsWith('Jane Smith\n')).toBe(true);
  });

  it('switching CV asks again, with the other CV’s details', async () => {
    const { user } = await tailored([FAITHFUL, FAITHFUL], [CV, OTHER_CV]);
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-contact-line');

    await user.selectOptions(screen.getByTestId('tailor-cv-pick'), 'cv-2');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');
    expect(screen.queryByTestId('tailor-contact-line')).toBeNull();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(field('name').value).toBe('Jamie Lewis');
    expect(field('email').value).toBe('jamie@example.com');
    expect(field('phone').value).toBe('+44 7700 900456');
  });
});

/**
 * L-400: the tailored CV on screen is drawn from the same blocks as the files,
 * with the name and line from the same helper. So what the page shows at the
 * top is, line for line, what the saved file says — and before the user has
 * confirmed anything, neither has a name.
 */
describe('the page on screen and the saved file agree (L-400)', () => {
  /** The name and contact line drawn at the top of the page, if any. */
  function pageTop(): string[] {
    const sheet = screen.getByTestId('tailor-cv');
    const first = [...sheet.querySelectorAll('[data-block]')];
    const heading = first.findIndex((element) => element.getAttribute('data-block') === 'heading');
    // No heading means the page drew no blocks at all: that is not "no name".
    if (heading === -1) throw new Error('the page drew no section heading');
    return first.slice(0, heading).map((element) => element.textContent ?? '');
  }

  it('negative: before the details are confirmed, the page has no name and no contact line', async () => {
    const { user } = await tailored();
    expect(pageTop()).toEqual([]);

    // Asking is not confirming: "Not now" leaves the page as it was.
    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(pageTop()).toEqual([]);
    await user.click(screen.getByTestId('tailor-contact-cancel'));
    expect(pageTop()).toEqual([]);
  });

  it('same input, same top: edited details with spaces and a cleared field, on the page and in the Word file', async () => {
    const { user, filePort } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.docx');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-docx-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('name'));
    await user.type(field('name'), '  Jane Q Smith  ');
    await user.clear(field('email'));
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(1));

    const fromWord = (await docxText(filePort.writtenBytes()[0]?.bytes ?? new Uint8Array()))
      .split('\n')
      .filter((line) => line.trim() !== '');
    expect(pageTop()).toEqual(['Jane Q Smith', '07700 900 123']);
    expect(fromWord.slice(0, 2)).toEqual(pageTop());
  });

  it('boundary: every field cleared — no name and no line, on the page and in the PDF', async () => {
    const { user, filePort } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.pdf');
    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('name'));
    await user.clear(field('email'));
    await user.clear(field('phone'));
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(1));

    expect(pageTop()).toEqual([]);
    const fromPdf = await pdfText(filePort.writtenBytes()[0]?.bytes ?? new Uint8Array());
    expect(fromPdf.startsWith('PROFESSIONAL SUMMARY')).toBe(true);
  });
});

describe('what "Not now", a cleared field and all blank do', () => {
  it('negative: "Not now" saves no file and keeps no details — the next save asks again', async () => {
    const { user, filePort, sessions } = await tailored();

    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await user.click(await screen.findByTestId('tailor-contact-cancel'));

    expect(screen.queryByTestId('tailor-contact-dialog')).toBeNull();
    expect(filePort.calls.saveBytes).toBe(0);
    expect(sessions.session('job-1').contact).toEqual({});
    expect(screen.queryByTestId('tailor-contact-line')).toBeNull();

    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    expect(await screen.findByTestId('tailor-contact-dialog')).toBeTruthy();
  });

  it('negative: Escape is "Not now"', async () => {
    const { user, filePort } = await tailored();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.keyboard('{Escape}');

    expect(screen.queryByTestId('tailor-contact-dialog')).toBeNull();
    expect(filePort.calls.saveText).toBe(0);
  });

  it('focus starts in the first field and Tab stays inside the dialog', async () => {
    const { user } = await tailored();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(document.activeElement).toBe(field('name'));
    for (let press = 0; press < 8; press += 1) await user.tab();
    expect(screen.getByTestId('tailor-contact-dialog').contains(document.activeElement)).toBe(true);
  });

  it('edge: a cleared field is left out with no stray bar, and stays cleared on Change', async () => {
    const { user, filePort } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.txt');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('email'));
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-save-message');

    const written = filePort.writtenText()[0]?.contents ?? '';
    expect(written.split('\n').slice(0, 2)).toEqual(['Jane Smith', '07700 900 123']);
    expect(written).not.toContain('jane@x.com');
    expect(screen.getByTestId('tailor-contact-line').textContent).toContain(
      'Jane Smith | 07700 900 123',
    );

    await user.click(screen.getByTestId('tailor-contact-change'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(field('email').value).toBe('');
    expect(field('name').value).toBe('Jane Smith');
  });

  it('boundary: all blank gives today’s file, byte for byte', async () => {
    const { user, filePort, sessions } = await tailored();

    filePort.nextSavePath('C:\\Users\\jane\\Documents\\Tailored CV.txt');
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('name'));
    await user.clear(field('email'));
    await user.clear(field('phone'));
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-save-message');

    const result = sessions.session('job-1').result;
    expect(filePort.writtenText()[0]?.contents).toBe(result?.text);
    expect(filePort.writtenText()[0]?.contents).toBe(renderTailoredCv(FAITHFUL, null));
  });

  it('Change updates what is used without saving a file', async () => {
    const { user, filePort } = await tailored();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-contact-line');
    const savesBefore = filePort.calls.saveText;

    await user.click(screen.getByTestId('tailor-contact-change'));
    await user.clear(field('name'));
    await user.type(field('name'), 'Jane Doe');
    await user.click(screen.getByTestId('tailor-contact-confirm'));

    expect(screen.getByTestId('tailor-contact-line').textContent).toContain('Jane Doe');
    expect(filePort.calls.saveText).toBe(savesBefore);
  });

  it('a field the CV did not have says so, in the approved words', async () => {
    const noPhone: Cv = { ...CV, extracted_text: `Jane Smith\njane@x.com\n${BODY}` };
    const { user } = await tailored([FAITHFUL], [noPhone]);

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');

    expect(screen.getByTestId('tailor-contact-phone-missing').textContent).toBe(
      "We couldn't find this in your CV. Add it here, or leave it empty.",
    );
    expect(screen.queryByTestId('tailor-contact-name-missing')).toBeNull();
    expect(field('phone').value).toBe('');
  });
});

describe('a name the PDF cannot draw (edge)', () => {
  it.each([
    ['Cyrillic', 'Иван Петров'],
    ['CJK', '王伟'],
    ['Vietnamese', 'Nguyễn Văn An'],
  ])('%s: the dialog warns and suggests Word, and the PDF still saves', async (_label, name) => {
    const cv: Cv = { ...CV, extracted_text: `${name}\nivan@example.com\n${BODY}` };
    const { user, filePort } = await tailored([FAITHFUL], [cv]);

    filePort.nextSavePath('C:\\Users\\me\\Documents\\Tailored CV.pdf');
    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(field('name').value).toBe(name);
    expect(screen.getByTestId('tailor-contact-pdf-warning').textContent).toBe(
      "A PDF can't show some letters in your details, so they would appear as ?. Save as Word to keep them exactly.",
    );

    // Not blocked.
    expect(screen.getByTestId('tailor-contact-confirm')).toHaveProperty('disabled', false);
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    await vi.waitFor(() => expect(filePort.writtenBytes()).toHaveLength(1));
  });

  it('negative: plain Latin details show no warning', async () => {
    const { user } = await tailored();
    await user.click(screen.getByTestId('tailor-save-pdf-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(screen.queryByTestId('tailor-contact-pdf-warning')).toBeNull();
  });

  it('negative: a Word save shows no PDF warning, whatever the letters', async () => {
    const cv: Cv = { ...CV, extracted_text: `Иван Петров\nivan@example.com\n${BODY}` };
    const { user } = await tailored([FAITHFUL], [cv]);
    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-docx-cv'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(field('name').value).toBe('Иван Петров');
    expect(screen.queryByTestId('tailor-contact-pdf-warning')).toBeNull();
  });
});

describe('the details never borrow another CV’s (negative)', () => {
  it('a draft whose CV was deleted offers blank fields, not the newest CV’s', async () => {
    const sessions = createJobSessions();
    const text = renderTailoredCv(FAITHFUL, null);
    sessions.open('job-1', () => ({
      advert: JOB.description ?? '',
      cvId: 'cv-gone',
      result: {
        cv: FAITHFUL,
        cvId: 'cv-gone',
        text,
        report: { clean: true, flagged: [] },
        provider: 'ollama',
        model: 'llama3.2:3b',
        retried: false,
        userMetrics: [],
      },
    }));
    const { user } = await renderReady([], { cvs: [OTHER_CV], sessions });
    await screen.findByTestId('tailor-result');

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    expect(field('name').value).toBe('');
    expect(field('email').value).toBe('');
    expect(field('phone').value).toBe('');
  });

  it('edge: a pasted advert asks once, then remembers for as long as the app runs', async () => {
    const { user, filePort, sessions } = await renderReady([FAITHFUL]);
    await user.type(screen.getByTestId('tailor-job-text'), JOB.description ?? '');
    await user.click(screen.getByTestId('tailor-run'));
    await screen.findByTestId('tailor-result');

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));
    await vi.waitFor(() => expect(filePort.calls.saveText).toBe(1));
    expect(sessions.session(null).contact).toEqual({ 'cv-1': JANE });

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await vi.waitFor(() => expect(filePort.calls.saveText).toBe(2));
    expect(screen.queryByTestId('tailor-contact-dialog')).toBeNull();
  });
});

describe('regression: what goes to the AI, and what the draft is, do not change', () => {
  const MARKER = 'Zebedee Quillfeather';

  it('a typed name is in no request body: not the review, the letter or a re-run', async () => {
    const { user, sent, sessions } = await tailored([FAITHFUL, REVIEW, LETTER, FAITHFUL]);
    const before = sessions.session('job-1').result;

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await screen.findByTestId('tailor-contact-dialog');
    await user.clear(field('name'));
    await user.type(field('name'), MARKER);
    await user.click(screen.getByTestId('tailor-contact-confirm'));
    // The marker is in the system: it is what a saved CV would carry.
    expect((await screen.findByTestId('tailor-contact-line')).textContent).toContain(MARKER);

    // The draft the AI paths read is the one the model wrote, untouched.
    const after = sessions.session('job-1').result;
    expect(after?.text).toBe(before?.text);
    expect(after?.text).not.toContain(MARKER);
    expect(after?.report).toEqual(before?.report);

    await user.click(screen.getByTestId('tailor-review-run'));
    await screen.findByTestId('tailor-review');
    await user.click(screen.getByTestId('tailor-letter-run'));
    await screen.findByTestId('tailor-letter');
    await user.click(screen.getByTestId('tailor-run'));
    await vi.waitFor(() => expect(sent).toHaveLength(4));

    for (const body of sent) expect(body).not.toContain(MARKER);
  });

  it('"Save to an application" keeps the draft without the details', async () => {
    const { user, port } = await tailored();

    await openMoreFormats(user);
    await user.click(screen.getByTestId('tailor-save-text'));
    await user.click(await screen.findByTestId('tailor-contact-confirm'));
    await screen.findByTestId('tailor-contact-line');
    await user.click(screen.getByTestId('tailor-save-application'));

    await vi.waitFor(() => expect(port.storedDocuments()).toHaveLength(1));
    expect(port.storedDocuments()[0]?.text).toBe(renderTailoredCv(FAITHFUL, null));
  });
});

describe('a job whose CV was deleted on Profile (L-408)', () => {
  // `'cv-gone'`: deleted while the app runs, so Tailor still remembers the id.
  // `null`: the next start, when the database has cleared `job_workflow.cv_id`
  // (`ON DELETE SET NULL`, proved in `db/cvDelete.sqlite.test.ts`).
  it.each([['cv-gone'], [null]])(
    'still opens with its advert and draft, on the newest CV that is left (remembered: %s)',
    async (remembered) => {
      const sessions = createJobSessions();
      sessions.open('job-1', () => ({
        advert: JOB.description ?? '',
        cvId: remembered,
        result: {
          cv: FAITHFUL,
          cvId: remembered,
          text: renderTailoredCv(FAITHFUL, null),
          report: { clean: true, flagged: [] },
          provider: 'ollama',
          model: 'llama3.2:3b',
          retried: false,
          userMetrics: [],
        },
      }));

      // Newest first, as the store lists them.
      await renderReady([], { cvs: [OTHER_CV, CV], sessions });

      await screen.findByTestId('tailor-result');
      const picker = screen.getByTestId<HTMLSelectElement>('tailor-cv-pick');
      expect(picker.value).toBe('cv-2');
      expect([...picker.options].map((option) => option.value)).toEqual(['cv-2', 'cv-1']);
      expect(screen.getByTestId<HTMLTextAreaElement>('tailor-job-text').value).toBe(
        JOB.description ?? '',
      );
    },
  );
});
