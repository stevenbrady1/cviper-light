// @vitest-environment jsdom
/**
 * The analysis view, driven the way a user drives it.
 *
 * ============================================================================
 * WHY `@cviper/cv-parsing` IS MOCKED AND `@cviper/keyword-scoring` IS NOT
 * ============================================================================
 * The parser needs pdf.js, which needs a worker and a real PDF; it has its own
 * exhaustive tests over generated fixtures, including scans, corrupt files and
 * password-protected ones. What is being tested HERE is that the view hands it
 * the right bytes and then renders exactly what it said — including the
 * warnings, which is the case that matters most.
 *
 * The scorer, by contrast, is a pure synchronous function over two strings, so
 * the real one runs. Every score in this file is a real score.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv, type Job } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

const parsing = vi.hoisted(() => ({
  extractText: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { Analysis } = await import('./Analysis');
const { createFakeAnalysisPort } = await import('./test/fakePort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');

type FakeAnalysisPort = ReturnType<typeof createFakeAnalysisPort>;
type FakeFilePort = ReturnType<typeof createFakeFilePort>;

const NOW = new Date('2026-08-19T09:00:00.000Z');

const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting.';

const ADVERT =
  'Credit Risk Analyst. You will build SQL models, run stress tests and report on ' +
  'IFRS 9 impairment to the CRO. Python experience essential.';

const EXISTING_CV: Cv = {
  id: 'cv-1',
  name: 'Steven Brady CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\CV.pdf',
  extracted_text: CV_TEXT,
  created_at: '2026-08-01T09:00:00.000Z',
};

const TRACKED_JOB: Job = {
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
  description: 'You will build SQL models and report on IFRS 9 impairment.',
  url: null,
  posted_date: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

/** A machine with nothing set up: no daemon, not one saved credential. */
function nothingConfigured(): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  parsing.extractText.mockReset();
  nothingConfigured();
});

afterEach(() => {
  cleanup();
});

/**
 * Render and wait for the first load to settle.
 *
 * The fakes are returned with their CONCRETE types, not as `AnalysisPort` and
 * `FilePort` — the whole value of a fake is the inspection surface
 * (`storedCvs`, `failNext`, `nextCv`), and widening it to the interface would
 * hide exactly the part the tests assert on.
 */
async function renderView(
  overrides: { port?: FakeAnalysisPort; filePort?: FakeFilePort } = {},
): Promise<{ port: FakeAnalysisPort; filePort: FakeFilePort }> {
  const port = overrides.port ?? createFakeAnalysisPort();
  const filePort = overrides.filePort ?? createFakeFilePort();

  render(<Analysis port={port} filePort={filePort} now={NOW} />);
  await screen.findByTestId('view-analysis');
  // The availability read is three IPC promises; let them settle so no
  // assertion races the first paint.
  await vi.waitFor(() => expect(screen.getByTestId('analysis-provider')).toBeTruthy());

  return { port, filePort };
}

describe('the empty screen', () => {
  it('says nothing has been checked and offers the basic match', async () => {
    await renderView();

    expect(screen.getByTestId('analysis-empty').textContent).toContain('no API key');
    const picker = screen.getByTestId('analysis-provider') as HTMLSelectElement;
    expect(picker.options).toHaveLength(1);
    expect(picker.value).toBe('keyword');
  });

  it('has exactly one primary button, and it explains why it cannot be pressed', async () => {
    await renderView();

    const primaries = document.querySelectorAll('[data-primary="true"]');
    expect(primaries).toHaveLength(1);
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('analysis-run-reason').textContent).toBe('Choose a CV first.');
  });
});

describe('the run button explains its own disabled state', () => {
  it('asks for the advert once a CV is chosen', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await vi.waitFor(() =>
      expect(screen.getByTestId('analysis-run-reason').textContent).toBe('Paste the job advert.'),
    );
  });

  it('boundary: asks for more advert when what is there is too short', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), 'Analyst');

    expect(screen.getByTestId('analysis-run-reason').textContent).toContain('more of the advert');
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
  });

  it('becomes pressable, with no reason shown, once both are there', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);

    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', false);
    expect(screen.queryByTestId('analysis-run-reason')).toBeNull();
  });

  it('a CV whose text could not be read says what to upload instead', async () => {
    await renderView({
      port: createFakeAnalysisPort({ cvs: [{ ...EXISTING_CV, extracted_text: null }] }),
    });

    await vi.waitFor(() =>
      expect(screen.getByTestId('analysis-run-reason').textContent).toContain('no readable text'),
    );
    expect(screen.getByTestId('analysis-run-reason').textContent).toContain('.docx');
  });
});

