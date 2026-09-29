import { CV_ANALYSIS_JSON_SCHEMA } from '@cviper/core-types';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_OUTPUT_TOKENS } from '../analyze';
import { DEFAULT_MAX_COVER_LETTER_TOKENS } from '../cover-letter';
import { DEFAULT_MAX_EXTRACTION_TOKENS } from '../extract-job';
import { extractJson } from '../extract-json';
import { DEFAULT_MAX_FOLLOW_UP_TOKENS } from '../follow-up';
import { DEFAULT_MAX_INTERVIEW_TOKENS } from '../interview';
import { DEFAULT_MAX_REVIEW_TOKENS } from '../review';
import { DEFAULT_MAX_TAILOR_TOKENS } from '../tailor';
import { fakeTransport, sentBody } from '../test/fake-transport';
import type { AiProvider, ChatTransport } from '../types';
import { createAnthropicProvider } from './anthropic';
import { createChatCompletionsProvider, type ChatCompletionsProviderId } from './chat-completions';
import { createOllamaProvider } from './ollama';
import {
  MAX_WIRE_OUTPUT_TOKENS,
  REASONING_HEADROOM_TOKENS,
  REASONING_TRUNCATED_MESSAGE,
  TRUNCATED_MESSAGE,
  wireOutputCap,
} from './shared';

/**
 * L-185: a thinking model must not spend the whole answer allowance thinking.
 *
 * Gemini 3.5 Flash failed EVERY analysis in 0.4.0 with "the model ran out of
 * room". Each job asks for an answer budget sized for its JSON (2048 tokens for
 * the analysis), and a thinking model — Gemini 2.5 and later, Grok 4, OpenAI's
 * o-series and gpt-5, Magistral, much of OpenRouter — counts its hidden
 * reasoning against the same cap. The reasoning ate the budget and the JSON
 * stopped half-way.
 *
 * The fix is the same for every cloud adapter, which is why these tests loop
 * over all six rather than pinning Gemini: the cap on the wire is the answer
 * budget PLUS room to think, bounded so no model is asked for more than it
 * can return.
 */
const REQUEST = {
  model: 'any-model',
  system: 'You are a recruiter.',
  user: '=== CV ===\nJane\n=== END CV ===',
  schema: CV_ANALYSIS_JSON_SCHEMA,
  temperature: 0,
  maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
} as const;

const CHAT_COMPLETIONS = [
  'openai',
  'google',
  'mistral',
  'grok',
  'openrouter',
] as const satisfies readonly ChatCompletionsProviderId[];

