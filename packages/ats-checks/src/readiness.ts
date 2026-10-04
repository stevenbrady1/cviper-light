/**
 * Every text-only readiness check for one CV, in one call.
 *
 * Not a port: this is the bundle the ATS Score step (L-198) renders. It adds
 * no judgement of its own and computes no combined score — each number and
 * status on screen is one the Python produces for the same text.
 */
import { scoreCvBullets, type CvBullets } from './bullets';
import {
  checkContactInfo,
  checkCvLength,
  checkSectionHeaders,
  wordCount,
  type AtsCheck,
} from './checks';

export interface AtsReadiness {
  readonly sections: AtsCheck;
  readonly contact: AtsCheck;
  readonly length: AtsCheck;
  readonly words: number;
  readonly bullets: CvBullets;
}

export function atsReadiness(cvText: string): AtsReadiness {
  const text = cvText ?? '';
  return {
    sections: checkSectionHeaders(text),
    contact: checkContactInfo(text),
    length: checkCvLength(text),
    words: wordCount(text),
    bullets: scoreCvBullets(text),
  };
}
