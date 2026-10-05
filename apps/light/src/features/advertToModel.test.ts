/**
 * Every run module that hands an advert to a model strips its boilerplate
 * first (L-208), and the one that extracts fields from it does NOT.
 *
 * A fake transport records the request body; the replies are deliberately
 * useless, because only what LEFT the machine is under test.
 */
import { describe, expect, it } from 'vitest';

import { ok, type Result } from '@cviper/core-types';
import {
  type ChatTransport,
  type ProviderError,
  type ProviderHttpResponse,
} from '@cviper/ai-providers';

import { ADVERT_BODY, ADVERT_WITH_BOILERPLATE } from '../lib/advertFixtures';

import { type ProviderOption } from './analysis/providers';
import { runAnalysis } from './analysis/runAnalysis';
import { runCoverLetter } from './tailor/runCoverLetter';
import { runReview } from './tailor/runReview';
import { runTailor } from './tailor/runTailor';
import { runExtraction } from './tracker/runExtraction';
import { runFollowUp } from './tracker/runFollowUp';
import { runInterview } from './tracker/runInterview';

const OPTION: ProviderOption = {
  key: 'ollama:llama3.2',
  kind: 'ollama',
  label: 'Ollama',
  note: '',
  model: 'llama3.2:latest',
  local: true,
  needsKey: false,
};

const CV = 'Jane Doe. 8 years credit risk at Acme Bank, 2016 - Present. Cut losses by 30%.';

function recorder(): { readonly bodies: string[]; readonly factory: () => ChatTransport } {
  const bodies: string[] = [];
  return {
    bodies,
    factory: () => ({
      chat(_provider, body): Promise<Result<ProviderHttpResponse, ProviderError>> {
        bodies.push(body);
        return Promise.resolve(
          ok({ status: 200, body: JSON.stringify({ message: { content: '{}' } }) }),
        );
      },
      listModels(): Promise<Result<ProviderHttpResponse, ProviderError>> {
        throw new Error('never lists models');
      },
    }),
  };
}

type Path = (advert: string, factory: () => ChatTransport) => Promise<unknown>;

const STRIPPING_PATHS: ReadonlyArray<readonly [string, Path]> = [
  [
    'runAnalysis',
    (advert, factory) => runAnalysis({ option: OPTION, cvText: CV, jobText: advert }, factory),
  ],
  [
    'runTailor',
    (advert, factory) =>
      runTailor({ option: OPTION, cvText: CV, jobText: advert, profileNotes: null }, factory),
  ],
  [
    'runCoverLetter',
    (advert, factory) =>
      runCoverLetter(
        { option: OPTION, cvText: CV, jobText: advert, tailoredCvText: null, profileNotes: null },
        factory,
      ),
  ],
  [
    'runReview',
    (advert, factory) =>
      runReview(
        { option: OPTION, draftText: 'Draft', jobText: advert, cvText: CV, kind: 'cv' },
        factory,
      ),
  ],
  [
    'runFollowUp',
    (advert, factory) =>
      runFollowUp(
        {
          option: OPTION,
          kind: 'follow_up',
          jobTitle: 'Credit Risk Analyst',
          company: 'Barclays',
          daysQuiet: 10,
          materials: { advert, cv: CV, coverLetter: null },
          writingStyle: null,
        },
        factory,
      ),
  ],
  [
    'runInterview',
    (advert, factory) =>
      runInterview(
        {
          option: OPTION,
          input: {
            jobTitle: 'Credit Risk Analyst',
            company: 'Barclays',
            advert,
            cvText: CV,
            coverLetter: null,
            profile: { headline: null, starExamples: [], careerGoals: [] },
          },
        },
        factory,
      ),
  ],
];

describe.each(STRIPPING_PATHS)(
  '%s - the model sees the advert without its boilerplate',
  (_name, run) => {
    it('sends the real content but not the cookie banner or the EO footer', async () => {
      const t = recorder();
      await run(ADVERT_WITH_BOILERPLATE, t.factory);
      expect(t.bodies.length).toBeGreaterThan(0);
      const sent = t.bodies[0] ?? '';
      expect(sent).toContain('IFRS 9 impairment');
      expect(sent).toContain('Basel III');
      expect(sent).not.toContain('Accept all cookies');
      expect(sent).not.toContain('equal opportunities employer');
    });

    it('boundary: an advert with no boilerplate reaches the model byte-for-byte', async () => {
      const t = recorder();
      await run(ADVERT_BODY, t.factory);
      // The body is JSON, so the advert is escaped once inside it.
      expect(t.bodies[0] ?? '').toContain(JSON.stringify(ADVERT_BODY).slice(1, -1));
    });
  },
);

describe('runExtraction - deliberately NOT stripped', () => {
  // Extraction pulls company, location and salary out of the text. An agency
  // footer or "posted by" block is often the only place the hiring company or
  // a location is named, so the model gets exactly what was pasted.
  it('sends the cookie banner and footer along with the advert', async () => {
    const t = recorder();
    await runExtraction({ option: OPTION, text: ADVERT_WITH_BOILERPLATE }, t.factory);
    const sent = t.bodies[0] ?? '';
    expect(sent).toContain('Accept all cookies');
    expect(sent).toContain('equal opportunities employer');
  });
});
