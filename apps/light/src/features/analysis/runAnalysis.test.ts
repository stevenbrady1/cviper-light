/**
 * Running one analysis, whichever way the user chose.
 *
 * ============================================================================
 * THE LOAD-BEARING TEST IN THIS FILE IS `never builds a transport`.
 * ============================================================================
 * The basic match must not touch the network, and "must not" is worth nothing
 * unless something checks. The transport is INJECTED here precisely so that
 * check is possible: the keyword path is asserted never to call the factory,
 * which is a stronger statement than "no request was seen" — it says the code
 * never even got as far as being able to make one.
 */
import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { runAnalysis } from './runAnalysis';
import { providerOptions, type ProviderOption } from './providers';

const CV =
  'Credit risk analyst, eight years in London banking. SQL, Python, Basel III, ' +
  'stress testing, IFRS 9 impairment models, stakeholder reporting.';

const ADVERT =
  'Credit Risk Analyst. You will build SQL models, run stress tests and report ' +
  'on IFRS 9 impairment to the CRO. Python experience essential.';

const BASIC = providerOptions({
  ollamaRunning: false,
  ollamaModels: [],
  anthropicKey: false,
  openaiKey: false,
})[0] as ProviderOption;

const OLLAMA = providerOptions({
  ollamaRunning: true,
  ollamaModels: [{ id: 'llama3.2:3b', label: 'llama3.2:3b' }],
  anthropicKey: false,
  openaiKey: false,
})[1] as ProviderOption;

/** A `CvAnalysis` a provider might actually return, as a JSON string. */
function modelReply(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    matched_skills: ['sql', 'python'],
    missing_skills: ['sas'],
    matched_keywords: ['risk'],
    keyword_gaps: ['impairment'],
    ats_notes: ['Use a single column layout.'],
    suggestions: [
      {
        section: 'Skills',
        issue: 'No SAS.',
        recommendation: 'Add it if you have it.',
        priority: 'high',
      },
    ],
    summary: 'A close fit on the modelling side.',
    match_score: 78,
    verdict: 'weak',
    ...overrides,
  });
}

/** An Ollama `/api/chat` envelope wrapping one assistant message. */
function ollamaEnvelope(content: string): ProviderHttpResponse {
  return { status: 200, body: JSON.stringify({ message: { role: 'assistant', content } }) };
}

function fakeTransport(
  chat: (body: string) => Result<ProviderHttpResponse, ProviderError>,
): ChatTransport {
  return {
    chat: (_provider, body) => Promise.resolve(chat(body)),
    listModels: () => Promise.resolve(ok({ status: 200, body: '{"models":[]}' })),
  };
}

describe('runAnalysis — the basic match', () => {
  it('scores a CV against an advert with nothing configured', async () => {
    const createTransport = vi.fn();

    const run = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, createTransport);

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.provider).toBe('keyword');
    expect(run.value.analysis.match_score).toBeGreaterThan(0);
    expect(run.value.analysis.match_score).toBeLessThanOrEqual(100);
  });

  it('never builds a transport, so it cannot reach anything', async () => {
    const createTransport = vi.fn();

    await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, createTransport);

    expect(createTransport).not.toHaveBeenCalled();
  });

  it('records the scorer version as the model, so history stays comparable', async () => {
    const run = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());

    expect(run.ok && run.value.model).toMatch(/^keyword-v\d+$/);
  });

  it('is deterministic — the same two documents give the same score', async () => {
    const first = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());
    const second = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());

    expect(first.ok && second.ok && first.value.analysis.match_score).toBe(
      second.ok ? second.value.analysis.match_score : -1,
    );
  });

  it("passes the scorer's own refusal through, in its own words", async () => {
    const run = await runAnalysis({ option: BASIC, cvText: '', jobText: ADVERT }, vi.fn());

    expect(run.ok).toBe(false);
    if (run.ok) return;
    // The scorer is careful to say a missing CV is not a judgement on the
    // candidate. Rewriting that here would throw the care away.
    expect(run.error.message).toContain('not a judgement');
  });

  it('boundary: an advert too short to measure is refused, not scored as zero', async () => {
    const run = await runAnalysis({ option: BASIC, cvText: CV, jobText: 'Analyst' }, vi.fn());

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.message).toContain('job advert');
  });
});

