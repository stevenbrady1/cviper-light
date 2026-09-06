import { describe, expect, it } from 'vitest';

import { sniffFileKind } from './detect';
import { extractText } from './extract';
import { extractJsonResumeText } from './json-resume';
import { makeMinimalPdf, makePlainTextFile } from './test/fixtures';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const RESUME = JSON.stringify({
  basics: { name: 'Jane Smith', label: 'Senior Credit Risk Analyst' },
  work: [{ name: 'Acme Bank', position: 'Analyst', startDate: '2019', highlights: ['IFRS 9'] }],
  skills: [{ name: 'Python', keywords: ['pandas'] }],
});

describe('sniffFileKind — JSON', () => {
  it('recognises an object and an array, with or without a byte-order mark or leading whitespace', () => {
    expect(sniffFileKind(utf8('{"basics":{}}'))).toBe('json');
    expect(sniffFileKind(utf8('[1]'))).toBe('json');
    expect(sniffFileKind(utf8('\n  \t{"a":1}'))).toBe('json');
    expect(sniffFileKind(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('{}')]))).toBe('json');
  });

  it('does not mistake prose, an empty file or whitespace for JSON', () => {
    expect(sniffFileKind(makePlainTextFile())).toBeNull();
    expect(sniffFileKind(new Uint8Array(0))).toBeNull();
    expect(sniffFileKind(utf8('   \n'))).toBeNull();
    expect(sniffFileKind(new Uint8Array([0xef, 0xbb, 0xbf]))).toBeNull();
  });

  it('still calls a PDF a PDF, even one that mentions "%PDF" is not what a résumé does', () => {
    // A résumé whose summary mentions "%PDF" begins with `{`, so it is JSON
    // before the lenient PDF search gets a look at it.
    expect(sniffFileKind(makeMinimalPdf('Jane Smith'))).toBe('pdf');
    expect(sniffFileKind(utf8('{"basics":{"summary":"I write %PDF-1.4 exporters"}}'))).toBe('json');
  });
});

describe('extractText — a .json file', () => {
  it('flattens a JSON Resume to CV text with no pages and no warnings', async () => {
    const result = await extractText('jane-smith.json', utf8(RESUME));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe(
      [
        'Jane Smith',
        'Senior Credit Risk Analyst',
        '',
        'Experience',
        'Analyst, Acme Bank (2019 – Present)',
        '- IFRS 9',
        '',
        'Skills',
        'Python: pandas',
      ].join('\n'),
    );
    expect(result.value.pageCount).toBeNull();
    expect(result.value.warnings).toEqual([]);
  });

  it('ignores the case of the extension', async () => {
    const result = await extractText('CV.JSON', utf8(RESUME));
    expect(result.ok).toBe(true);
  });

  it('reports a file that is not JSON as corrupt, with what to do', async () => {
    const result = await extractText('cv.json', utf8('{"basics": {"name": "Jane"'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CORRUPT_FILE');
    expect(result.error.message).toMatch(/not valid JSON/);
    expect(result.error.message).toMatch(/Export it again/);
    expect(result.error.detail).not.toBeNull();
  });

  it('reports JSON that is not a résumé, naming the format it wants', async () => {
    const result = await extractText('data.json', utf8('{"jobs":[],"applications":[]}'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_JSON_RESUME');
    if (result.error.code !== 'INVALID_JSON_RESUME') return;
    expect(result.error.issues).toEqual([]);
    expect(result.error.message).toMatch(/not a JSON Resume/);
  });

  it('lists the fields of a résumé it cannot read, and imports nothing', async () => {
    const result = await extractText(
      'cv.json',
      utf8('{"basics":{"name":42},"work":[{"highlights":"one"}]}'),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_JSON_RESUME');
    if (result.error.code !== 'INVALID_JSON_RESUME') return;
    expect(result.error.issues).toEqual([
      expect.stringMatching(/^basics\.name: /),
      expect.stringMatching(/^work\[0\]\.highlights: /),
    ]);
    expect(result.error.message).toContain('basics.name');
  });

  it('reports a résumé with nothing in it as an empty document', async () => {
    const result = await extractText('cv.json', utf8('{"basics":{"name":""},"work":[]}'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });

  it('reports a résumé made only of invisible characters as empty', () => {
    // Zero-width spaces survive the résumé parser (they are content to it)
    // and are removed by whitespace normalisation. Not a crash, not a CV.
    const result = extractJsonResumeText(utf8('{"basics":{"name":"​​"}}'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_DOCUMENT');
  });

  it('rejects a .json whose contents are really a PDF as a mismatch', async () => {
    const result = await extractText('cv.json', makeMinimalPdf('Jane Smith'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
    expect(result.error.message).toMatch(/JSON Resume/);
    expect(result.error.message).toMatch(/PDF/);
  });

  it('rejects a .json that is plain prose as a mismatch', async () => {
    const result = await extractText('cv.json', makePlainTextFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('FORMAT_MISMATCH');
  });

  it('still rejects an empty .json file as empty, before looking at the name', async () => {
    const result = await extractText('cv.json', new Uint8Array(0));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPTY_FILE');
  });

  it('names JSON Resume among the formats it reads when refusing another', async () => {
    const result = await extractText('cv.txt', makePlainTextFile());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
    expect(result.error.message).toMatch(/JSON Resume/);
  });

  it('normalises whitespace the same way as every other format', async () => {
    const result = await extractText(
      'cv.json',
      utf8('{"basics":{"name":"Jane Smith","summary":"Line one\\r\\nLine two"}}'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.text).toBe('Jane Smith\n\nSummary\nLine one\nLine two');
  });
});
