/**
 * The file boundary: the dialog, and the three narrow Rust commands behind it.
 *
 * Everything here is mocked at the two seams the app actually has — the dialog
 * plugin and `invoke` — because there is no Tauri runtime in a Vitest process.
 * What is NOT mocked is the base64 decoder, which is the one piece of real
 * logic in this file and is checked against the RFC's own vectors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  open: vi.fn<(options?: unknown) => Promise<unknown>>(),
  save: vi.fn<(options?: unknown) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: tauri.open, save: tauri.save }));

const { createTauriFilePort, decodeBase64 } = await import('./files');

beforeEach(() => {
  tauri.invoke.mockReset();
  tauri.open.mockReset();
  tauri.save.mockReset();
});

/** The bytes of a string, for comparing against a decode. */
function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('decodeBase64', () => {
  it.each([
    ['', ''],
    ['Zg==', 'f'],
    ['Zm8=', 'fo'],
    ['Zm9v', 'foo'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYmE=', 'fooba'],
    ['Zm9vYmFy', 'foobar'],
  ])('decodes %s back to the original bytes', (encoded, expected) => {
    expect(decodeBase64(encoded)).toEqual(bytesOf(expected));
  });

  it('survives every byte value, which is what a PDF actually contains', () => {
    const all = new Uint8Array(256);
    for (let value = 0; value < 256; value += 1) all[value] = value;

    // Encoded by the same algorithm `files.rs` implements.
    const encoded = btoa(String.fromCharCode(...all));

    expect(decodeBase64(encoded)).toEqual(all);
  });

  it('returns null rather than throwing on input that is not base64', () => {
    // Only reachable through a bug in our own Rust, so it must fail as a value
    // the caller has to handle rather than as an exception in a click handler.
    expect(decodeBase64('not base64!!')).toBeNull();
  });
});

describe('pickCv', () => {
  it('reads the file the user chose', async () => {
    tauri.open.mockResolvedValue('C:\\Users\\steve\\Documents\\CV.pdf');
    tauri.invoke.mockResolvedValue({ name: 'CV.pdf', bytes_base64: 'Zm9vYmFy' });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.value?.name).toBe('CV.pdf');
    expect(picked.value?.path).toBe('C:\\Users\\steve\\Documents\\CV.pdf');
    expect(picked.value?.bytes).toEqual(bytesOf('foobar'));
    expect(tauri.invoke).toHaveBeenCalledWith('read_cv_file', {
      path: 'C:\\Users\\steve\\Documents\\CV.pdf',
    });
  });

  it('treats a cancelled dialog as nothing happening, not as a failure', async () => {
    tauri.open.mockResolvedValue(null);

    const picked = await createTauriFilePort().pickCv();

    expect(picked).toEqual({ ok: true, value: null });
    // Nothing was chosen, so nothing is read. A cancel that still hit the disk
    // would be a bug the user could not see.
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('unwraps an array, because the dialog may answer with one', async () => {
    tauri.open.mockResolvedValue(['C:\\one.pdf']);
    tauri.invoke.mockResolvedValue({ name: 'one.pdf', bytes_base64: 'Zm9v' });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok && picked.value?.path).toBe('C:\\one.pdf');
  });

  it("passes the Rust refusal through in Rust's own words", async () => {
    tauri.open.mockResolvedValue('C:\\secrets.txt');
    tauri.invoke.mockRejectedValue(
      'CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.',
    );

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.error.message).toBe(
      'CViper cannot read that kind of file. Pick a PDF or a Word (.docx) CV.',
    );
  });

  it('reports a reply it cannot read, rather than handing back empty bytes', async () => {
    // Empty bytes would be analysed as an empty CV and reported as "no skills
    // found", which looks like an answer. See `document.ts` in @cviper/cv-parsing.
    tauri.open.mockResolvedValue('C:\\cv.pdf');
    tauri.invoke.mockResolvedValue({ name: 'cv.pdf' });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
  });

  it('reports a dialog that will not open', async () => {
    tauri.open.mockRejectedValue(new Error('no display'));

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.error.message).toContain('file picker');
  });
});

describe('pickBackup', () => {
  it('reads the backup the user chose', async () => {
    tauri.open.mockResolvedValue('C:\\backup.json');
    tauri.invoke.mockResolvedValue('{"schemaVersion":1}');

    const picked = await createTauriFilePort().pickBackup();

    expect(picked.ok && picked.value?.text).toBe('{"schemaVersion":1}');
    expect(picked.ok && picked.value?.name).toBe('backup.json');
    expect(tauri.invoke).toHaveBeenCalledWith('read_backup_file', { path: 'C:\\backup.json' });
  });

  it('treats a cancelled dialog as nothing happening', async () => {
    tauri.open.mockResolvedValue(null);
    expect(await createTauriFilePort().pickBackup()).toEqual({ ok: true, value: null });
  });

  it('passes a Rust refusal through', async () => {
    tauri.open.mockResolvedValue('C:\\backup.json');
    tauri.invoke.mockRejectedValue('That file is no longer there.');

    const picked = await createTauriFilePort().pickBackup();

    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.error.message).toBe('That file is no longer there.');
  });
});

describe('saveBackup', () => {
  it('writes to the path the user chose and reports it back', async () => {
    tauri.save.mockResolvedValue('C:\\Users\\steve\\Documents\\cviper-backup.json');
    tauri.invoke.mockResolvedValue(null);

    const saved = await createTauriFilePort().saveBackup('{}', 'cviper-backup.json');

    expect(saved).toEqual({ ok: true, value: 'C:\\Users\\steve\\Documents\\cviper-backup.json' });
    expect(tauri.invoke).toHaveBeenCalledWith('write_backup_file', {
      path: 'C:\\Users\\steve\\Documents\\cviper-backup.json',
      contents: '{}',
    });
  });

  it('treats a cancelled save as nothing happening, and writes nothing', async () => {
    tauri.save.mockResolvedValue(null);

    const saved = await createTauriFilePort().saveBackup('{}', 'cviper-backup.json');

    expect(saved).toEqual({ ok: true, value: null });
    expect(tauri.invoke).not.toHaveBeenCalled();
  });

  it('offers the suggested filename to the dialog', async () => {
    tauri.save.mockResolvedValue(null);

    await createTauriFilePort().saveBackup('{}', 'cviper-backup-2026-08-19.json');

    expect(tauri.save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'cviper-backup-2026-08-19.json' }),
    );
  });

  it('passes a write refusal through', async () => {
    tauri.save.mockResolvedValue('C:\\Windows\\backup.json');
    tauri.invoke.mockRejectedValue('Windows would not let CViper write there.');

    const saved = await createTauriFilePort().saveBackup('{}', 'b.json');

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.message).toBe('Windows would not let CViper write there.');
  });
});
