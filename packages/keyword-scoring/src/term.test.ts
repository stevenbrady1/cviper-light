/**
 * Ported from `backend/ai/keywords.py::KeywordService.term_in_text` (line 302)
 * and the `_TOKEN_LEFT` / `_TOKEN_RIGHT` lookarounds (lines 21-22).
 */
import { describe, expect, it } from 'vitest';
import { foldSpelling } from './spelling';
import { termInFoldedText, termInText } from './term';

describe('termInText', () => {
  it('matches a plain whole token', () => {
    expect(termInText('python', 'We use Python daily')).toBe(true);
  });

  // The whole reason for the symbol-aware boundaries: plain \b cannot do these.
  it.each(['c#', '.net', 'ci/cd', 'node.js', 'c++'])('matches the symbol token %s', (term) => {
    expect(termInText(term, `Stack includes ${term} and more`)).toBe(true);
  });

  // NEGATIVE — the failure the lookarounds exist to prevent.
  it('does not match inside a longer word', () => {
    expect(termInText('go', 'an ongoing project')).toBe(false);
    expect(termInText('ai', 'always available here')).toBe(false);
    expect(termInText('java', 'strong javascript background')).toBe(false);
  });

  // NEGATIVE — a symbol token must not match its bare stem.
  it('does not match c# against a bare c', () => {
    expect(termInText('c#', 'wrote c code')).toBe(false);
  });

  it('folds plurals on a single token', () => {
    expect(termInText('developer', 'three developers')).toBe(true);
    expect(termInText('containers', 'one container')).toBe(true);
  });

  it('folds the plural on the head noun of a multi-word term, keeping adjacency', () => {
    expect(termInText('data pipeline', 'built data pipelines')).toBe(true);
    // NEGATIVE — adjacency is required; the two words apart is not a match.
    expect(termInText('market risk', 'market and credit risk')).toBe(false);
  });

  it('matches across US/UK spellings in both directions', () => {
    expect(termInText('optimisation', 'cost optimization work')).toBe(true);
    expect(termInText('optimization', 'cost optimisation work')).toBe(true);
    expect(termInText('analyse', 'we analyze data')).toBe(true);
  });

  // BOUNDARY
  it.each(['', '   '])('returns false for the empty term %j', (term) => {
    expect(termInText(term, 'anything at all')).toBe(false);
  });

  it('returns false against empty text', () => {
    expect(termInText('python', '')).toBe(false);
  });

  it('is case-insensitive on both sides', () => {
    expect(termInText('PYTHON', 'python')).toBe(true);
    expect(termInText('python', 'PYTHON')).toBe(true);
  });
});

describe('termInFoldedText', () => {
  // The fast path exists so a scan over hundreds of terms folds the haystack
  // once instead of once per term. It must agree with termInText exactly, or
  // the optimisation has changed the scoring.
  const haystack = 'We optimize pipelines with Kubernetes, C#, .NET and organized data models';

  it.each([
    'optimisation',
    'optimise',
    'kubernetes',
    'c#',
    '.net',
    'organise',
    'data model',
    'python',
    'go',
  ])('agrees with termInText for %s', (term) => {
    expect(termInFoldedText(term, foldSpelling(haystack.toLowerCase()))).toBe(
      termInText(term, haystack),
    );
  });
});
