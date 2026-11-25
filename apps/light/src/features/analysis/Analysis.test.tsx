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
const { createFakeBrowserPort } = await import('../../platform/test/fakeBrowserPort');
const { OLLAMA_DOWNLOAD_URL } = await import('./providers');

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
  name: 'Jordan Lewis CV.pdf',
  file_path: 'C:\\Users\\jamie\\Documents\\CV.pdf',
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
};

const TRACKED_JOB: Job = {
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

/**
 * L-277 — a new user can see a real result before finding a CV and an advert.
 * The sample is checked with the free keyword scan, on built-in text, and
 * writes NOTHING: there is no way to delete a single CV from the app, so a
 * sample saved as a CV would sit in the user's list for good.
 */
describe('try it with a sample (L-277)', () => {
  it('offers a sample when there is no CV yet', async () => {
    await renderView();
    expect(await screen.findByTestId('analysis-try-sample')).toBeTruthy();
  });

  it('shows a real result in one click, saying it is a sample', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));

    const sample = await screen.findByTestId('analysis-sample');
    expect(within(sample).getByTestId('analysis-result')).toBeTruthy();
    expect(sample.textContent ?? '').toMatch(/made-up/i);
    expect(sample.textContent ?? '').toMatch(/nothing was saved/i);
  });

  it('the sample’s intro is one line: made-up, nothing saved, add your own (L-395)', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));

    const intro = (await screen.findByTestId('analysis-sample')).querySelector('p');
    expect(intro?.textContent).toBe(
      'A sample check with a made-up CV and advert. Nothing was saved. Add your own CV above to check it for real.',
    );
    // The opening words stay picked out in bold, as before.
    expect(intro?.querySelector('span.font-medium')?.textContent).toBe('A sample check');
  });

  // L-290 — through the real screen: the sample's matched skills come with the
  // lines of the sample CV that show them.
  it('shows where the sample CV says each matched skill', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));
    const proof = within(await screen.findByTestId('analysis-sample')).getByTestId(
      'analysis-proof',
    );
    expect(within(proof).getAllByRole('listitem').length).toBeGreaterThan(2);
    expect(proof.textContent ?? '').toMatch(/SQL/);
  });

  // L-291 — through the real screen: the sample's basic-match score says what
  // it rests on.
  it('says how many requirements the sample score rests on', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));
    const label = within(await screen.findByTestId('analysis-sample')).getByTestId(
      'analysis-confidence',
    );
    expect(label.textContent ?? '').toMatch(/^Confidence: (low|medium|high) — based on/);
  });

  it('negative: saves no CV and no analysis, and contacts nothing', async () => {
    const { port } = await renderView();
    const user = userEvent.setup();
    const button = await screen.findByTestId('analysis-try-sample');
    // The screen's own start-up reads happen before the click; the click
    // itself must add nothing — no database write, no command to the backend.
    const commandsBefore = tauri.invoke.mock.calls.length;
    await user.click(button);
    await screen.findByTestId('analysis-sample');

    expect(port.calls.saveCv).toBe(0);
    expect(port.calls.saveAnalysis).toBe(0);
    expect(tauri.invoke.mock.calls.slice(commandsBefore)).toEqual([]);
  });

  it('negative: is not offered once the user has a CV of their own', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    expect(screen.queryByTestId('analysis-try-sample')).toBeNull();
  });

  it('boundary: keeps the screen to one primary button', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));
    await screen.findByTestId('analysis-sample');
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('can be put away again', async () => {
    await renderView();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('analysis-try-sample'));
    await user.click(await screen.findByTestId('analysis-sample-hide'));
    expect(screen.queryByTestId('analysis-sample')).toBeNull();
    expect(screen.getByTestId('analysis-try-sample')).toBeTruthy();
  });
});