describe('uploading a CV', () => {
  it('reads the file, stores it, and selects it', async () => {
    const user = userEvent.setup();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const { port, filePort } = await renderView();

    filePort.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: 2, warnings: [] }));

    await user.click(screen.getByTestId('analysis-upload'));

    // The wiring that matters: the bytes off the disk reach the parser
    // untouched, under the file's own name.
    await vi.waitFor(() => expect(parsing.extractText).toHaveBeenCalledWith('New CV.docx', bytes));
    await vi.waitFor(() => expect(port.storedCvs()).toHaveLength(1));

    expect(port.storedCvs()[0]?.name).toBe('New CV.docx');
    expect(port.storedCvs()[0]?.extracted_text).toBe(CV_TEXT);
    expect(port.storedCvs()[0]?.file_path).toBe('C:\\New CV.docx');
    expect(await screen.findByDisplayValue('New CV.docx')).toBeTruthy();
  });

  it('surfaces a scan in the parser\u2019s own words, and stores nothing', async () => {
    // The commonest real failure in CV upload, and the single most useful thing
    // this screen can tell anyone. It must NOT become "upload failed", and it
    // must not leave a CV row full of nothing behind.
    const user = userEvent.setup();
    const { port, filePort } = await renderView();

    filePort.nextCv({ name: 'Scan.pdf', path: 'C:\\Scan.pdf', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(
      err({
        code: 'NO_TEXT_LAYER',
        message:
          'That PDF has 2 pages but no readable text at all, which means it is almost ' +
          'certainly a scan or a photo of a CV rather than a text document.',
        detail: null,
        pageCount: 2,
      }),
    );

    await user.click(screen.getByTestId('analysis-upload'));

    const problem = await screen.findByTestId('analysis-upload-problem');
    expect(problem.textContent).toContain('almost certainly a scan');
    expect(port.storedCvs()).toEqual([]);
    // And the run button still says the truthful thing.
    expect(screen.getByTestId('analysis-run-reason').textContent).toBe('Choose a CV first.');
  });

  it('shows the warnings when only SOME pages were images', async () => {
    // This one SUCCEEDS — there is usable text — so the analysis will run on a
    // partial CV. Saying so is the difference between a low score the user can
    // explain and a low score that makes no sense.
    const user = userEvent.setup();
    const { port, filePort } = await renderView();

    filePort.nextCv({ name: 'Half scan.pdf', path: 'C:\\Half.pdf', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(
      ok({
        text: CV_TEXT,
        pageCount: 3,
        warnings: [
          '1 of the 3 pages have no readable text — those pages look like scanned images.',
        ],
      }),
    );

    await user.click(screen.getByTestId('analysis-upload'));

    const warnings = await screen.findByTestId('analysis-cv-warnings');
    expect(warnings.textContent).toContain('no readable text');
    expect(port.storedCvs()).toHaveLength(1);
  });

  it('says nothing at all when the user cancels the dialog', async () => {
    const user = userEvent.setup();
    const { port, filePort } = await renderView();

    filePort.nextCv(null);
    await user.click(screen.getByTestId('analysis-upload'));

    await vi.waitFor(() => expect(filePort.calls.pickCv).toBe(1));
    expect(parsing.extractText).not.toHaveBeenCalled();
    expect(port.storedCvs()).toEqual([]);
    expect(screen.queryAllByRole('alert')).toEqual([]);
  });

  it('negative: reports a refusal from the file layer', async () => {
    const user = userEvent.setup();
    const { filePort } = await renderView();

    filePort.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');
    await user.click(screen.getByTestId('analysis-upload'));

    expect((await screen.findByTestId('analysis-upload-problem')).textContent).toContain(
      'cannot read that kind of file',
    );
  });

  it('negative: reports a CV that parsed but could not be saved', async () => {
    const user = userEvent.setup();
    const { port, filePort } = await renderView();

    port.failNext('saveCv');
    filePort.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));

    await user.click(screen.getByTestId('analysis-upload'));

    expect((await screen.findByTestId('analysis-error')).textContent).toContain(
      'could not be saved',
    );
  });
});

describe('running the basic match', () => {
  it('scores the CV, renders the result, and writes it to history', async () => {
    const user = userEvent.setup();
    const { port } = await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));

    const result = await screen.findByTestId('analysis-result');
    expect(within(result).getByTestId('analysis-provenance').dataset['provider']).toBe('keyword');

    const score = Number(screen.getByTestId('band-scale-score').textContent);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);

    await vi.waitFor(() => expect(port.storedAnalyses()).toHaveLength(1));
    expect(port.storedAnalyses()[0]?.provider).toBe('keyword');
    expect(port.storedAnalyses()[0]?.match_score).toBe(score);
    expect(port.storedAnalyses()[0]?.created_at).toBe(NOW.toISOString());
  });

  it('shows no progress banner, because there is nothing to wait for', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));

    await screen.findByTestId('analysis-result');
    expect(screen.queryByTestId('analysis-progress')).toBeNull();
  });

  it('negative: keeps the result on screen when history could not be written', async () => {
    // The result is real and the user is reading it. Throwing it away because a
    // write failed would be a second failure on top of the first.
    const user = userEvent.setup();
    const { port } = await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    port.failNext('saveAnalysis');
    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));

    expect(await screen.findByTestId('analysis-result')).toBeTruthy();
    expect((await screen.findByTestId('analysis-error')).textContent).toContain('history');
  });
});

