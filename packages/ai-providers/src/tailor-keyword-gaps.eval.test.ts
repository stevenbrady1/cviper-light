/**
 * THE L-202 EVAL — do the Analysis keyword gaps make tailoring better on a
 * real local model, without making it less honest?
 *
 * ============================================================================
 * OPT-IN. GATED ON CVIPER_OLLAMA_INTEGRATION=1, LIKE ollama.integration.test.ts
 * ============================================================================
 * Talks to a REAL Ollama daemon on 127.0.0.1:11434. Without the variable it
 * skips, so `pnpm test` stays green on a machine without Ollama. It also skips,
 * loudly, when the daemon is down or the model is not pulled.
 *
 *   ollama pull llama3.1:8b
 *   CVIPER_OLLAMA_INTEGRATION=1 npx vitest run packages/ai-providers/src/tailor-keyword-gaps.eval.test.ts
 *
 * Optional:
 *   CVIPER_OLLAMA_EVAL_MODEL=llama3.1:8b   the model (8B is what the issue measures)
 *   CVIPER_OLLAMA_RUNS=1                   runs per advert, per arm
 *
 * ============================================================================
 * WHAT IS MEASURED
 * ============================================================================
 * Three CVs, each describing real experience in other words than its advert
 * uses — the case the gaps exist for. Each is tailored twice: without the
 * gaps, and with them. The gaps are worked out the way the app's basic match
 * does it (`scoreByKeywords`), minus anything it calls a missing skill.
 *
 *   coverage — `atsKeywordScore` of the rendered draft against the advert
 *   flags    — `checkFabrication` against the original CV
 *
 * Passes when total coverage goes UP with the gaps and the total number of
 * fabrication flags does NOT go up. The table is printed either way: paste it
 * into the PR.
 */
import process from 'node:process';

import { renderTailoredCv } from '@cviper/core-types';
import { atsKeywordScore, scoreByKeywords } from '@cviper/keyword-scoring';
import { beforeAll, describe, expect, it } from 'vitest';

import { checkFabrication } from './fabrication';
import { createOllamaProvider } from './providers/ollama';
import { tailorCv } from './tailor';
import { httpOllamaTransport, probeOllama } from './test/http-transport';

const ENABLED = process.env['CVIPER_OLLAMA_INTEGRATION'] === '1';
const MODEL = process.env['CVIPER_OLLAMA_EVAL_MODEL'] ?? 'llama3.1:8b';
const RUNS = Number(process.env['CVIPER_OLLAMA_RUNS'] ?? '1');

interface EvalCase {
  readonly name: string;
  readonly cv: string;
  readonly advert: string;
}

const CASES: readonly EvalCase[] = [
  {
    name: 'backend engineer',
    cv: `DANIEL REYES
Leeds, UK | daniel.reyes@example.com

SUMMARY
Backend developer with 6 years building web services for logistics and retail.

EXPERIENCE
Backend Developer — Northway Logistics, Leeds (2021-present)
- Built automated build, test and deployment pipelines in Jenkins for 14 services.
- Split the order monolith into small independently deployed services on AWS ECS.
- Worked in an Agile team with two-week sprints, daily stand-ups and retrospectives.
- Agreed delivery dates and trade-offs with the warehouse and finance managers.

Software Developer — Brightcart Retail, Manchester (2018-2021)
- Python and Django services for the online shop; reviewed teammates' code daily.
- Wrote pytest suites that took coverage of the checkout service from 40% to 85%.

SKILLS
Python, Django, PostgreSQL, Docker, AWS ECS, Jenkins, Git, pytest

EDUCATION
BSc Computer Science, University of Sheffield, 2018`,
    advert: `Python Engineer — Platform Team, Leeds (hybrid)

You will build and run Python microservices on AWS for a fast-growing logistics business.

Essential
- Commercial Python and Django or FastAPI
- CI/CD pipelines and automated testing
- Microservices architecture on AWS
- Experience working in Scrum teams
- Stakeholder management with non-technical teams
- Code review and mentoring

Desirable
- Kafka or other event streaming
- Terraform`,
  },
  {
    name: 'credit risk analyst',
    cv: `PRIYA NAIR
London | priya.nair@example.com

EXPERIENCE
Credit Risk Analyst — Harrow Bank, London (2020-present)
- Built and maintained expected credit loss models for the mortgage book in Python and SQL.
- Ran quarterly stress scenarios on the loan portfolio for the risk committee.
- Prepared regulatory capital calculations and supporting packs for the PRA return.
- Presented model results to the CRO and heads of lending every quarter.

Graduate Analyst — Fenwick Building Society, Newcastle (2018-2020)
- Monitored arrears and wrote monthly portfolio reports in Excel and SQL.

SKILLS
Python, SQL, Excel, SAS, model validation

EDUCATION
MSc Financial Mathematics, Durham University, 2018`,
    advert: `Senior Credit Risk Analyst — Retail Lending, London

Join our second-line credit risk team.

What you'll do
- Own IFRS 9 impairment models for the retail book
- Lead stress testing for ICAAP and internal scenarios
- Support Basel III capital reporting
- Stakeholder engagement with senior management and the board risk committee

What you'll bring
- Strong Python and SQL
- Model development and validation experience
- Experience with Power BI or Tableau is a plus`,
  },
  {
    name: 'marketing coordinator',
    cv: `HOLLY WATTS
Bristol | holly.watts@example.com

EXPERIENCE
Marketing Assistant — Greenleaf Garden Centres, Bristol (2022-present)
- Ran the company's Instagram, Facebook and TikTok accounts; followers grew from 4,000 to 11,500.
- Wrote and sent the weekly customer newsletter in Mailchimp to 18,000 subscribers.
- Tracked website visits and campaign results in Google Analytics and reported them monthly.
- Planned a month of posts in advance with the store managers.

Sales Assistant — Greenleaf Garden Centres, Bristol (2020-2022)
- Helped set up seasonal displays and in-store promotions.

SKILLS
Canva, Mailchimp, Google Analytics, Instagram, Facebook, TikTok

EDUCATION
BA Marketing, University of the West of England, 2020`,
    advert: `Digital Marketing Coordinator — Bristol

We are looking for a coordinator to grow our online presence.

Responsibilities
- Social media marketing across Instagram, Facebook and TikTok
- Email marketing campaigns and audience segmentation
- Own the content calendar
- Report on KPIs and campaign performance using Google Analytics
- Work with retail teams on promotions

Nice to have
- SEO experience
- HubSpot`,
  },
];

