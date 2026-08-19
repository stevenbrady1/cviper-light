/**
 * THE CHECKPOINT — does the locked flat schema actually hold on a small local
 * model?
 *
 * ============================================================================
 * OPT-IN. GATED ON CVIPER_OLLAMA_INTEGRATION=1.
 * ============================================================================
 * Everything else in this package runs against a fake transport and needs
 * nothing installed. This spec talks to a REAL Ollama daemon on 127.0.0.1:11434
 * and runs a real model several times, which takes minutes and requires
 * hardware. Without the environment variable it skips, so `pnpm test` stays
 * green on a machine that has never heard of Ollama.
 *
 *   CVIPER_OLLAMA_INTEGRATION=1 npx vitest run <this file>
 *
 * Optional:
 *   CVIPER_OLLAMA_MODEL=qwen2.5-coder:7b   which model to exercise
 *   CVIPER_OLLAMA_RUNS=5                   how many times (a 3B model is NOT
 *                                          deterministic in practice, even at
 *                                          temperature 0 — the KV cache and
 *                                          batching see to that, so one green
 *                                          run proves nothing)
 *
 * It also skips — loudly, not silently — when the daemon is unreachable or the
 * requested model is not pulled, because "not running" is a normal condition on
 * a developer's machine and must never look like a code failure.
 */
import process from 'node:process';

import { CvAnalysisSchema } from '@cviper/core-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { analyzeCv } from '../analyze';
import { httpOllamaTransport, probeOllama } from '../test/http-transport';
import { createOllamaProvider } from './ollama';

const ENABLED = process.env['CVIPER_OLLAMA_INTEGRATION'] === '1';
const MODEL = process.env['CVIPER_OLLAMA_MODEL'] ?? 'llama3.2:latest';
const RUNS = Number(process.env['CVIPER_OLLAMA_RUNS'] ?? '5');

/** A realistic London banking CV, of the length a real user would upload. */
const CV = `SARAH OKONKWO
London, UK | sarah.okonkwo@example.com | linkedin.com/in/sokonkwo

SUMMARY
Backend engineer with 7 years building low-latency trading and payments systems
in London investment banking. Python and Java, AWS, event-driven architecture.

EXPERIENCE

Senior Backend Engineer — Meridian Capital Markets, London (2022-present)
- Rebuilt the FX pricing service in Python 3.11 and FastAPI, cutting p99 latency
  from 240ms to 38ms and supporting 12,000 quotes per second.
- Led the migration of 40 microservices from on-premise to AWS ECS, reducing
  infrastructure spend by 31% (GBP 1.4m annually).
- Mentored four junior engineers; two promoted within 18 months.

Backend Engineer — Thornbury Payments, London (2019-2022)
- Built the settlement reconciliation engine in Java 17 and Spring Boot,
  processing 2.1 million transactions daily with 99.98% availability.
- Introduced contract testing across 9 teams, cutting integration defects by 46%.

Software Engineer — Halberd Systems, Reading (2017-2019)
- Java and Python services for retail banking clients.

SKILLS
Python, FastAPI, Django, Java, Spring Boot, AWS (ECS, Lambda, S3), Docker,
Kafka, Terraform, pytest, Git, CI/CD, event-driven architecture

EDUCATION
BSc Computer Science, University of Manchester, 2:1, 2017`;

/** A realistic advert, with the boilerplate a real posting carries. */
const JOB = `Senior Python Engineer — Payments Platform
Location: London (hybrid, 3 days on-site) | Salary: GBP 95,000 - 115,000 + bonus

We are a fast-growing payments infrastructure business processing over GBP 4bn
annually for UK and EU merchants. We are hiring a Senior Python Engineer to join
the Payments Platform team.

ESSENTIAL REQUIREMENTS
- 5+ years commercial Python, including a modern async framework
- Strong PostgreSQL: schema design, query optimisation, migrations at scale
- Production experience with Kubernetes
- Event-driven architecture, ideally with Kafka
- Experience in payments, fintech or financial services
- Excellent written communication; you will write design documents

DESIRABLE
- Go for high-throughput services
- Experience with PCI-DSS compliant environments
- Terraform and infrastructure as code
- Prior experience mentoring or leading a small team

WHAT WE OFFER
Private medical cover, 28 days holiday plus bank holidays, GBP 2,000 annual
learning budget, enhanced parental leave, cycle to work scheme.

We are an equal opportunities employer and welcome applications from all
backgrounds. To apply, send your CV via the link below.`;