describe('the empty screen', () => {
  it('says nothing has been checked and offers the basic match', async () => {
    await renderView();

    // L-295: plain words — the promise is the same, "API key" is jargon.
    expect(screen.getByTestId('analysis-empty').textContent).toContain('no account and no set-up');
    expect(screen.getByTestId('analysis-empty').textContent).not.toMatch(/\bAPI\b/);
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

  // L-299 (from L-238): a screen reader reading the grey button hears why.
  it('the disabled button is described by its reason', async () => {
    await renderView();

    const run = screen.getByTestId('analysis-run');
    const reason = screen.getByTestId('analysis-run-reason');
    expect(reason.id).not.toBe('');
    expect(run.getAttribute('aria-describedby')).toBe(reason.id);
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

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), 'Analyst');

    expect(screen.getByTestId('analysis-run-reason').textContent).toContain('more of the advert');
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
  });

  it('becomes pressable, with no reason shown, once both are there', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);

    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', false);
    expect(screen.queryByTestId('analysis-run-reason')).toBeNull();
    // NEGATIVE — no description pointing at a reason that is not there.
    expect(screen.getByTestId('analysis-run').getAttribute('aria-describedby')).toBeNull();
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
    // L-147: the file's location on this computer is never stored.
    expect(port.storedCvs()[0]?.file_path).toBeNull();
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

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
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

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
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
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
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

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
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

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
    await user.click(screen.getByTestId('analysis-history-open'));

    expect((await screen.findByTestId('analysis-history-empty')).textContent).toContain(
      'not been checked',
    );
  });
});

/**
 * L-444 — "Past checks" sits in the page header, next to the title, as a
 * secondary button. The blue "Check this CV" stays by the advert box it acts on.
 */
