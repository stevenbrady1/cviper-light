import { describe, expect, it, vi } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { type ProviderOption } from '../analysis/providers';

import { runExtraction } from './runExtraction';

const ADVERT = 'Credit Risk Analyst\nLloyds Banking Group\nCity of London\nSalary £45,000';

const REPLY = {
  title: 'Credit Risk Analyst',
  company: 'Lloyds Banking Group',
  location: 'City of London',
  url: null,
  description: 'Second-line credit risk.',
  posted_date: null,
  salary_currency: 'GBP',
  salary_min: 45000,
  salary_max: 45000,
};

function option(overrides: Partial<ProviderOption> = {}): ProviderOption {
  return {
    key: 'ollama:llama3.2',
    kind: 'ollama',
    label: 'Ollama · llama3.2',
    note: '',
    model: 'llama3.2:latest',
    local: true,
    needsKey: false,
    ...overrides,
  };
}

/** A transport that answers with one Ollama envelope and records the call. */
function fakeTransport(json: unknown): ChatTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chat(_provider, body): Promise<Result<ProviderHttpResponse, ProviderError>> {
      calls.push(body);
      return Promise.resolve(
        ok({
          status: 200,
          body: JSON.stringify({ message: { content: JSON.stringify(json) }, done_reason: 'stop' }),
        }),
      );
    },
    listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
      throw new Error('runExtraction must never list models');
    },
  };
}

describe('runExtraction', () => {
  it('passes an extraction straight back from the provider', async () => {
    const transport = fakeTransport(REPLY);
    const outcome = await runExtraction({ option: option(), text: ADVERT }, () => transport);

    expect(outcome.available).toBe(true);
    expect(outcome.extraction.title).toBe('Credit Risk Analyst');
    expect(transport.calls).toHaveLength(1);
  });

  it('works the same through a cloud adapter', async () => {
    const transport: ChatTransport = {
      chat: () =>
        Promise.resolve(
          ok({
            status: 200,
            body: JSON.stringify({
              content: [{ type: 'text', text: JSON.stringify(REPLY) }],
              stop_reason: 'end_turn',
            }),
          }),
        ),
      listModels: () => {
        throw new Error('runExtraction must never list models');
      },
    };

    const outcome = await runExtraction(
      { option: option({ kind: 'anthropic', model: 'claude-opus-5' }), text: ADVERT },
      () => transport,
    );

    expect(outcome.available).toBe(true);
    expect(outcome.extraction.company).toBe('Lloyds Banking Group');
  });

  it('negative: the keyword option NEVER builds a transport', async () => {
    // Not "does not use one" — never constructs one. That is a stronger
    // guarantee than watching for an outbound request: it says the code could
    // not have made one.
    const factory = vi.fn<() => ChatTransport>();
    const outcome = await runExtraction(
      { option: option({ kind: 'keyword', model: null }), text: ADVERT },
      factory,
    );

    expect(factory).not.toHaveBeenCalled();
    expect(outcome.available).toBe(false);
    expect(outcome.extraction.title).toBeNull();
  });

  it('negative: an option with no model never builds a transport either', async () => {
    const factory = vi.fn<() => ChatTransport>();
    const outcome = await runExtraction({ option: option({ model: null }), text: ADVERT }, factory);

    expect(factory).not.toHaveBeenCalled();
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toBeTruthy();
  });

  it('boundary: an empty paste is refused before a transport is even used', async () => {
    const transport = fakeTransport(REPLY);
    const outcome = await runExtraction({ option: option(), text: '   ' }, () => transport);

    expect(outcome.available).toBe(false);
    expect(transport.calls).toEqual([]);
  });

  it('fails open when the daemon is not running', async () => {
    const transport: ChatTransport = {
      chat: () =>
        Promise.resolve({
          ok: false,
          error: {
            provider: 'ollama',
            kind: 'not-running',
            message: 'Ollama is not running on this machine.',
          },
        }),
      listModels: () => {
        throw new Error('unused');
      },
    };

    const outcome = await runExtraction({ option: option(), text: ADVERT }, () => transport);

    expect(outcome.available).toBe(false);
    // Passed through verbatim: the transport knew what went wrong, and
    // rewording it here would replace advice with a shrug.
    expect(outcome.reason).toBe('Ollama is not running on this machine.');
  });

  it('applies the pro-rata clamp through the whole app-level path', async () => {
    // Proves the built gap survives the layer between the component and the
    // package, not just inside the package's own tests.
    const transport = fakeTransport({ ...REPLY, salary_min: 45000, salary_max: 45000 });
    const outcome = await runExtraction(
      { option: option(), text: 'Part-time Analyst. Salary £45,000 pro rata.' },
      () => transport,
    );

    expect(outcome.extraction.salary_min).toBeNull();
    expect(outcome.meta.clampsApplied).toContain('salary:pro-rata-to-null');
  });
});
