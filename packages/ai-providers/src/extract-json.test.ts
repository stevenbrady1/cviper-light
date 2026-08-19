/**
 * The repair ladder is the HOT PATH here, not a safety net — CViper Light talks
 * to quantised local models, and the source it was ported from calls trailing
 * commas "common in Ollama output".
 *
 * These tests pin three things: which rung repaired the output (so a silent
 * regression in the cheap rungs is visible), the failure CLASSIFICATION (the
 * three classes get different user advice), and the known hazards that must
 * stay exactly as they are.
 */
import { describe, expect, it } from 'vitest';

import { extractJson, safeParseJson, stripCodeFences } from './extract-json';

describe('stripCodeFences', () => {
  it('returns empty input unchanged', () => {
    expect(stripCodeFences('')).toBe('');
  });

  it('unwraps a json fence', () => {
    expect(stripCodeFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('unwraps an UNTERMINATED json fence, which is what a cut-off reply looks like', () => {
    expect(stripCodeFences('```json\n{"a": 1')).toBe('{"a": 1');
  });

  it('unwraps a bare fence and drops a short alphabetic language tag', () => {
    // A language tag sits on the SAME line as the opening backticks. When the
    // tag is `json` the first branch handles it, so this exercises the second.
    expect(stripCodeFences('```text\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('keeps content when a bare fence opens straight onto a newline', () => {
    // No tag to strip, and the source deliberately does not go looking for one
    // on the next line — that line is content.
    expect(stripCodeFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('keeps a first line that is NOT a language tag', () => {
    // 15+ chars, so the source guard treats it as content, not a tag.
    const wrapped = '```\nthisisaverylongword\n{"a": 1}\n```';
    expect(stripCodeFences(wrapped)).toContain('thisisaverylongword');
  });

  it('leaves unfenced text alone', () => {
    expect(stripCodeFences('  {"a": 1}  ')).toBe('{"a": 1}');
  });
});

describe('safeParseJson — the repair rungs, in order', () => {
  it('rung 0: parses clean JSON with no repair', () => {
    const result = safeParseJson('{"match_score": 84}');
    expect(result).toMatchObject({ ok: true, strategy: 'clean', value: { match_score: 84 } });
  });

  it('rung 1: strips trailing commas', () => {
    const result = safeParseJson('{"a": 1, "b": [1, 2,],}');
    expect(result).toMatchObject({ ok: true, strategy: 'regex-repairs' });
  });

  it('rung 1: strips C-style line comments', () => {
    const result = safeParseJson('{"a": 1 // the score\n}');
    expect(result).toMatchObject({ ok: true, strategy: 'regex-repairs', value: { a: 1 } });
  });

  it('rung 1: quotes bare JavaScript-style keys', () => {
    const result = safeParseJson('{match_score: 84, verdict: "strong"}');
    expect(result).toMatchObject({
      ok: true,
      strategy: 'regex-repairs',
      value: { match_score: 84, verdict: 'strong' },
    });
  });

  it('rung 2: extracts JSON wrapped in prose', () => {
    const result = safeParseJson('Sure! Here is the analysis:\n{"a": 1}\nHope that helps.');
    expect(result).toMatchObject({ ok: true, strategy: 'substring', value: { a: 1 } });
  });

  it('rung 2 rescues the known URL hazard that rung 1 creates', () => {
    // The comment stripper is not string-aware, so it eats "https://…" from the
    // slashes onwards. That damage is confined to rung 1's working copy: rung 2
    // slices the ORIGINAL text, so the URL survives. This test exists so nobody
    // "fixes" the comment stripper without knowing what actually rescues this.
    const result = safeParseJson('{"url": "https://example.com",}');
    expect(result).toMatchObject({
      ok: true,
      strategy: 'substring',
      value: { url: 'https://example.com' },
    });
  });
});

describe('safeParseJson — failure classification', () => {
  it('classifies an empty string as empty-response', () => {
    const result = safeParseJson('');
    expect(result).toMatchObject({ ok: false, failure: 'empty-response', rawLength: 0 });
  });

  it('classifies a whitespace-only reply as empty-response', () => {
    const result = safeParseJson('   \n\t  ');
    expect(result).toMatchObject({ ok: false, failure: 'empty-response' });
    if (!result.ok) expect(result.preview).toBe('');
  });

  it('classifies prose as not-json and previews at most 200 flattened chars', () => {
    const prose = `I cannot help with that.\n${'x'.repeat(400)}`;
    const result = safeParseJson(prose);
    expect(result).toMatchObject({ ok: false, failure: 'not-json' });
    if (!result.ok) {
      expect(result.preview).toHaveLength(200);
      expect(result.preview).not.toContain('\n');
      expect(result.rawLength).toBe(prose.length);
    }
  });

  it('does NOT call prose truncated just because it mentions braces', () => {
    const result = safeParseJson('The CV uses { and } in an odd way.');
    expect(result).toMatchObject({ ok: false, failure: 'not-json' });
  });
});

describe('safeParseJson — truncation (the guard the port left open)', () => {
  // The source relied on an upstream TruncatedResponseError that CViper Light
  // does not have. Without this branch a reply cut off at the token cap is
  // reported as "the model wrote prose instead of JSON", which is both wrong
  // and sends the user off to change model when the real fix is a bigger
  // output budget or a shorter CV.

  it('classifies an object cut off mid-structure as truncated, not not-json', () => {
    const result = safeParseJson('{"match_score": 84, "matched_skills": ["Python"');
    expect(result).toMatchObject({ ok: false, failure: 'truncated' });
  });

  it('classifies a reply cut off inside a string as truncated', () => {
    const result = safeParseJson('{"summary": "You are a strong match because');
    expect(result).toMatchObject({ ok: false, failure: 'truncated' });
  });

  it('classifies a truncated reply that still had prose in front of it', () => {
    const result = safeParseJson('Here is the JSON:\n{"match_score": 84, "summary": "good');
    expect(result).toMatchObject({ ok: false, failure: 'truncated' });
  });

  it('boundary: a lone opening brace is truncated', () => {
    expect(safeParseJson('{')).toMatchObject({ ok: false, failure: 'truncated' });
  });

  it('boundary: an empty object is NOT truncated — it parses', () => {
    expect(safeParseJson('{}')).toMatchObject({ ok: true, strategy: 'clean' });
  });

  it('is not fooled by braces inside a completed string', () => {
    // `{"a": "}{"}` is legitimate JSON whose value happens to contain braces.
    // Rung 2 slices to the last '}' and recovers it, so this never reaches
    // classification at all — which is the correct outcome, and the reason the
    // depth scan has to be string-aware.
    const result = safeParseJson('{"a": "}{"} trailing garbage <');
    expect(result).toMatchObject({ ok: true, strategy: 'substring', value: { a: '}{' } });
  });

  it('classifies a complete-but-broken object as not-json, not truncated', () => {
    // Depth goes NEGATIVE rather than staying open, so the reply was not cut
    // short — it is malformed. Telling the user to raise their token budget
    // here would send them after the wrong problem.
    const result = safeParseJson('{"a": 1}} <<<');
    expect(result).toMatchObject({ ok: false, failure: 'not-json' });
  });

  it('is not fooled by an escaped quote inside a string', () => {
    const result = safeParseJson('{"a": "he said \\"hello\\""');
    expect(result).toMatchObject({ ok: false, failure: 'truncated' });
  });

  it('tells the user the reply was cut short rather than blaming the model size', () => {
    const result = safeParseJson('{"match_score": 8');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/cut off|cut short|ran out of room/i);
      expect(result.message).not.toMatch(/text instead of JSON/i);
    }
  });
});

describe('extractJson', () => {
  it('reports an absent response as empty-response, not a crash', () => {
    for (const absent of [null, undefined, '']) {
      expect(extractJson(absent)).toMatchObject({ ok: false, failure: 'empty-response' });
    }
  });

  it('strips fences before parsing', () => {
    const result = extractJson('```json\n{"match_score": 84}\n```');
    expect(result).toMatchObject({ ok: true, value: { match_score: 84 } });
  });

  it('reports missing expected keys without failing the parse', () => {
    const result = extractJson('{"match_score": 84}', ['match_score', 'summary', 'ats_notes']);
    expect(result).toMatchObject({ ok: true, missingKeys: ['summary', 'ats_notes'] });
  });

  it('reports every expected key as missing when the value is not an object', () => {
    const result = extractJson('[1, 2, 3]', ['match_score']);
    expect(result).toMatchObject({ ok: true, missingKeys: ['match_score'] });
  });

  it('classifies a fenced but truncated reply as truncated', () => {
    const result = extractJson('```json\n{"match_score": 84, "summary": "cut');
    expect(result).toMatchObject({ ok: false, failure: 'truncated' });
  });
});
