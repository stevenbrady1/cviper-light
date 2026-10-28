/**
 * L-302 — telling the user, before a run, that their CV is longer than the
 * chosen AI is sent.
 */
import { describe, expect, it } from 'vitest';

import { cvCutNote } from './cvCutNote';

const LONG = 'a'.repeat(9_000);

describe('cvCutNote (L-302)', () => {
  it('a local model: says how much is read, and that an AI company reads more', () => {
    const note = cvCutNote(LONG, 'ollama') ?? '';
    expect(note).toContain('9,000 characters');
    expect(note).toContain('first 6,000');
    expect(note).toMatch(/not read/);
    expect(note).toContain('16,000');
  });

  it('an AI company: a 9,000-character CV is read whole, so nothing is said', () => {
    expect(cvCutNote(LONG, 'anthropic')).toBeNull();
  });

  it('an AI company and a very long CV: says so, and what to do about it', () => {
    const note = cvCutNote('a'.repeat(20_000), 'openai') ?? '';
    expect(note).toContain('first 16,000');
    expect(note).toMatch(/move it higher/i);
    // It does not point at the AI company it is already using.
    expect(note).not.toMatch(/AI company's model reads up to/);
  });

  // NEGATIVE — the basic match reads the whole CV, so it never cuts.
  it('negative: the basic match never shows the note', () => {
    expect(cvCutNote('a'.repeat(50_000), 'keyword')).toBeNull();
  });

  // BOUNDARY
  it('boundary: exactly 6,000 characters says nothing; 6,001 says it', () => {
    expect(cvCutNote('a'.repeat(6_000), 'ollama')).toBeNull();
    expect(cvCutNote('a'.repeat(6_001), 'ollama')).not.toBeNull();
  });

  it.each([null, ''])('no CV text (%j), or no choice yet, says nothing', (text) => {
    expect(cvCutNote(text, 'ollama')).toBeNull();
    expect(cvCutNote(LONG, null)).toBeNull();
  });

  it('uses no jargon: no "token", "prompt" or "context"', () => {
    for (const note of [cvCutNote(LONG, 'ollama'), cvCutNote('a'.repeat(20_000), 'grok')]) {
      expect(note ?? '').not.toMatch(/token|prompt|context|truncat/i);
    }
  });
});