const CHAT_OK = JSON.stringify({
  choices: [{ message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
});
const ANTHROPIC_OK = JSON.stringify({
  content: [{ type: 'text', text: '{}' }],
  stop_reason: 'end_turn',
});

/** Every cloud adapter, with the field its cap travels under. */
const CLOUD: readonly {
  id: string;
  make: (transport: ChatTransport) => AiProvider;
  ok: string;
  capField: string;
}[] = [
  ...CHAT_COMPLETIONS.map((id) => ({
    id,
    make: (transport: ChatTransport) => createChatCompletionsProvider(id, transport),
    ok: CHAT_OK,
    capField: id === 'openai' ? 'max_completion_tokens' : 'max_tokens',
  })),
  {
    id: 'anthropic',
    make: (transport: ChatTransport) => createAnthropicProvider(transport),
    ok: ANTHROPIC_OK,
    capField: 'max_tokens',
  },
];

describe('wireOutputCap — the answer budget plus room to think', () => {
  it('adds the reasoning headroom to the analysis budget', () => {
    expect(wireOutputCap(2048)).toBe(2048 + REASONING_HEADROOM_TOKENS);
  });

  it('boundary: never asks for more than the ceiling every default model can return', () => {
    expect(wireOutputCap(MAX_WIRE_OUTPUT_TOKENS - 1)).toBe(MAX_WIRE_OUTPUT_TOKENS);
    expect(wireOutputCap(MAX_WIRE_OUTPUT_TOKENS)).toBe(MAX_WIRE_OUTPUT_TOKENS);
  });

  it('boundary: never shrinks a budget a caller set above the ceiling', () => {
    expect(wireOutputCap(MAX_WIRE_OUTPUT_TOKENS + 1)).toBe(MAX_WIRE_OUTPUT_TOKENS + 1);
  });

  it('every job in the package gets real headroom and stays inside the ceiling', () => {
    const budgets = [
      DEFAULT_MAX_OUTPUT_TOKENS,
      DEFAULT_MAX_COVER_LETTER_TOKENS,
      DEFAULT_MAX_EXTRACTION_TOKENS,
      DEFAULT_MAX_FOLLOW_UP_TOKENS,
      DEFAULT_MAX_INTERVIEW_TOKENS,
      DEFAULT_MAX_REVIEW_TOKENS,
      DEFAULT_MAX_TAILOR_TOKENS,
    ];
    for (const budget of budgets) {
      // The whole headroom, not a sliver of it: the ceiling must never be
      // what squeezes a job's room to think.
      expect(wireOutputCap(budget)).toBe(budget + REASONING_HEADROOM_TOKENS);
      expect(wireOutputCap(budget)).toBeLessThanOrEqual(MAX_WIRE_OUTPUT_TOKENS);
    }
  });
});

describe.each(CLOUD.map((entry) => [entry.id, entry] as const))(
  '%s — the cap it sends',
  (_id, entry) => {
    it('sends the answer budget plus reasoning headroom, not the bare budget', () => {
      const transport = fakeTransport({ chat: { status: 200, body: entry.ok } });
      void entry.make(transport).chatJson(REQUEST);

      expect(sentBody(transport)[entry.capField]).toBe(wireOutputCap(REQUEST.maxOutputTokens));
    });
  },
);

describe('a thinking model that still runs out', () => {
  it.each(CHAT_COMPLETIONS)(
    '%s: says the thinking used the allowance when the usage reports reasoning tokens',
    async (id) => {
      const capped = JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"match_' }, finish_reason: 'length' }],
        usage: { completion_tokens: 10240, completion_tokens_details: { reasoning_tokens: 10200 } },
      });
      const transport = fakeTransport({ chat: { status: 200, body: capped } });
      const result = await createChatCompletionsProvider(id, transport).chatJson(REQUEST);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'truncated', message: REASONING_TRUNCATED_MESSAGE },
      });
    },
  );

  it('negative: a capped reply with NO content is truncated, not "replied without any content"', async () => {
    // What a model that thought until the cap and wrote nothing sends back.
    // Reporting it as a malformed reply would hide the one useful fact.
    for (const content of [null, '']) {
      const capped = JSON.stringify({
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'length' }],
      });
      const transport = fakeTransport({ chat: { status: 200, body: capped } });
      const result = await createChatCompletionsProvider('google', transport).chatJson(REQUEST);

      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'truncated', message: REASONING_TRUNCATED_MESSAGE },
      });
    }
  });

  it('negative: a capped reply with no sign of thinking keeps the plain message', async () => {
    const capped = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '{"match_' }, finish_reason: 'length' }],
      usage: { completion_tokens: 10240, completion_tokens_details: { reasoning_tokens: 0 } },
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createChatCompletionsProvider('mistral', transport).chatJson(REQUEST);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'truncated', message: TRUNCATED_MESSAGE },
    });
  });

  it('anthropic: a thinking block before a capped answer gets the thinking message', async () => {
    const capped = JSON.stringify({
      content: [
        { type: 'thinking', thinking: 'weighing the CV…' },
        { type: 'text', text: '{"match_' },
      ],
      stop_reason: 'max_tokens',
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createAnthropicProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'truncated', message: REASONING_TRUNCATED_MESSAGE },
    });
  });

  it('ollama: a local thinking model that runs out gets the thinking message', async () => {
    const capped = JSON.stringify({
      message: { role: 'assistant', content: '', thinking: 'Let me weigh the CV…' },
      done: true,
      done_reason: 'length',
    });
    const transport = fakeTransport({ chat: { status: 200, body: capped } });
    const result = await createOllamaProvider(transport).chatJson(REQUEST);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'truncated', message: REASONING_TRUNCATED_MESSAGE },
    });
  });
});

describe('the advice a cut-off answer gives', () => {
  it('never tells the user to raise an output limit — the app has no such setting', () => {
    const fromText = extractJson('{"match_score": 84, "summary": "cut');
    const messages = [
      TRUNCATED_MESSAGE,
      REASONING_TRUNCATED_MESSAGE,
      fromText.ok ? '' : fromText.message,
    ];
    for (const message of messages) {
      expect(message).toMatch(/ran out of room/);
      expect(message).not.toMatch(/output limit/i);
    }
  });
});
