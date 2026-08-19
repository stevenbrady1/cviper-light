/**
 * The last check before a URL reaches the operating system.
 *
 * The opener plugin hands a string to the OS shell. Every URL this app opens is
 * either a constant in our own source or an advert link that
 * `@cviper/job-apis` already filtered — so this guard is a backstop, and a
 * backstop is exactly the thing that has to be tested, because nothing else
 * will ever exercise it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isErr, isOk } from '@cviper/core-types';

const plugin = vi.hoisted(() => ({ openUrl: vi.fn<(url: string) => Promise<void>>() }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: plugin.openUrl }));

const { createTauriBrowserPort, isOpenableUrl } = await import('./browser');

beforeEach(() => {
  plugin.openUrl.mockReset();
  plugin.openUrl.mockResolvedValue(undefined);
});

describe('what may be opened', () => {
  it('accepts http and https', () => {
    expect(isOpenableUrl('https://www.reed.co.uk/developers/jobseeker')).toBe(true);
    expect(isOpenableUrl('http://uk.indeed.com/jobs?q=analyst')).toBe(true);
  });

  it('negative: refuses every scheme that is not the web', () => {
    // `file:` opens a local file, `javascript:` and `data:` are script, and
    // `smb:`/`\\\\host` reach a network share. The opener plugin would hand any
    // of them straight to the shell.
    for (const url of [
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'smb://attacker.invalid/share',
      'mailto:someone@example.invalid',
      '\\\\attacker.invalid\\share',
      'C:\\Windows\\System32\\cmd.exe',
      '//evil.example.invalid',
      '',
      '   ',
    ]) {
      expect(isOpenableUrl(url), `${url} should not be openable`).toBe(false);
    }
  });

  it('negative: refuses a scheme smuggled past a leading space or newline', () => {
    // Some shells trim before they parse. Ours refuses before they get a
    // chance, because a trimmed `\njavascript:` is still `javascript:`.
    expect(isOpenableUrl('  javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('\n\thttps://example.invalid')).toBe(false);
  });

  it('boundary: refuses a string that merely starts like a URL', () => {
    expect(isOpenableUrl('https:/example.invalid')).toBe(false);
    expect(isOpenableUrl('https:')).toBe(false);
    expect(isOpenableUrl('httpsx://example.invalid')).toBe(false);
  });
});

describe('opening', () => {
  it('hands an https link to the plugin unchanged', async () => {
    const opened = await createTauriBrowserPort().open('https://uk.indeed.com/jobs?q=a%20b');

    expect(plugin.openUrl).toHaveBeenCalledWith('https://uk.indeed.com/jobs?q=a%20b');
    expect(isOk(opened)).toBe(true);
  });

  it('adds no tracking of any kind to what it opens', async () => {
    // The product promise: nothing about the user reaches a third party. The
    // web application tags every outbound link with utm_source; this does not,
    // and this test is what stops it coming back as a "missing feature".
    await createTauriBrowserPort().open('https://www.reed.co.uk/jobs/55512345');

    expect(plugin.openUrl.mock.calls[0]?.[0]).toBe('https://www.reed.co.uk/jobs/55512345');
  });

  it('negative: refuses a forbidden scheme without calling the plugin at all', async () => {
    const opened = await createTauriBrowserPort().open('file:///C:/secrets.txt');

    expect(plugin.openUrl).not.toHaveBeenCalled();
    expect(isErr(opened) && opened.error.message).toContain('could not be opened');
  });

  it('negative: a plugin failure becomes a message, never an exception', async () => {
    plugin.openUrl.mockRejectedValue(new Error('no application is registered for https'));

    const opened = await createTauriBrowserPort().open('https://example.invalid');

    expect(isErr(opened) && opened.error.message).toContain('no application is registered');
  });

  it('negative: survives a rejection that is not an Error', async () => {
    plugin.openUrl.mockRejectedValue({ weird: true });

    const opened = await createTauriBrowserPort().open('https://example.invalid');

    expect(isErr(opened) && opened.error.message.length).toBeGreaterThan(0);
    expect(isErr(opened) && opened.error.message).not.toContain('[object Object]');
  });
});
