/**
 * L-281 — the free check, measured on ten real UK adverts, mostly outside tech.
 *
 * ============================================================================
 * WHAT THIS GUARDS
 * ============================================================================
 * Every other test in this package asks "does this function do what its
 * comment says". None asks the question a user asks: "given a CV that fits
 * this job and one that does not, does the free check score the fitting one
 * higher?" On the tech fixtures elsewhere in this package it does. On care,
 * retail, trades and schools — most of the UK job market — it was never
 * measured until 26 Oct 2026.
 *
 * The set, under `fixtures/` so the shipped-code scans skip it as test data:
 *   - `adverts.json` — ten live UK adverts (care assistant, charity shop
 *     manager, HGV driver, teaching assistant, customer service, treasury
 *     analyst, HR coordinator, operations coordinator, data analyst, security
 *     and compliance analyst), collected 26 Oct 2026. Requirements are
 *     PARAPHRASED, not copied; `url` is the source.
 *   - `cvs/NN-good.txt`, `cvs/NN-poor.txt` — twenty INVENTED CVs, one clear
 *     fit and one clear non-fit per advert. No real person, no contact details.
 *   - `manifest.json` — who each CV is, which must-haves it meets, and why it
 *     is the good or the poor fit. Read it before arguing with a pair.
 *
 * ============================================================================
 * THE RATCHET
 * ============================================================================
 * `RIGHT_ORDER` is the number of pairs where the good fit scores strictly
 * higher. It is pinned EXACTLY, not as a minimum:
 *
 *   - It went DOWN: your change made the free check worse at telling a fitting
 *     CV from a non-fitting one. Fix the change, not this number.
 *   - It went UP: well done. Raise `RIGHT_ORDER` in the same PR, so the gain is
 *     locked in and the next change cannot quietly give it back.
 *
 * A tie counts as WRONG. A check that scores the right CV and the wrong CV the
 * same has not told the user anything.
 *
 * Baseline, main e03fd65 (26 Oct 2026): 6 of 10. The four it gets wrong:
 *   - 01 care assistant, 03 HGV driver, 04 teaching assistant — the scorer
 *     recognises none of the advert's requirements, so both CVs land on the
 *     floor-ish score and the order is noise. L-282 (UK skills list).
 *   - 10 security and compliance analyst — a health-and-safety CV ties the
 *     real analyst at 92 "strong" on shared words. L-283 and later work.
 *
 * L-282 (UK skills list): 10 of 10. Read that with care. The list was written
 * with these ten adverts in view, so this set now flatters it; it proves the
 * list fixes what it was aimed at, not that it generalises. Only adverts the
 * list's author has not seen can say that.
 */
import { describe, expect, it } from 'vitest';

import { scoreByKeywords } from '../score';
import advertsJson from './fixtures/adverts.json';
import cv01Good from './fixtures/cvs/01-good.txt?raw';
import cv01Poor from './fixtures/cvs/01-poor.txt?raw';
import cv02Good from './fixtures/cvs/02-good.txt?raw';
import cv02Poor from './fixtures/cvs/02-poor.txt?raw';
import cv03Good from './fixtures/cvs/03-good.txt?raw';
import cv03Poor from './fixtures/cvs/03-poor.txt?raw';
import cv04Good from './fixtures/cvs/04-good.txt?raw';
import cv04Poor from './fixtures/cvs/04-poor.txt?raw';
import cv05Good from './fixtures/cvs/05-good.txt?raw';
import cv05Poor from './fixtures/cvs/05-poor.txt?raw';
import cv06Good from './fixtures/cvs/06-good.txt?raw';
import cv06Poor from './fixtures/cvs/06-poor.txt?raw';
import cv07Good from './fixtures/cvs/07-good.txt?raw';
import cv07Poor from './fixtures/cvs/07-poor.txt?raw';
import cv08Good from './fixtures/cvs/08-good.txt?raw';
import cv08Poor from './fixtures/cvs/08-poor.txt?raw';
import cv09Good from './fixtures/cvs/09-good.txt?raw';
import cv09Poor from './fixtures/cvs/09-poor.txt?raw';
import cv10Good from './fixtures/cvs/10-good.txt?raw';
import cv10Poor from './fixtures/cvs/10-poor.txt?raw';
import manifestJson from './fixtures/manifest.json';

const RIGHT_ORDER = 10;

