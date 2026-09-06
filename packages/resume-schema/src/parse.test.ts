import { describe, expect, it } from 'vitest';

import { MAX_ISSUES_IN_MESSAGE } from './errors';
import { describePath, parseJsonResume, parseJsonResumeBytes } from './parse';
import { FULL_RESUME, FULL_RESUME_TEXT, utf8, withBom } from './test/fixtures';

function expectError(text: string) {
  const result = parseJsonResume(text);
  expect(result.ok, text).toBe(false);
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

describe('parseJsonResume — happy path', () => {
  it('reads a full résumé', () => {
    const result = parseJsonResume(FULL_RESUME_TEXT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.basics?.name).toBe('Jane Smith');
    expect(result.value.work?.[0]?.highlights).toHaveLength(2);
    expect(result.value.skills?.[2]?.name).toBe('SQL');
  });

  it('keeps keys it does not know, at every level', () => {
    // Another tool's data survives a trip through here. Stripping it would
    // make "import, then export" a lossy operation nobody asked for.
    const result = parseJsonResume(FULL_RESUME_TEXT);
    if (!result.ok) throw new Error(result.error.message);

    expect((result.value.basics as Record<string, unknown>)['x-pronouns']).toBe('she/her');
    expect((result.value.meta as Record<string, unknown>)['theme']).toBe('elegant');
  });

  it('reads the meta.cviper namespace', () => {
    const result = parseJsonResume(FULL_RESUME_TEXT);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.meta?.cviper).toStrictEqual(FULL_RESUME.meta.cviper);
  });

  it('accepts a résumé with only one section', () => {
    const result = parseJsonResume('{"skills":[{"name":"Python"}]}');
    expect(result.ok).toBe(true);
  });

  it('accepts the $schema field and unknown top-level keys', () => {
    const result = parseJsonResume('{"$schema":"x","basics":{"name":"A"},"custom":{"a":1}}');
    expect(result.ok).toBe(true);
  });
});

describe('parseJsonResume — not JSON', () => {
  it('reports a syntax error as invalid JSON, with the parser detail kept for logs', () => {
    const error = expectError('{"basics": {"name": "Jane"');

    expect(error.code).toBe('INVALID_JSON');
    expect(error.message).toMatch(/not valid JSON/);
    expect(error.detail).not.toBeNull();
  });

  it('reports an empty string as invalid JSON', () => {
    expect(expectError('').code).toBe('INVALID_JSON');
  });

  it('reports prose as invalid JSON', () => {
    expect(expectError('Jane Smith\nSenior Analyst').code).toBe('INVALID_JSON');
  });
});

describe('parseJsonResume — JSON that is not a résumé', () => {
  it.each([
    ['an array', '[{"name":"Jane"}]'],
    ['a string', '"Jane Smith"'],
    ['a number', '42'],
    ['null', 'null'],
    ['an empty object', '{}'],
    ['an object with only meta', '{"meta":{"version":"v1.0.0"}}'],
    ['an object with only $schema', '{"$schema":"x"}'],
    ['some other JSON entirely', '{"jobs":[],"applications":[]}'],
  ])('rejects %s as not a JSON Resume', (_label, text) => {
    const error = expectError(text);

    expect(error.code).toBe('NOT_A_JSON_RESUME');
    expect(error.message).toMatch(/JSON Resume/);
  });
});