interface RunRecord {
  readonly run: number;
  readonly ok: boolean;
  readonly firstAttempt: boolean;
  readonly ms: number;
  readonly score: number | null;
  readonly verdict: string | null;
  readonly strategy: string | null;
  readonly clamps: readonly string[];
  readonly failure: string | null;
}

let available = false;
let availableModels: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;

  available = await probeOllama();
  if (!available) {
    console.log('\n[ollama integration] SKIPPED — no daemon on 127.0.0.1:11434.\n');
    return;
  }

  const listed = await createOllamaProvider(httpOllamaTransport()).listModels();
  availableModels = listed.ok ? listed.value.map((model) => model.id) : [];

  if (!availableModels.includes(MODEL)) {
    console.log(
      `\n[ollama integration] SKIPPED — "${MODEL}" is not pulled. ` +
        `Available: ${availableModels.join(', ') || '(none)'}\n`,
    );
    available = false;
  }
}, 60_000);

const gate = ENABLED ? describe : describe.skip;

gate('ollama integration — real daemon', () => {
  it('lists real chat models and hides the embedding model', () => {
    if (!available) return;

    expect(availableModels.length).toBeGreaterThan(0);
    for (const id of availableModels) {
      expect(id).not.toMatch(/embed/i);
      // /api/tags returns `name:tag`; a bare family name would 404 on /api/chat.
      expect(id).toContain(':');
    }
  });

  it(
    `produces schema-valid output across ${RUNS} runs of ${MODEL}`,
    async () => {
      if (!available) return;

      const provider = createOllamaProvider(httpOllamaTransport());
      const records: RunRecord[] = [];

      for (let run = 1; run <= RUNS; run += 1) {
        const started = Date.now();
        const result = await analyzeCv({ provider, model: MODEL, cvText: CV, jobText: JOB });
        const ms = Date.now() - started;

        records.push(
          result.ok
            ? {
                run,
                ok: true,
                firstAttempt: result.value.meta.retryCount === 0,
                ms,
                score: result.value.analysis.match_score,
                verdict: result.value.analysis.verdict,
                strategy: result.value.meta.repairStrategy,
                clamps: result.value.meta.clampsApplied,
                failure: null,
              }
            : {
                run,
                ok: false,
                firstAttempt: false,
                ms,
                score: null,
                verdict: null,
                strategy: null,
                clamps: [],
                failure: `${result.error.kind}: ${result.error.message.slice(0, 160)}`,
              },
        );

        // Validate the shape independently of `analyzeCv`'s own check, so a bug
        // in the orchestrator cannot make its own output look valid.
        if (result.ok) {
          expect(CvAnalysisSchema.safeParse(result.value.analysis).success).toBe(true);
        }
      }

      const passed = records.filter((record) => record.ok);
      const firstTime = records.filter((record) => record.firstAttempt);
      const times = records.map((record) => record.ms);

      console.log(`\n========== OLLAMA CHECKPOINT: ${MODEL} ==========`);
      console.table(
        records.map((record) => ({
          run: record.run,
          ok: record.ok,
          '1st try': record.firstAttempt,
          seconds: (record.ms / 1000).toFixed(1),
          score: record.score,
          verdict: record.verdict,
          json: record.strategy,
          clamps: record.clamps.join(' ') || '-',
          failure: record.failure ?? '-',
        })),
      );
      console.log(
        `valid overall: ${passed.length}/${records.length} | ` +
          `first attempt: ${firstTime.length}/${records.length} | ` +
          `rescued by the single retry: ${passed.length - firstTime.length} | ` +
          `first call ${(times[0] ?? 0) / 1000}s, ` +
          `median ${
            ([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0) / 1000
          }s\n`,
      );

      // The contract `analyzeCv` promises: a valid analysis within one retry.
      // If a model cannot hold that, this is meant to go red — the schema is
      // locked, and softening the assertion would hide the answer this whole
      // checkpoint exists to produce.
      expect(passed).toHaveLength(records.length);
    },
    // Generous: the first call includes a cold VRAM load of 5-30 seconds, and a
    // failed run costs two full generations.
    RUNS * 180_000,
  );

  it('reports a model that was never pulled as a clear error, not a hang', async () => {
    if (!available) return;

    const result = await analyzeCv({
      provider: createOllamaProvider(httpOllamaTransport()),
      model: 'definitely-not-pulled:0b',
      cvText: CV,
      jobText: JOB,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('bad-request');
      expect(result.error.message).toMatch(/not found/i);
      // A provider-level failure must not burn the retry.
      expect(result.error.retryCount).toBe(0);
    }
  }, 60_000);
});