interface ArmResult {
  readonly coverage: number | null;
  readonly flags: number;
  readonly failure: string | null;
}

let available = false;

beforeAll(async () => {
  if (!ENABLED) return;
  available = await probeOllama();
  if (!available) {
    console.log('\n[L-202 eval] SKIPPED — no daemon on 127.0.0.1:11434.\n');
    return;
  }
  const listed = await createOllamaProvider(httpOllamaTransport()).listModels();
  const models = listed.ok ? listed.value.map((model) => model.id) : [];
  if (!models.includes(MODEL)) {
    console.log(
      `\n[L-202 eval] SKIPPED — "${MODEL}" is not pulled. Available: ${models.join(', ') || '(none)'}\n`,
    );
    available = false;
  }
}, 60_000);

/** The gaps the app's basic match would hand to Tailor: keyword gaps minus missing skills. */
function basicMatchGaps(cv: string, advert: string): string[] {
  const scored = scoreByKeywords(cv, advert);
  if (!scored.ok) return [];
  const missing = new Set(scored.value.missing_skills.map((skill) => skill.toLowerCase()));
  return scored.value.keyword_gaps.filter((gap) => !missing.has(gap.toLowerCase()));
}

async function arm(evalCase: EvalCase, keywordGaps: readonly string[] | null): Promise<ArmResult> {
  const result = await tailorCv({
    provider: createOllamaProvider(httpOllamaTransport()),
    model: MODEL,
    cvText: evalCase.cv,
    jobText: evalCase.advert,
    profileNotes: null,
    keywordGaps,
  });
  if (!result.ok) {
    return { coverage: null, flags: 0, failure: result.error.message.slice(0, 120) };
  }
  const draft = renderTailoredCv(result.value.cv, null);
  const coverage = atsKeywordScore(draft, evalCase.advert);
  return {
    coverage: coverage.ok ? coverage.value : null,
    flags: checkFabrication(evalCase.cv, result.value.cv).flagged.length,
    failure: null,
  };
}

const gate = ENABLED ? describe : describe.skip;

gate(`L-202 eval — keyword gaps in the Tailor prompt, on ${MODEL}`, () => {
  it(
    'coverage goes up with the gaps, and fabrication flags do not',
    async () => {
      if (!available) return;

      const rows: string[] = [];
      let coverageWithout = 0;
      let coverageWith = 0;
      let flagsWithout = 0;
      let flagsWith = 0;
      let failures = 0;

      for (const evalCase of CASES) {
        const gaps = basicMatchGaps(evalCase.cv, evalCase.advert);
        const original = atsKeywordScore(evalCase.cv, evalCase.advert);
        for (let run = 1; run <= RUNS; run += 1) {
          const without = await arm(evalCase, null);
          const withGaps = await arm(evalCase, gaps);
          if (without.failure !== null || withGaps.failure !== null) failures += 1;
          coverageWithout += without.coverage ?? 0;
          coverageWith += withGaps.coverage ?? 0;
          flagsWithout += without.flags;
          flagsWith += withGaps.flags;
          rows.push(
            `| ${evalCase.name} #${run} | ${original.ok ? original.value : '—'} | ` +
              `${without.coverage ?? 'failed'} | ${withGaps.coverage ?? 'failed'} | ` +
              `${without.flags} | ${withGaps.flags} | ${gaps.join(', ')} |`,
          );
        }
      }

      console.log(
        [
          '',
          `[L-202 eval] ${MODEL}, ${RUNS} run(s) per advert per arm`,
          '| advert | original CV | tailored, no gaps | tailored, with gaps | flags, no gaps | flags, with gaps | gaps passed |',
          '|---|---|---|---|---|---|---|',
          ...rows,
          `| **total** | | ${coverageWithout} | ${coverageWith} | ${flagsWithout} | ${flagsWith} | |`,
          '',
        ].join('\n'),
      );

      expect(failures, 'a tailoring run failed outright — see the table').toBe(0);
      expect(coverageWith).toBeGreaterThan(coverageWithout);
      expect(flagsWith).toBeLessThanOrEqual(flagsWithout);
    },
    60 * 60 * 1000,
  );
});