describe('parseJsonResume — a résumé with the wrong shapes', () => {
  it('lists every problem by path and imports nothing', () => {
    const error = expectError(
      JSON.stringify({
        basics: { name: 42 },
        work: [{ name: 'Acme', highlights: 'one thing' }, { position: ['a'] }],
      }),
    );

    expect(error.code).toBe('INVALID_JSON_RESUME');
    if (error.code !== 'INVALID_JSON_RESUME') return;
    expect(error.issues).toHaveLength(3);
    expect(error.issues[0]).toMatch(/^basics\.name: /);
    expect(error.issues[1]).toMatch(/^work\[0\]\.highlights: /);
    expect(error.issues[2]).toMatch(/^work\[1\]\.position: /);
    // Every issue is in the message the user sees — three problems, three
    // lines, no "and more".
    for (const issue of error.issues) expect(error.message).toContain(issue);
    expect(error.message).not.toMatch(/more/);
    expect(error.message).toMatch(/nothing has been imported/);
  });

  it('names the first few problems and counts the rest', () => {
    const skills = Array.from({ length: MAX_ISSUES_IN_MESSAGE + 4 }, () => ({ name: 1 }));
    const error = expectError(JSON.stringify({ skills }));

    expect(error.code).toBe('INVALID_JSON_RESUME');
    if (error.code !== 'INVALID_JSON_RESUME') return;
    expect(error.issues).toHaveLength(MAX_ISSUES_IN_MESSAGE + 4);
    expect(error.message).toContain(`skills[${MAX_ISSUES_IN_MESSAGE - 1}].name`);
    expect(error.message).not.toContain(`skills[${MAX_ISSUES_IN_MESSAGE}].name`);
    expect(error.message).toContain('and 4 more');
  });

  it('rejects a section that is not a list', () => {
    const error = expectError('{"work":{"name":"Acme"}}');

    expect(error.code).toBe('INVALID_JSON_RESUME');
    if (error.code !== 'INVALID_JSON_RESUME') return;
    expect(error.issues[0]).toMatch(/^work: /);
  });

  it('rejects a list item inside a string list that is not a string', () => {
    const error = expectError('{"skills":[{"name":"Python","keywords":["pandas", 3]}]}');

    expect(error.code).toBe('INVALID_JSON_RESUME');
    if (error.code !== 'INVALID_JSON_RESUME') return;
    expect(error.issues).toEqual([expect.stringMatching(/^skills\[0\]\.keywords\[1\]: /)]);
  });
});

describe('parseJsonResume — boundaries', () => {
  it('reports a résumé with sections but no text as empty, not as imported', () => {
    for (const text of [
      '{"basics":{}}',
      '{"work":[]}',
      '{"basics":{"name":""},"skills":[{"name":"   "}]}',
      '{"basics":{"location":{}},"education":[{}]}',
    ]) {
      const error = expectError(text);
      expect(error.code, text).toBe('EMPTY_RESUME');
    }
  });

  it('treats a single character of content as a résumé', () => {
    expect(parseJsonResume('{"basics":{"name":"J"}}').ok).toBe(true);
  });

  it('keeps non-Latin text byte for byte', () => {
    const result = parseJsonResume('{"basics":{"name":"李小龙","label":"Analyste — señor"}}');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.basics?.name).toBe('李小龙');
    expect(result.value.basics?.label).toBe('Analyste — señor');
  });
});

describe('parseJsonResumeBytes', () => {
  it('decodes UTF-8', () => {
    const result = parseJsonResumeBytes(utf8(FULL_RESUME_TEXT));
    expect(result.ok).toBe(true);
  });

  it('drops a leading byte-order mark', () => {
    const result = parseJsonResumeBytes(withBom(utf8(FULL_RESUME_TEXT)));
    expect(result.ok).toBe(true);
  });

  it('reports bytes that are not UTF-8 as invalid JSON', () => {
    // 0xff is never valid in UTF-8. Latin-1 "Jos\xe9" is the realistic case.
    const bytes = new Uint8Array([...utf8('{"basics":{"name":"Jos'), 0xe9, ...utf8('"}}')]);
    const result = parseJsonResumeBytes(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_JSON');
    expect(result.error.detail).toMatch(/UTF-8/);
  });

  it('reports zero bytes as invalid JSON', () => {
    const result = parseJsonResumeBytes(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_JSON');
  });
});

describe('describePath', () => {
  it('writes paths the way a person would read them', () => {
    expect(describePath([])).toBe('resume');
    expect(describePath(['basics'])).toBe('basics');
    expect(describePath(['basics', 'name'])).toBe('basics.name');
    expect(describePath(['work', 0, 'highlights', 2])).toBe('work[0].highlights[2]');
  });
});
