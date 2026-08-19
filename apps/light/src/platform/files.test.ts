/**
 * The file boundary: three Rust commands, each of which opens its own dialog.
 *
 * There is only ONE seam left to mock — `invoke` — because the dialog moved
 * into Rust. That is the whole point of the change: the frontend no longer
 * knows a path exists until Rust reports one back, so there is no second thing
 * here to fake and no path for a test (or an injected script) to supply.
 *
 * What is NOT mocked is the base64 decoder, which is the one piece of real
 * logic in this file and is checked against the RFC's own vectors.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }));

const { createTauriFilePort, decodeBase64 } = await import('./files');

beforeEach(() => {
  tauri.invoke.mockReset();
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
  it('asks Rust to run the dialog, and never names a file', async () => {
    tauri.invoke.mockResolvedValue({
      name: 'CV.pdf',
      path: 'C:\\Users\\steve\\Documents\\CV.pdf',
      bytes_base64: 'Zm9vYmFy',
    });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.value?.name).toBe('CV.pdf');
    expect(picked.value?.path).toBe('C:\\Users\\steve\\Documents\\CV.pdf');
    expect(picked.value?.bytes).toEqual(bytesOf('foobar'));

    // ONE call, and no arguments at all. An argument here would be the hole
    // this whole boundary exists to close — see the module comment in files.rs.
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith('pick_and_read_cv');
  });

  it('treats a cancelled dialog as nothing happening, not as a failure', async () => {
    // Rust answers `Ok(None)`, which arrives as null. Showing a red message
    // because somebody changed their mind teaches people to distrust every
    // other message the app shows them.
    tauri.invoke.mockResolvedValue(null);

    const picked = await createTauriFilePort().pickCv();

    expect(picked).toEqual({ ok: true, value: null });
  });

  it("passes the Rust refusal through in Rust's own words", async () => {
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

  it('replaces a developer-facing failure with a sentence for the user', async () => {
    // An `Error` is a Tauri-level problem — no display, missing permission —
    // and its message is written for us, not for somebody whose CV would not
    // open. Same rule as `toProviderError` in `src/ai/transport.ts`.
    tauri.invoke.mockRejectedValue(new Error('window not found'));

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.error.message).not.toContain('window not found');
    expect(picked.error.message).toContain('CV');
  });

  it('reports a reply it cannot read, rather than handing back empty bytes', async () => {
    // Empty bytes would be analysed as an empty CV and reported as "no skills
    // found", which looks like an answer. See `document.ts` in @cviper/cv-parsing.
    tauri.invoke.mockResolvedValue({ name: 'cv.pdf', path: 'C:\\cv.pdf' });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
  });

  it('reports a reply whose base64 is not base64', async () => {
    tauri.invoke.mockResolvedValue({
      name: 'cv.pdf',
      path: 'C:\\cv.pdf',
      bytes_base64: 'not base64!!',
    });

    const picked = await createTauriFilePort().pickCv();

    expect(picked.ok).toBe(false);
  });
});

describe('pickBackup', () => {
  it('asks Rust to run the dialog, and never names a file', async () => {
    tauri.invoke.mockResolvedValue({
      name: 'backup.json',
      path: 'C:\\backup.json',
      text: '{"schemaVersion":1}',
    });

    const picked = await createTauriFilePort().pickBackup();

    expect(picked.ok && picked.value?.text).toBe('{"schemaVersion":1}');
    // The name is what the import confirmation shows: "Import from backup.json?"
    expect(picked.ok && picked.value?.name).toBe('backup.json');
    expect(tauri.invoke).toHaveBeenCalledTimes(1);
    expect(tauri.invoke).toHaveBeenCalledWith('pick_and_read_backup');
  });

  it('treats a cancelled dialog as nothing happening', async () => {
    tauri.invoke.mockResolvedValue(null);
    expect(await createTauriFilePort().pickBackup()).toEqual({ ok: true, value: null });
  });

  it('passes a Rust refusal through', async () => {
    tauri.invoke.mockRejectedValue('That file is no longer there.');

    const picked = await createTauriFilePort().pickBackup();

    expect(picked.ok).toBe(false);
    if (picked.ok) return;
    expect(picked.error.message).toBe('That file is no longer there.');
  });

  it('reports a reply it cannot read, rather than importing nothing', async () => {
    // A backup that arrived as an unreadable shape must not become an empty
    // import that silently replaces the user's data with nothing.
    tauri.invoke.mockResolvedValue({ name: 'backup.json', path: 'C:\\backup.json' });

    const picked = await createTauriFilePort().pickBackup();

    expect(picked.ok).toBe(false);
  });
});

describe('saveBackup', () => {
  it('hands Rust the contents and a suggested NAME, never a path', async () => {
    tauri.invoke.mockResolvedValue('C:\\Users\\steve\\Documents\\cviper-backup.json');

    const saved = await createTauriFilePort().saveBackup('{}', 'cviper-backup-2026-08-19.json');

    expect(saved).toEqual({ ok: true, value: 'C:\\Users\\steve\\Documents\\cviper-backup.json' });
    // `suggestion`, one word, because Tauri camelCases a Rust command's
    // snake_case parameters and a two-word name would silently need two
    // spellings. `the_frontend_calls_these_commands_by_these_names` in
    // files.rs pins this key against the Rust signature.
    expect(tauri.invoke).toHaveBeenCalledWith('pick_and_write_backup', {
      contents: '{}',
      suggestion: 'cviper-backup-2026-08-19.json',
    });
  });

  it('treats a cancelled save as nothing happening', async () => {
    tauri.invoke.mockResolvedValue(null);

    const saved = await createTauriFilePort().saveBackup('{}', 'cviper-backup.json');

    expect(saved).toEqual({ ok: true, value: null });
  });

  it('passes a write refusal through', async () => {
    tauri.invoke.mockRejectedValue('Windows would not let CViper write there.');

    const saved = await createTauriFilePort().saveBackup('{}', 'b.json');

    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.message).toBe('Windows would not let CViper write there.');
  });

  it('reports a reply that is neither a path nor a cancellation', async () => {
    // Answering "saved" without saying where would put "Saved to undefined" in
    // front of the user, which is worse than admitting the write is in doubt.
    tauri.invoke.mockResolvedValue(42);

    const saved = await createTauriFilePort().saveBackup('{}', 'b.json');

    expect(saved.ok).toBe(false);
  });
});