describe('a tracked job', () => {
  it('fills the advert box from a job already on the board', async () => {
    const user = userEvent.setup();
    await renderView({
      port: createFakeAnalysisPort({ cvs: [EXISTING_CV], jobs: [TRACKED_JOB] }),
    });

    await user.selectOptions(await screen.findByTestId('analysis-job-pick'), 'job-1');

    const advert = screen.getByTestId('analysis-job-text') as HTMLTextAreaElement;
    expect(advert.value).toContain('Credit Risk Analyst');
    expect(advert.value).toContain('Lloyds');
    expect(advert.value).toContain('IFRS 9 impairment');
  });

  it('is absent entirely when nothing is being tracked', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    expect(screen.queryByTestId('analysis-job-pick')).toBeNull();
  });
});

describe('history', () => {
  it('lists past checks for the chosen CV, newest first', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    await user.click(screen.getByTestId('analysis-history-open'));

    const rows = within(await screen.findByTestId('analysis-history')).getAllByTestId(
      'analysis-history-row',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Basic match');
    expect(rows[0]?.textContent).toContain('2026-08-19');
  });

  it('boundary: a CV with no past checks says so rather than showing an empty box', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Steven Brady CV.pdf');
    await user.click(screen.getByTestId('analysis-history-open'));

    expect((await screen.findByTestId('analysis-history-empty')).textContent).toContain(
      'not been checked',
    );
  });
});

describe('when the database will not open', () => {
  it('says so instead of showing an empty CV list', async () => {
    const port = createFakeAnalysisPort();
    port.failNext('loadCvs');

    await renderView({ port });

    expect((await screen.findByTestId('analysis-error')).textContent).toContain(
      'still on this machine',
    );
  });
});

describe('when Ollama is running but has nothing that can chat', () => {
  /** A daemon whose only pulled model is an embedder. */
  function embedderOnly(): void {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') {
        return JSON.stringify({
          models: [
            {
              model: 'nomic-embed-text:latest',
              name: 'nomic-embed-text:latest',
              details: { family: 'nomic-bert' },
            },
          ],
        });
      }
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });
  }

  it('names the command that fixes it, rather than showing an empty picker', async () => {
    embedderOnly();
    await renderView();

    const hint = await screen.findByTestId('analysis-ollama-hint');
    expect(hint.textContent).toContain('ollama pull llama3.2');

    // And the embedder is still not offered as somewhere to send a CV.
    const picker = screen.getByTestId('analysis-provider') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['keyword']);
  });

  it('negative: says nothing on the ordinary machine with no Ollama at all', async () => {
    // The default state of almost every user. An "install Ollama" notice here
    // would be an advert on every launch for software they did not ask about.
    await renderView();

    expect(screen.queryByTestId('analysis-ollama-hint')).toBeNull();
  });

  it('boundary: says nothing once a chat model is installed alongside the embedder', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') {
        return JSON.stringify({
          models: [
            { model: 'nomic-embed-text:latest', name: 'nomic-embed-text:latest' },
            { model: 'llama3.2:3b', name: 'llama3.2:3b', details: { parameter_size: '3.2B' } },
          ],
        });
      }
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    await renderView();

    await vi.waitFor(() =>
      expect([
        ...(screen.getByTestId('analysis-provider') as HTMLSelectElement).options,
      ]).toHaveLength(2),
    );
    expect(screen.queryByTestId('analysis-ollama-hint')).toBeNull();
  });

  it('says the local option is private but weaker, in those words', async () => {
    // The honest one-line trade-off for the local model, asserted so a future
    // copy edit cannot quietly turn it into a boast.
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') {
        return JSON.stringify({
          models: [{ model: 'llama3.2:3b', name: 'llama3.2:3b' }],
        });
      }
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });

    await renderView();

    await vi.waitFor(() =>
      expect(screen.getByTestId('analysis-provider-note').textContent).toContain(
        'Private but weaker — nothing leaves your PC.',
      ),
    );
  });
});

describe('while the CV list is still being read', () => {
  /** A port whose read never finishes, so the loading state can be observed. */
  function neverResolvingPort() {
    return {
      loadCvs: () => new Promise<never>(() => undefined),
      loadJobs: () => new Promise<never>(() => undefined),
      saveCv: () => new Promise<never>(() => undefined),
      loadHistory: () => new Promise<never>(() => undefined),
      saveAnalysis: () => new Promise<never>(() => undefined),
    };
  }

  it('does not claim there are no CVs before it knows', async () => {
    // An empty state shown during a load is not an empty state, it is a wrong
    // answer — and this one comes with a disabled control, so the user is told
    // they have nothing AND stopped from doing anything about it.
    render(<Analysis port={neverResolvingPort()} filePort={createFakeFilePort()} now={NOW} />);

    const picker = (await screen.findByTestId('analysis-cv')) as HTMLSelectElement;

    expect(picker.textContent).toContain('Reading');
    expect(picker.textContent).not.toContain('No CV uploaded yet');
  });

  it('says there are none once the read comes back empty', async () => {
    await renderView();

    const picker = screen.getByTestId('analysis-cv') as HTMLSelectElement;
    expect(picker.textContent).toContain('No CV uploaded yet');
  });
});
