/**
 * Three text-only ATS checks: standard section headings, CV length, and
 * contact details.
 *
 * PORTED FROM: backend/domain/cv_health_check.py  (CViper repo, @ a2369453)
 *   _check_section_headers, _check_cv_length, _check_contact_info
 *
 * ============================================================================
 * WHY THESE THREE, AND WHY FROM THIS FILE
 * ============================================================================
 * The ATS Score step (L-198) runs on TEXT: the tailored CV exists only as the
 * string the model returned. The CViper checks in `domain/ats/checks/` and
 * `domain/cv_format_check.py` read a `.docx` — heading STYLES, tables, inline
 * images — and have nothing to read here. These three are the web app's own
 * plain-text versions of the same questions, so they port with no guessing.
 *
 * The messages are the Python's, word for word, so the same CV gets the same
 * sentence in both apps. `parity.test.ts` holds every one of them.
 *
 * ============================================================================
 * KNOWN LIMITATIONS, KEPT ON PURPOSE (measured, not fixed)
 * ============================================================================
 * - Section detection is a SUBSTRING test: "experienced" counts as an
 *   Experience heading and "employment law" as Employment. That is the
 *   Python's behaviour; a port that "fixed" it would score the same CV
 *   differently in the two apps.
 * - The phone pattern accepts any 8+ digit run ("ID 12345678").
 */
import { PY_DIGIT, PY_SPACE, pySplit } from './python-regex';

export type CheckStatus = 'pass' | 'warn' | 'fail';

/** One check, shaped like the Python dict (`fix_suggestion` is absent there too). */
export interface AtsCheck {
  readonly id: 'section_headers' | 'cv_length' | 'contact_info';
  readonly label: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly category: 'structure';
}

/** `standard_headers`, in the Python's insertion order — the message lists them in it. */
const STANDARD_HEADERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'experience',
    ['experience', 'work experience', 'employment', 'professional experience', 'career history'],
  ],
  ['education', ['education', 'qualifications', 'academic']],
  ['skills', ['skills', 'technical skills', 'core competencies', 'key skills', 'competencies']],
];

/** Python's `str.title()` for the three single lowercase words above. */
function titleWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `_check_section_headers`. */
export function checkSectionHeaders(cvText: string): AtsCheck {
  const textLower = cvText.toLowerCase();
  const missing: string[] = [];
  for (const [section, variants] of STANDARD_HEADERS) {
    if (!variants.some((variant) => textLower.includes(variant))) {
      missing.push(titleWord(section));
    }
  }

  if (missing.length === 0) {
    return {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'pass',
      message: 'All standard sections (Experience, Education, Skills) found.',
      category: 'structure',
    };
  }

  return {
    id: 'section_headers',
    label: 'Standard section headers present',
    status: missing.length === 1 ? 'warn' : 'fail',
    message: `Missing section(s): ${missing.join(', ')}. Use standard headers so ATS systems can categorise your content correctly.`,
    category: 'structure',
  };
}

/** `len(cv_text.split())` — Python's whitespace, not JavaScript's. */
export function wordCount(cvText: string): number {
  return pySplit(cvText).length;
}

/** `_check_cv_length`. */
export function checkCvLength(cvText: string): AtsCheck {
  const words = wordCount(cvText);

  if (words >= 300 && words <= 1200) {
    return {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'pass',
      message: `${words} words — well within the optimal 300-1200 word range for a 1-2 page CV.`,
      category: 'structure',
    };
  }
  if (words < 300) {
    return {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message: `Only ${words} words — your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.`,
      category: 'structure',
    };
  }
  return {
    id: 'cv_length',
    label: 'CV length appropriate',
    status: 'warn',
    message: `${words} words — your CV is quite long. Most recruiters prefer 1-2 pages (400-800 words). Consider trimming older or less relevant roles.`,
    category: 'structure',
  };
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/u;

/** `(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}` with Python's `\d` and `\s`. */
const SEP = `(?:${PY_SPACE}|[.-])`;
const PHONE_RE = new RegExp(
  `(?:\\+?${PY_DIGIT}{1,3}${SEP}?)?\\(?${PY_DIGIT}{2,4}\\)?${SEP}?${PY_DIGIT}{3,4}${SEP}?${PY_DIGIT}{3,4}`,
  'u',
);

/** `_check_contact_info`. */
export function checkContactInfo(cvText: string): AtsCheck {
  const hasEmail = EMAIL_RE.test(cvText);
  const hasPhone = PHONE_RE.test(cvText);

  if (hasEmail && hasPhone) {
    return {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'pass',
      message: 'Email and phone number detected.',
      category: 'structure',
    };
  }

  const missing: string[] = [];
  if (!hasEmail) missing.push('email address');
  if (!hasPhone) missing.push('phone number');

  return {
    id: 'contact_info',
    label: 'Contact information present',
    status: 'warn',
    message: `Missing: ${missing.join(', ')}. Recruiters need to contact you — ensure both are at the top of your CV.`,
    category: 'structure',
  };
}