describe('runAnalysis — a local model', () => {
  it('sends the CV and the advert and returns what came back', async () => {
    const createTransport = vi.fn(() => fakeTransport(() => ok(ollamaEnvelope(modelReply()))));

    const run = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, createTransport);

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.provider).toBe('ollama');
    expect(run.value.model).toBe('llama3.2:3b');
    expect(run.value.analysis.match_score).toBe(78);
    expect(createTransport).toHaveBeenCalledTimes(1);
  });

  it('overwrites the verdict the model claimed, so the two cannot contradict', async () => {
    // The reply above says 78 and "weak" in the same breath. 78 is strong.
    const run = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, () =>
      fakeTransport(() => ok(ollamaEnvelope(modelReply()))),
    );

    expect(run.ok && run.value.analysis.verdict).toBe('strong');
  });

  it('reports one repair turn rather than pretending it went smoothly', async () => {
    let call = 0;
    const run = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, () =>
      fakeTransport(() => {
        call += 1;
        return ok(ollamaEnvelope(call === 1 ? 'I think this candidate is great!' : modelReply()));
      }),
    );

    expect(run.ok && run.value.retried).toBe(true);
    expect(call).toBe(2);
  });

  it('surfaces a stopped daemon as the sentence Rust wrote for it', async () => {
    const run = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, () =>
      fakeTransport(() => ({
        ok: false,
        error: {
          provider: 'ollama',
          kind: 'not-running',
          message: 'Ollama is not running. Start it and try again.',
        },
      })),
    );

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.message).toBe('Ollama is not running. Start it and try again.');
  });

  it('does not run at all when the CV is empty, and does not call the provider', async () => {
    // The same guard as the keyword path. Spending 30 seconds of a local
    // model's time on an empty document is worse than refusing immediately.
    const createTransport = vi.fn();

    const run = await runAnalysis(
      { option: OLLAMA, cvText: '   ', jobText: ADVERT },
      createTransport,
    );

    expect(run.ok).toBe(false);
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe('runAnalysis — the ATS keyword number (L-196)', () => {
  it('attaches the keyword number on a keyword run, equal to the note in the result', async () => {
    const run = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());

    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.atsKeywordScore).toBeGreaterThanOrEqual(0);
    expect(run.value.atsKeywordScore).toBeLessThanOrEqual(100);
    expect(run.value.analysis.ats_notes[0]).toContain(
      `keyword score: ${run.value.atsKeywordScore} out of 100`,
    );
  });

  it('attaches the same number on an AI run, computed locally rather than by the model', async () => {
    const basic = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());
    const ai = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, () =>
      fakeTransport(() => ok(ollamaEnvelope(modelReply()))),
    );

    expect(ai.ok && basic.ok).toBe(true);
    if (!ai.ok || !basic.ok) return;
    expect(ai.value.atsKeywordScore).toBe(basic.value.atsKeywordScore);
  });

  it('negative: an empty CV is an error on both paths, never a zero score', async () => {
    const basic = await runAnalysis({ option: BASIC, cvText: '', jobText: ADVERT }, vi.fn());
    const ai = await runAnalysis({ option: OLLAMA, cvText: '', jobText: ADVERT }, vi.fn());

    expect(basic.ok).toBe(false);
    expect(ai.ok).toBe(false);
  });
});

describe('runAnalysis - boilerplate is stripped from the advert before analysis (L-205)', () => {
  const COOKIE =
    'We use cookies to improve your experience. Accept all cookies or manage your cookie settings.';
  const EO =
    'We are an equal opportunities employer and welcome applications from all suitable candidates regardless of age, gender, race, religion or disability.';
  const NOISY_ADVERT = `${COOKIE}\n\n${ADVERT}\n\nRequirements\n- Five years in a UK bank\n- Basel III knowledge\n\n${EO}`;

  it('sends the model the advert without the cookie notice and diversity statement', async () => {
    const bodies: string[] = [];
    const run = await runAnalysis({ option: OLLAMA, cvText: CV, jobText: NOISY_ADVERT }, () =>
      fakeTransport((body) => {
        bodies.push(body);
        return ok(ollamaEnvelope(modelReply()));
      }),
    );

    expect(run.ok).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('IFRS 9 impairment');
    expect(bodies[0]).not.toContain('cookie');
    expect(bodies[0]).not.toContain('equal opportunities');
  });

  it('negative: an advert with no boilerplate reaches the model untouched', async () => {
    const bodies: string[] = [];
    await runAnalysis({ option: OLLAMA, cvText: CV, jobText: ADVERT }, () =>
      fakeTransport((body) => {
        bodies.push(body);
        return ok(ollamaEnvelope(modelReply()));
      }),
    );

    expect(bodies[0]).toContain(ADVERT);
  });

  it('the basic match gives the same result with or without the boilerplate', async () => {
    const clean = await runAnalysis({ option: BASIC, cvText: CV, jobText: ADVERT }, vi.fn());
    const noisy = await runAnalysis({ option: BASIC, cvText: CV, jobText: NOISY_ADVERT }, vi.fn());
    const plain = await runAnalysis(
      {
        option: BASIC,
        cvText: CV,
        jobText: `${ADVERT}\n\nRequirements\n- Five years in a UK bank\n- Basel III knowledge`,
      },
      vi.fn(),
    );

    expect(clean.ok && noisy.ok && plain.ok).toBe(true);
    if (!noisy.ok || !plain.ok) return;
    expect(noisy.value.analysis).toEqual(plain.value.analysis);
    expect(noisy.value.atsKeywordScore).toBe(plain.value.atsKeywordScore);
  });
});
