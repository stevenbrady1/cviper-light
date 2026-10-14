// @vitest-environment jsdom
/**
 * Tailor on a first run with nothing set up (L-240).
 *
 * Tailoring writes new text, so it still needs an AI — there is no keyword way
 * to write a paragraph, and this file does not pretend otherwise. What it
 * guards is that the screen is not a dead end:
 *
 *   * the CV can be uploaded HERE, with no model, so it is ready — and it lands
 *     in the picker, selected;
 *   * the reason under the button is followed by two ways forward: add a key
 *     (Settings), or use a free AI on your own PC.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { err, ok, type Cv } from '@cviper/core-types';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));
const parsing = vi.hoisted(() => ({ extractText: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@cviper/cv-parsing', () => ({ extractText: parsing.extractText }));

const { Tailor } = await import('./Tailor');
const { createFakeTailorPort } = await import('./test/fakePort');
const { createFakeConsentPort } = await import('../analysis/test/fakeConsentPort');
const { createFakeFilePort } = await import('../../platform/test/fakeFilePort');
const { NO_AI_REASON } = await import('./model');

type FakeTailorPort = ReturnType<typeof createFakeTailorPort>;
type FakeFilePort = ReturnType<typeof createFakeFilePort>;

const NOW = new Date('2026-10-14T09:00:00.000Z');
const CV_TEXT =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, IFRS 9.';

const OLD_CV: Cv = {
  id: 'cv-old',
  name: 'Old CV.docx',
  file_path: null,
  extracted_text: CV_TEXT,
  json_resume: null,
  created_at: '2026-08-01T09:00:00.000Z',
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

function nothingSetUp(): void {
  tauri.invoke.mockImplementation(async (command) => {
    if (command === 'ollama_probe') return null;
    if (command === 'secret_status') return false;
    throw new Error(`unexpected command: ${command}`);
  });
}

beforeEach(() => {
  tauri.invoke.mockReset();
  parsing.extractText.mockReset();
  nothingSetUp();
});

afterEach(() => cleanup());

async function renderView(
  options: {
    port?: FakeTailorPort;
    files?: FakeFilePort;
    onOpenSettings?: () => void;
  } = {},
): Promise<{ port: FakeTailorPort; files: FakeFilePort }> {
  const port = options.port ?? createFakeTailorPort();
  const files = options.files ?? createFakeFilePort();
  render(
    <Tailor
      port={port}
      filePort={files}
      consentPort={createFakeConsentPort()}
      now={NOW}
      onOpenSettings={options.onOpenSettings}
    />,
  );
  await screen.findByTestId('tailor-cv-pick');
  return { port, files };
}

describe('uploading a CV on Tailor', () => {
  it('stays enabled with no model, and the new CV is stored, listed and selected', async () => {
    const user = userEvent.setup();
    const { port, files } = await renderView({
      port: createFakeTailorPort({ cvs: [OLD_CV] }),
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId('tailor-run-reason').textContent).toBe(NO_AI_REASON),
    );

    const upload = screen.getByTestId('tailor-upload');
    expect(upload).toHaveProperty('disabled', false);

    files.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    await user.click(upload);

    // Into the SAME store every screen reads.
    await vi.waitFor(() => expect(port.storedCvs().map((cv) => cv.name)).toContain('New CV.docx'));
    const picker = (await screen.findByDisplayValue('New CV.docx')) as HTMLSelectElement;
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'New CV.docx',
      'Old CV.docx',
    ]);
  });

  it('works on an empty machine: the picker goes from "No CV uploaded yet" to the new CV', async () => {
    const user = userEvent.setup();
    const { files } = await renderView();
    await screen.findByText('No CV uploaded yet');

    files.nextCv({ name: 'CV.pdf', path: 'C:\\CV.pdf', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: 1, warnings: [] }));
    await user.click(screen.getByTestId('tailor-upload'));

    const picker = (await screen.findByDisplayValue('CV.pdf')) as HTMLSelectElement;
    expect(picker.disabled).toBe(false);
    expect(screen.queryByText('No CV uploaded yet')).toBeNull();
  });

  it('boundary: an empty file is refused in the parser’s words and the picker is unchanged', async () => {
    const user = userEvent.setup();
    const { port, files } = await renderView({ port: createFakeTailorPort({ cvs: [OLD_CV] }) });
    await screen.findByDisplayValue('Old CV.docx');

    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array(0) });
    parsing.extractText.mockResolvedValue(
      err({ code: 'EMPTY_FILE', message: 'That file is empty.', detail: null }),
    );
    await user.click(screen.getByTestId('tailor-upload'));

    expect((await screen.findByTestId('tailor-upload-problem')).textContent).toBe(
      'That file is empty.',
    );
    expect(port.storedCvs()).toEqual([OLD_CV]);
    expect(screen.getByDisplayValue('Old CV.docx')).toBeTruthy();
  });

  it('negative: a file the app cannot read is reported and nothing is stored', async () => {
    const user = userEvent.setup();
    const { port, files } = await renderView();

    files.failCv('CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.');
    await user.click(screen.getByTestId('tailor-upload'));

    expect((await screen.findByTestId('tailor-upload-problem')).textContent).toContain(
      'cannot read that kind of file',
    );
    expect(port.storedCvs()).toEqual([]);
  });

  it('negative: a CV that would not save says so, and is not listed', async () => {
    const user = userEvent.setup();
    const { port, files } = await renderView();

    port.failNext('saveCv');
    files.nextCv({ name: 'CV.docx', path: 'C:\\CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(ok({ text: CV_TEXT, pageCount: null, warnings: [] }));
    await user.click(screen.getByTestId('tailor-upload'));

    expect((await screen.findByTestId('tailor-upload-problem')).textContent).toContain(
      'could not be saved',
    );
    expect(screen.queryByDisplayValue('CV.docx')).toBeNull();
  });

  it('a cancelled dialog changes nothing and says nothing', async () => {
    const user = userEvent.setup();
    const { port, files } = await renderView();

    files.nextCv(null);
    await user.click(screen.getByTestId('tailor-upload'));

    await vi.waitFor(() => expect(files.calls.pickCv).toBe(1));
    expect(port.storedCvs()).toEqual([]);
    expect(screen.queryByTestId('tailor-upload-problem')).toBeNull();
  });

  it('no longer sends the user to the Analysis screen to upload', async () => {
    await renderView();
    expect(screen.getByTestId('view-tailor').textContent).not.toContain(
      'uploaded on the Analysis screen',
    );
  });
});

describe('with no AI set up, two ways forward instead of a dead end', () => {
  it('"Add an AI key" opens Settings', async () => {
    const user = userEvent.setup();
    const openSettings = vi.fn();
    await renderView({
      port: createFakeTailorPort({ cvs: [OLD_CV] }),
      onOpenSettings: openSettings,
    });

    const panel = await screen.findByTestId('tailor-no-ai');
    const addKey = within(panel).getByRole('button', { name: 'Add an AI key' });
    expect(addKey.getAttribute('data-testid')).toBe('tailor-open-settings');

    await user.click(addKey);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('"Use a free AI on your own PC" says what it means, and names Settings', async () => {
    await renderView({ onOpenSettings: () => undefined });

    const free = await screen.findByTestId('tailor-free-local');
    expect(free.textContent).toContain('Use a free AI on your own PC');
    expect(free.textContent).toContain('Settings');
    // No provider is named on this surface (L-148).
    const copy = screen.getByTestId('tailor-no-ai').textContent ?? '';
    for (const brand of ['OpenAI', 'Anthropic', 'Ollama', 'GPT', 'Claude', 'llama']) {
      expect(copy).not.toContain(brand);
    }
  });

  it('negative: with nowhere to go, "Add an AI key" is words naming Settings, not a dead button', async () => {
    await renderView();

    const panel = await screen.findByTestId('tailor-no-ai');
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(panel.textContent).toContain('Add an AI key in Settings');
    expect(screen.getByTestId('tailor-free-local')).toBeTruthy();
  });

  it('boundary: no panel once a local model is found', async () => {
    tauri.invoke.mockImplementation(async (command) => {
      if (command === 'ollama_probe') return TAGS;
      if (command === 'secret_status') return false;
      throw new Error(`unexpected command: ${command}`);
    });
    await renderView({ onOpenSettings: () => undefined });

    await vi.waitFor(() =>
      expect((screen.getByTestId('tailor-provider') as HTMLSelectElement).disabled).toBe(false),
    );
    expect(screen.queryByTestId('tailor-no-ai')).toBeNull();
    expect(screen.queryByTestId('tailor-open-settings')).toBeNull();
  });
});
