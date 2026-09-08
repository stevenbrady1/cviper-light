// @vitest-environment jsdom
/**
 * "Save as JSON Resume" on the analysis view (L-20b), driven the way a user
 * drives it. Same harness as `Analysis.test.tsx`: the parser is mocked (it
 * has its own exhaustive tests), the file port and the analysis port are the
 * inspectable fakes.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ok, type Cv } from '@cviper/core-types';

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

const NOW = new Date('2026-09-08T10:00:00.000Z');

const RESUME_TEXT = `{
  "basics": {
    "name": "Steve Brady"
  },
  "skills": [
    {
      "name": "SQL"
    }
  ]
}
`;

const JSON_CV: Cv = {
  id: 'cv-json',
  name: 'Steve Brady CV.json',
  file_path: 'C:\\Users\\steve\\Documents\\Steve Brady CV.json',
  extracted_text: 'Steve Brady SQL',
  created_at: '2026-09-01T09:00:00.000Z',
  json_resume: RESUME_TEXT,
};

const PDF_CV: Cv = {
  id: 'cv-pdf',
  name: 'Steve Brady CV.pdf',
  file_path: 'C:\\Users\\steve\\Documents\\Steve Brady CV.pdf',
  extracted_text: 'Steve Brady SQL',
  created_at: '2026-09-01T09:00:00.000Z',
  json_resume: null,
};

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

async function renderWith(cvs: readonly Cv[]) {
  const port = createFakeAnalysisPort({ cvs });
  const filePort = createFakeFilePort();
  render(<Analysis port={port} filePort={filePort} now={NOW} />);
  await screen.findByTestId('view-analysis');
  await vi.waitFor(() => expect(screen.getByTestId('analysis-provider')).toBeTruthy());
  return { port, filePort };
}

const saveButton = () => screen.getByTestId('analysis-save-json') as HTMLButtonElement;

describe('Save as JSON Resume', () => {
  it('is disabled, never hidden, for a CV that came from a PDF', async () => {
    await renderWith([PDF_CV]);
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().title).toMatch(/JSON Resume/);
  });

  it('is disabled when there is no CV at all', async () => {
    await renderWith([]);
    expect(saveButton().disabled).toBe(true);
  });

  it('happy: writes the stored file back out, stamped, under the CV’s own name', async () => {
    const user = userEvent.setup();
    const { filePort } = await renderWith([JSON_CV]);
    filePort.nextSavePath('C:\\Users\\steve\\Desktop\\Steve Brady CV.json');

    expect(saveButton().disabled).toBe(false);
    await user.click(saveButton());

    await vi.waitFor(() => expect(filePort.writtenCvJson()).toHaveLength(1));
    const written = filePort.writtenCvJson()[0]?.contents ?? '';
    const document = JSON.parse(written) as {
      basics: { name: string };
      skills: unknown[];
      meta: { cviper: { app: string; exportedAt: string; sourceCvId: string } };
    };
    expect(document.basics.name).toBe('Steve Brady');
    expect(document.skills).toHaveLength(1);
    expect(document.meta.cviper).toEqual({
      app: 'cviper-light',
      exportedAt: NOW.toISOString(),
      sourceCvId: 'cv-json',
    });
    // Everything before the stamp is the original, byte for byte.
    expect(written.startsWith(RESUME_TEXT.replace(/\n}\n$/, ''))).toBe(true);
    // Nothing went through the backup writer.
    expect(filePort.calls.saveBackup).toBe(0);

    const message = await screen.findByTestId('analysis-export-message');
    expect(message.textContent).toContain('Steve Brady CV.json');
  });

  it('negative: a cancelled dialog writes nothing and says nothing', async () => {
    const user = userEvent.setup();
    const { filePort } = await renderWith([JSON_CV]);
    filePort.nextSavePath(null);

    await user.click(saveButton());

    await vi.waitFor(() => expect(filePort.calls.saveCvJson).toBe(1));
    expect(filePort.writtenCvJson()).toHaveLength(0);
    expect(screen.queryByTestId('analysis-export-message')).toBeNull();
    expect(screen.queryByTestId('analysis-error')).toBeNull();
  });

  it('negative: a refused save is shown as an error, in the writer’s own words', async () => {
    const user = userEvent.setup();
    const { filePort } = await renderWith([JSON_CV]);
    filePort.failSave('A JSON Resume must be saved as a .json file.');

    await user.click(saveButton());

    const error = await screen.findByTestId('analysis-error');
    expect(error.textContent).toContain('A JSON Resume must be saved as a .json file.');
    expect(filePort.writtenCvJson()).toHaveLength(0);
  });

  it('boundary: a stored original that no longer parses is refused before the dialog opens', async () => {
    const user = userEvent.setup();
    const { filePort } = await renderWith([{ ...JSON_CV, json_resume: '{"basics": ' }]);

    await user.click(saveButton());

    const error = await screen.findByTestId('analysis-error');
    expect(error.textContent).toMatch(/could not be read/);
    expect(filePort.calls.saveCvJson).toBe(0);
  });
});

describe('uploading keeps the original only for a JSON Resume', () => {
  it('a .json upload stores the file’s text verbatim, and the button goes live', async () => {
    const user = userEvent.setup();
    const { port, filePort } = await renderWith([]);
    filePort.nextCv({
      name: 'New CV.json',
      path: 'C:\\New CV.json',
      bytes: new TextEncoder().encode(RESUME_TEXT),
    });
    parsing.extractText.mockResolvedValue(
      ok({ text: 'Steve Brady SQL', pageCount: null, warnings: [] }),
    );

    await user.click(screen.getByTestId('analysis-upload'));

    await vi.waitFor(() => expect(port.storedCvs()).toHaveLength(1));
    expect(port.storedCvs()[0]?.json_resume).toBe(RESUME_TEXT);
    await vi.waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('a .docx upload stores null, and the button stays disabled', async () => {
    const user = userEvent.setup();
    const { port, filePort } = await renderWith([]);
    filePort.nextCv({ name: 'New CV.docx', path: 'C:\\New CV.docx', bytes: new Uint8Array([1]) });
    parsing.extractText.mockResolvedValue(
      ok({ text: 'Steve Brady SQL', pageCount: 2, warnings: [] }),
    );

    await user.click(screen.getByTestId('analysis-upload'));

    await vi.waitFor(() => expect(port.storedCvs()).toHaveLength(1));
    expect(port.storedCvs()[0]?.json_resume).toBeNull();
    expect(saveButton().disabled).toBe(true);
  });
});