interface Advert {
  job_title: string;
  employer: string;
  location: string;
  salary: string;
  contract: string;
  sector: string;
  must_have: string[];
  nice_to_have: string[];
}

interface ManifestEntry {
  advert: string;
  file: string;
  fit: 'good' | 'poor';
}

const adverts: Advert[] = advertsJson;
const manifest = manifestJson as ManifestEntry[];

/** Imported one by one, so a missing or renamed CV fails at import, loudly. */
const CVS: Readonly<Record<string, string>> = {
  '01-good.txt': cv01Good,
  '01-poor.txt': cv01Poor,
  '02-good.txt': cv02Good,
  '02-poor.txt': cv02Poor,
  '03-good.txt': cv03Good,
  '03-poor.txt': cv03Poor,
  '04-good.txt': cv04Good,
  '04-poor.txt': cv04Poor,
  '05-good.txt': cv05Good,
  '05-poor.txt': cv05Poor,
  '06-good.txt': cv06Good,
  '06-poor.txt': cv06Poor,
  '07-good.txt': cv07Good,
  '07-poor.txt': cv07Poor,
  '08-good.txt': cv08Good,
  '08-poor.txt': cv08Poor,
  '09-good.txt': cv09Good,
  '09-poor.txt': cv09Poor,
  '10-good.txt': cv10Good,
  '10-poor.txt': cv10Poor,
};

function readCv(file: string): string {
  const text = CVS[file];
  if (text === undefined) throw new Error(`manifest names ${file}, which is not imported`);
  return text;
}

/** The advert as a user would paste it: title, essentials, then desirables. */
function advertText(a: Advert): string {
  const list = (items: string[]): string =>
    items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- None stated';
  return (
    `${a.job_title}\n${a.employer}, ${a.location}. ${a.salary}. ${a.contract}.\n\n` +
    `Essential:\n${list(a.must_have)}\n\nDesirable:\n${list(a.nice_to_have)}`
  );
}

function score(cvFile: string, advert: Advert): number {
  const result = scoreByKeywords(readCv(cvFile), advertText(advert));
  if (!result.ok) throw new Error(`${cvFile} was refused: ${result.error.code}`);
  return result.value.match_score;
}

interface Pair {
  id: string;
  sector: string;
  good: number;
  poor: number;
}

const pairs: Pair[] = adverts.map((advert, index) => {
  const id = String(index + 1).padStart(2, '0');
  const fileFor = (fit: 'good' | 'poor'): string => {
    const entry = manifest.find((m) => m.advert === id && m.fit === fit);
    if (!entry) throw new Error(`manifest has no ${fit} CV for advert ${id}`);
    return entry.file;
  };
  return {
    id,
    sector: advert.sector,
    good: score(fileFor('good'), advert),
    poor: score(fileFor('poor'), advert),
  };
});

describe('the eval set itself (a broken set must not pass vacuously)', () => {
  it('has ten adverts, each with one good and one poor CV', () => {
    expect(adverts).toHaveLength(10);
    expect(manifest).toHaveLength(20);
    for (const p of pairs) {
      expect(manifest.filter((m) => m.advert === p.id).map((m) => m.fit)).toEqual(
        expect.arrayContaining(['good', 'poor']),
      );
    }
  });

  it('every advert states at least one requirement', () => {
    for (const a of adverts) expect(a.must_have.length).toBeGreaterThan(0);
  });

  it('the manifest and the imported CVs are the same twenty files', () => {
    expect(manifest.map((m) => m.file).sort()).toEqual(Object.keys(CVS).sort());
  });

  it('every CV is long enough to be a real CV', () => {
    for (const m of manifest) expect(readCv(m.file).length).toBeGreaterThan(500);
  });
});

describe('the free check on non-tech UK adverts (L-281)', () => {
  it(`ranks the good fit strictly above the poor fit in exactly ${RIGHT_ORDER} of 10 pairs`, () => {
    const wrong = pairs
      .filter((p) => p.good <= p.poor)
      .map((p) => `${p.id} ${p.sector}: good ${p.good}, poor ${p.poor}`);
    const right = pairs.length - wrong.length;

    // The failure message names the pairs, so a red run says which advert moved.
    expect({ right, wrong }).toEqual({ right: RIGHT_ORDER, wrong: expect.any(Array) as unknown });
  });
});