describe('"Past checks" in the page header (L-444)', () => {
  function pageHeader(): HTMLElement {
    const header = screen.getByRole('heading', { level: 1, name: 'Analysis' }).closest('header');
    if (header === null) throw new Error('the page title is not inside a header');
    return header;
  }

  it('sits inside the page header and reads "Past checks (N)"', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });

    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    const open = within(pageHeader()).getByTestId('analysis-history-open');
    expect(open.textContent).toBe('Past checks (1)');
  });

  it('negative: is a secondary button, and the screen keeps exactly one primary', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    const open = within(pageHeader()).getByTestId('analysis-history-open');
    expect(open.hasAttribute('data-primary')).toBe(false);
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('boundary: with no CV chosen it is still there, but disabled', async () => {
    await renderView();

    const open = within(pageHeader()).getByTestId('analysis-history-open');
    expect(open).toHaveProperty('disabled', true);
    expect(open.textContent).toBe('Past checks (0)');
  });

  it('a click opens the pane, and the button greys out while it is open', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    const open = within(pageHeader()).getByTestId('analysis-history-open');
    await user.click(open);

    expect(await screen.findByTestId('analysis-history-empty')).toBeTruthy();
    expect(open).toHaveProperty('disabled', true);
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

  it('says in plain words what fixes it, rather than showing an empty picker', async () => {
    embedderOnly();
    await renderView();

    const hint = await screen.findByTestId('analysis-ollama-hint');
    // L-240: a plain sentence and a link, not a terminal command.
    expect(hint.textContent).toContain('add a chat model in it');
    expect(hint.textContent).not.toContain('ollama pull');
    expect(within(hint).getByRole('button', { name: 'Open Ollama’s download page' })).toBeTruthy();

    // And the embedder is still not offered as somewhere to send a CV.
    const picker = screen.getByTestId('analysis-provider') as HTMLSelectElement;
    expect([...picker.options].map((option) => option.value)).toEqual(['keyword']);
  });

  it('the link opens Ollama’s download page in the browser (L-240)', async () => {
    embedderOnly();
    const user = userEvent.setup();
    const browser = createFakeBrowserPort();
    render(
      <Analysis
        port={createFakeAnalysisPort()}
        filePort={createFakeFilePort()}
        browser={browser}
        now={NOW}
      />,
    );

    const hint = await screen.findByTestId('analysis-ollama-hint');
    await user.click(within(hint).getByRole('button', { name: 'Open Ollama’s download page' }));

    expect(browser.opened()).toEqual([OLLAMA_DOWNLOAD_URL]);
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
        'Private but weaker — your CV stays on your PC.',
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

/**
 * L-446 — one line of choices, and the advert box as the hero. "Check [CV] […]
 * using [AI]" and a quiet "Upload a CV" on one line; the advert box under it,
 * with the tracked-job chip and "Check this CV" in the box's bar; the AI's note
 * and the CV sentence under the box. The drop-downs keep their words as hidden
 * names.
 */
describe('one line of choices, and the advert box as the hero (L-446)', () => {
  const SECOND_CV: Cv = { ...EXISTING_CV, id: 'cv-2', name: 'Second CV.docx' };
  const SAVE_WORDS = 'Only a CV that arrived as a JSON Resume can be saved as one.';

  /** `a` comes before `b` in the page. */
  function expectBefore(a: Element, b: Element): void {
    expect(
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      `${a.textContent ?? ''} before ${b.textContent ?? ''}`,
    ).toBeTruthy();
  }

  function sentence(): HTMLElement {
    const row = screen.getByTestId('analysis-cv').closest<HTMLElement>('[data-slot="sentence"]');
    if (row === null) throw new Error('the CV chip is not in the sentence row');
    return row;
  }

  function bar(): HTMLElement {
    return screen.getByTestId('composer-bar');
  }

  it('happy: the line reads "Check", the CV chip, "using", the AI chip, Upload a CV, then "…"', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    const row = sentence();
    // Changed on purpose (L-463): the "…" left the sentence for the end of the line.
    const order = [
      within(row).getByText('Check'),
      screen.getByTestId('analysis-cv'),
      within(row).getByText('using'),
      screen.getByTestId('analysis-provider'),
      screen.getByTestId('analysis-upload'),
      screen.getByTestId('analysis-cv-more'),
    ];
    for (const part of order) expect(row.contains(part)).toBe(true);
    for (let i = 1; i < order.length; i += 1) expectBefore(order[i - 1]!, order[i]!);
    // Upload a CV is quiet now: the bordered things on the line are the chips.
    expect(screen.getByTestId('analysis-upload').classList.contains('border')).toBe(false);
  });

  it('happy: each control keeps its words as a spoken name, and none is shown as a label', async () => {
    await renderView({
      port: createFakeAnalysisPort({ cvs: [EXISTING_CV], jobs: [TRACKED_JOB] }),
    });
    await screen.findByTestId('analysis-job-pick');

    const named: [string, string, string][] = [
      ['combobox', 'Your CV', 'analysis-cv'],
      ['combobox', 'How to check it', 'analysis-provider'],
      ['textbox', 'The job advert', 'analysis-job-text'],
      ['combobox', 'Or use one you are already tracking', 'analysis-job-pick'],
      ['button', 'More for this CV', 'analysis-cv-more'],
    ];
    for (const [role, name, testId] of named) {
      expect(screen.getByRole(role, { name }), name).toBe(screen.getByTestId(testId));
    }
    const composer = sentence().parentElement!;
    for (const label of composer.querySelectorAll('label')) {
      expect(label.classList.contains('sr-only'), label.textContent ?? '').toBe(true);
    }
    // The tracked-job chip says its name when nothing is chosen; the old words are gone.
    const pick = screen.getByTestId<HTMLSelectElement>('analysis-job-pick');
    expect(pick.options[0]?.textContent).toBe('Or use one you are already tracking');
    expect(screen.queryByText('Choose a tracked job…')).toBeNull();
  });

  it('happy: "Check this CV" and its reason sit in the box’s bar, the reason first, one primary on screen', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await vi.waitFor(() =>
      expect(screen.getByTestId('analysis-run-reason').textContent).toBe('Paste the job advert.'),
    );

    const run = screen.getByTestId('analysis-run');
    const reason = screen.getByTestId('analysis-run-reason');
    expect(bar().contains(run)).toBe(true);
    expect(bar().contains(reason)).toBe(true);
    expectBefore(reason, run);
    // The box is the text box and its bar, one under the other.
    expect(screen.getByTestId('analysis-job-text').nextElementSibling).toBe(bar());
    expect(document.querySelectorAll('[data-primary="true"]')).toHaveLength(1);
  });

  it('interaction: choosing another CV in the chip clears the old result', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV, SECOND_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');
    await user.type(screen.getByTestId('analysis-job-text'), ADVERT);
    await user.click(screen.getByTestId('analysis-run'));
    await screen.findByTestId('analysis-result');

    const chip = screen.getByRole('combobox', { name: 'Your CV' });
    expect(sentence().contains(chip)).toBe(true);
    await user.selectOptions(chip, 'cv-2');

    expect(screen.queryByTestId('analysis-result')).toBeNull();
    expect(screen.getByTestId('analysis-empty')).toBeTruthy();
  });

  it('interaction: "Save as JSON Resume" waits behind the "…", and opens with it', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    const more = screen.getByTestId('analysis-cv-more');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('analysis-save-json')).toBeNull();

    await user.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('analysis-save-json').textContent).toBe('Save as JSON Resume');
  });

  it('interaction: choosing a tracked job from the chip in the bar fills the box', async () => {
    const user = userEvent.setup();
    await renderView({
      port: createFakeAnalysisPort({ cvs: [EXISTING_CV], jobs: [TRACKED_JOB] }),
    });

    const pick = await screen.findByTestId('analysis-job-pick');
    expect(bar().contains(pick)).toBe(true);
    await user.selectOptions(pick, 'job-1');

    expect(screen.getByTestId<HTMLTextAreaElement>('analysis-job-text').value).toContain(
      'Credit Risk Analyst',
    );
  });

  it('negative: no CV, so the CV chip is greyed and says so, and the button says why beside it', async () => {
    await renderView();

    const chip = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Your CV' });
    expect(chip.disabled).toBe(true);
    expect(chip.selectedOptions[0]?.textContent).toBe('No CV uploaded yet');
    expect(screen.getByTestId('analysis-run')).toHaveProperty('disabled', true);
    const reason = screen.getByTestId('analysis-run-reason');
    expect(reason.textContent).toBe('Choose a CV first.');
    expect(reason.parentElement).toBe(screen.getByTestId('analysis-run').parentElement);
    expect(bar().contains(reason)).toBe(true);
  });

  it('negative: for a PDF CV the item is greyed in the "…" list, and its "i" says why', async () => {
    const user = userEvent.setup();
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    await user.click(screen.getByTestId('analysis-cv-more'));
    const save = screen.getByTestId<HTMLButtonElement>('analysis-save-json');
    expect(save.disabled).toBe(true);
    const info = screen
      .getAllByRole('button', { name: 'What this means' })
      .find(
        (button) =>
          document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ===
          SAVE_WORDS,
      );
    expect(info).toBeDefined();
  });

  it('boundary: a 120-character CV name is chosen whole, and the chip may not grow past its line', async () => {
    const long = 'Alex_Morgan_'.repeat(10);
    expect(long).toHaveLength(120);
    await renderView({
      port: createFakeAnalysisPort({ cvs: [{ ...EXISTING_CV, name: long }] }),
    });
    const chip = await screen.findByDisplayValue(long);

    expect(chip).toBe(screen.getByTestId('analysis-cv'));
    for (const element of [chip, chip.parentElement!]) {
      expect([...element.classList]).toEqual(expect.arrayContaining(['min-w-0', 'max-w-full']));
    }
  });

  it('boundary: with nothing tracked there is no tracked-job chip, and the button keeps the right of the bar', async () => {
    await renderView({ port: createFakeAnalysisPort({ cvs: [EXISTING_CV] }) });
    await screen.findByDisplayValue('Jordan Lewis CV.pdf');

    expect(screen.queryByTestId('analysis-job-pick')).toBeNull();
    expect(bar().querySelector('[data-slot="bar-start"]')).toBeNull();
    const end = screen.getByTestId('analysis-run').closest('[data-slot="bar-end"]');
    expect(end?.parentElement).toBe(bar());
    expect(end?.classList.contains('ml-auto')).toBe(true);
  });

  it('privacy words, word for word, under the box: the AI’s note, then the CV sentence', async () => {
    await renderView();

    const aiNote = screen.getByTestId('analysis-provider-note');
    const cvNote = screen.getByTestId('analysis-cv-note');
    expectBefore(bar(), aiNote);
    expectBefore(aiNote, cvNote);
    expect(cvNote.textContent).toBe(
      'PDF, Word (.docx) or JSON Resume (.json). The file is read on this computer. Its text only goes to an AI you choose, and only when you ask it to read your CV.',
    );
    expect(aiNote.closest('[data-slot="footnotes"]')).not.toBeNull();
    expect(cvNote.closest('[data-slot="footnotes"]')).not.toBeNull();
  });
});
