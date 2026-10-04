/**
 * PORT FIDELITY — every expectation below was produced by RUNNING the Python.
 *
 * They are not what a reasonable person would predict; they are what
 * `backend/domain/cv_health_check.py` (`_check_section_headers`,
 * `_check_cv_length`, `_check_contact_info`) and
 * `backend/domain/bullet_scorer.py` (`score_bullet`, `score_cv_bullets`)
 * actually returned, called directly from the CViper repo's `backend/`
 * directory. Several are surprising, and those are the valuable ones: if this
 * port ever "fixes" one on its own, the same CV scores differently in CViper
 * and in CViper Light, and neither number can be trusted.
 *
 * Probes for every place Python's `re` and JavaScript's disagree are
 * included: no-break, em and ideographic spaces; U+FEFF (JS whitespace, not
 * Python's); U+0085 and U+001C-U+001F (Python whitespace, not JS's);
 * Arabic-Indic digits (Python `\d`, not JS's); and two half-way means
 * (67.5 -> 68, 32.5 -> 32) for Python's half-to-even `round`.
 *
 * If a case starts failing, the port has drifted. Re-measure against the
 * Python before changing a single expectation.
 *
 * MEASURED AGAINST: CViper repo @ a2369453 (both files).
 * Upstream drift is pinned in CViper's `docs/port-parity-manifest.yaml`.
 */
import { describe, expect, it } from 'vitest';

import { scoreBullet, scoreCvBullets } from './bullets';
import { checkContactInfo, checkCvLength, checkSectionHeaders } from './checks';

interface PyCheck {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly message: string;
  readonly category: string;
}

interface PyBullet {
  readonly score: number;
  readonly has_action_verb: boolean;
  readonly has_metric: boolean;
  readonly has_outcome: boolean;
  readonly tags: readonly string[];
}

interface PyCvBullets {
  readonly total_bullets: number;
  readonly overall_score: number;
  readonly summary: { readonly strong: number; readonly adequate: number; readonly weak: number };
  readonly bullets: readonly (PyBullet & { readonly text: string })[];
}

const SECTION_CASES: readonly (readonly [string, PyCheck])[] = [
  [
    'EXPERIENCE\nEDUCATION\nSKILLS',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'pass',
      message: 'All standard sections (Experience, Education, Skills) found.',
      category: 'structure',
    },
  ],
  [
    'Work Experience\nQualifications\nCore Competencies',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'pass',
      message: 'All standard sections (Experience, Education, Skills) found.',
      category: 'structure',
    },
  ],
  [
    'Career History\nAcademic background\nKey skills',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'pass',
      message: 'All standard sections (Experience, Education, Skills) found.',
      category: 'structure',
    },
  ],
  [
    'Professional Experience and Education',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'warn',
      message:
        'Missing section(s): Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'Experience only here',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'fail',
      message:
        'Missing section(s): Education, Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    '',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'fail',
      message:
        'Missing section(s): Experience, Education, Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'Employment\nTechnical Skills',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'warn',
      message:
        'Missing section(s): Education. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'I am experienced in many things',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'fail',
      message:
        'Missing section(s): Education, Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'Upskilling programme; qualifications pending; employment law',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'warn',
      message:
        'Missing section(s): Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'Comp\u00e9tences\nExp\u00e9rience\nFormation',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'fail',
      message:
        'Missing section(s): Experience, Education, Skills. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
  [
    'SKILLS: python\nEDUCATION: BSc',
    {
      id: 'section_headers',
      label: 'Standard section headers present',
      status: 'warn',
      message:
        'Missing section(s): Experience. Use standard headers so ATS systems can categorise your content correctly.',
      category: 'structure',
    },
  ],
];

const LENGTH_CASES: readonly (readonly [string, PyCheck])[] = [
  [
    '',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 0 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    '   \n\t  ',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 0 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 1 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 299 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'pass',
      message: '300 words \u2014 well within the optimal 300-1200 word range for a 1-2 page CV.',
      category: 'structure',
    },
  ],
  [
    'word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'pass',
      message: '1200 words \u2014 well within the optimal 300-1200 word range for a 1-2 page CV.',
      category: 'structure',
    },
  ],
  [
    'word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        '1201 words \u2014 your CV is quite long. Most recruiters prefer 1-2 pages (400-800 words). Consider trimming older or less relevant roles.',
      category: 'structure',
    },
  ],
  [
    'word\u00a0word word',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 3 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'one\u2003two\u3000three',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 3 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'tab\tseparated\nlines  here',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 4 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'zero\u200bwidth joiner',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 2 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'bom\ufeffhere x',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 2 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    'nel\u0085here x',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 3 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
  [
    '\u001cfile\u001dsep x',
    {
      id: 'cv_length',
      label: 'CV length appropriate',
      status: 'warn',
      message:
        'Only 3 words \u2014 your CV may be too thin. Aim for 400-800 words with detailed achievement bullets.',
      category: 'structure',
    },
  ],
];

const CONTACT_CASES: readonly (readonly [string, PyCheck])[] = [
  [
    'jane.doe@example.co.uk\n07700 900123',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'pass',
      message: 'Email and phone number detected.',
      category: 'structure',
    },
  ],
  [
    'jane.doe@example.co.uk',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: phone number. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'Phone: +44 7700 900123',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    '',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address, phone number. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'jane@localhost and 0207 946 0000',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'Call (020) 7946-0000 or email j_d+cv@mail-server.io',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'pass',
      message: 'Email and phone number detected.',
      category: 'structure',
    },
  ],
  [
    'Started 2019, left 2021',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address, phone number. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'Revenue grew from 1200 to 3400 in 2020',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address, phone number. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'contact: jane at example dot com',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address, phone number. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'ID 12345678',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    'Tel \u0660\u0667\u0667\u0660\u0660 \u0669\u0660\u0660\u0661\u0662\u0663',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
  [
    '+1 555 123 4567 / name@domain.c',
    {
      id: 'contact_info',
      label: 'Contact information present',
      status: 'warn',
      message:
        'Missing: email address. Recruiters need to contact you \u2014 ensure both are at the top of your CV.',
      category: 'structure',
    },
  ],
];

const BULLET_CASES: readonly (readonly [string, PyBullet])[] = [
  [
    'Led a team of 5 engineers, reducing deploy time by 40%',
    { score: 100, has_action_verb: true, has_metric: true, has_outcome: true, tags: [] },
  ],
  [
    '- Responsible for the payroll system',
    {
      score: 0,
      has_action_verb: false,
      has_metric: false,
      has_outcome: false,
      tags: ['weak_verb', 'no_metric', 'no_outcome'],
    },
  ],
  [
    '\u2022 Increased revenue by \u00a32M, resulting in record profit',
    { score: 100, has_action_verb: true, has_metric: true, has_outcome: true, tags: [] },
  ],
  [
    '1. Built a 3x faster pipeline',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    '2) Re-engineered the billing engine',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    're-engineered. the billing engine',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Optimised queries',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'optimized queries saving 10 hours a week',
    { score: 100, has_action_verb: true, has_metric: true, has_outcome: true, tags: [] },
  ],
  [
    'Helped the team deliver 500+ releases',
    {
      score: 35,
      has_action_verb: false,
      has_metric: true,
      has_outcome: false,
      tags: ['weak_verb', 'no_outcome'],
    },
  ],
  [
    'Managed $500k budget',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Drove 10\u00d7 growth',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Delivered over 99.9 % uptime',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Launched 3 products in 2 years',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Migrated 1,000+ customers',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Was involved in improving onboarding',
    {
      score: 30,
      has_action_verb: false,
      has_metric: false,
      has_outcome: true,
      tags: ['weak_verb', 'no_metric'],
    },
  ],
  [
    'Spearheaded the move to Kubernetes, enabling weekly releases',
    { score: 65, has_action_verb: true, has_metric: false, has_outcome: true, tags: ['no_metric'] },
  ],
  [
    '',
    { score: 0, has_action_verb: false, has_metric: false, has_outcome: false, tags: ['empty'] },
  ],
  [
    '   ',
    { score: 0, has_action_verb: false, has_metric: false, has_outcome: false, tags: ['empty'] },
  ],
  [
    '*   Reduced churn',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    '\u2013 Streamlined month-end close',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Achieved',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Architected: event bus',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Supervised 12 staff',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Grew ARR to 2m',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Grew ARR to 2 million',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Cut costs 5k/month',
    {
      score: 35,
      has_action_verb: false,
      has_metric: true,
      has_outcome: false,
      tags: ['weak_verb', 'no_outcome'],
    },
  ],
  [
    'Created reports for stakeholders',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Introduced caf\u00e9 rewards scheme generating 25 % uplift',
    { score: 100, has_action_verb: true, has_metric: true, has_outcome: true, tags: [] },
  ],
  [
    'Upgraded 4 servers',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Resolved 300 tickets per week',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Unified 2 CRMs',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'LED the migration',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Implemented SSO',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    'Led \u0665\u0660 engineers',
    {
      score: 70,
      has_action_verb: true,
      has_metric: true,
      has_outcome: false,
      tags: ['no_outcome'],
    },
  ],
  [
    'Built\u00a0dashboards',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
  [
    '\u00a0- Led migration',
    {
      score: 35,
      has_action_verb: true,
      has_metric: false,
      has_outcome: false,
      tags: ['no_metric', 'no_outcome'],
    },
  ],
];

const CV_CASES: readonly (readonly [string, PyCvBullets])[] = [
  [
    '',
    {
      total_bullets: 0,
      overall_score: 0,
      summary: { strong: 0, adequate: 0, weak: 0 },
      bullets: [],
    },
  ],
  [
    'No bullets in this CV at all.\nJust prose.',
    {
      total_bullets: 0,
      overall_score: 0,
      summary: { strong: 0, adequate: 0, weak: 0 },
      bullets: [],
    },
  ],
  [
    'Experience\n- Led a team of 5 engineers, reducing deploy time by 40%\n- Responsible for payroll\n\u2022 Built dashboards',
    {
      total_bullets: 3,
      overall_score: 45,
      summary: { strong: 1, adequate: 0, weak: 2 },
      bullets: [
        {
          text: 'Led a team of 5 engineers, reducing deploy time by 40%',
          score: 100,
          has_action_verb: true,
          has_metric: true,
          has_outcome: true,
          tags: [],
        },
        {
          text: 'Responsible for payroll',
          score: 0,
          has_action_verb: false,
          has_metric: false,
          has_outcome: false,
          tags: ['weak_verb', 'no_metric', 'no_outcome'],
        },
        {
          text: 'Built dashboards',
          score: 35,
          has_action_verb: true,
          has_metric: false,
          has_outcome: false,
          tags: ['no_metric', 'no_outcome'],
        },
      ],
    },
  ],
  [
    '- Achieved targets\n- Achieved 50% growth\n- Increased sales, driving growth\n- Helped',
    {
      total_bullets: 4,
      overall_score: 42,
      summary: { strong: 0, adequate: 2, weak: 2 },
      bullets: [
        {
          text: 'Achieved targets',
          score: 35,
          has_action_verb: true,
          has_metric: false,
          has_outcome: false,
          tags: ['no_metric', 'no_outcome'],
        },
        {
          text: 'Achieved 50% growth',
          score: 70,
          has_action_verb: true,
          has_metric: true,
          has_outcome: false,
          tags: ['no_outcome'],
        },
        {
          text: 'Increased sales, driving growth',
          score: 65,
          has_action_verb: true,
          has_metric: false,
          has_outcome: true,
          tags: ['no_metric'],
        },
        {
          text: 'Helped',
          score: 0,
          has_action_verb: false,
          has_metric: false,
          has_outcome: false,
          tags: ['weak_verb', 'no_metric', 'no_outcome'],
        },
      ],
    },
  ],
  [
    '- Led migration\n- Led 5 engineers, delivering 40% savings',
    {
      total_bullets: 2,
      overall_score: 68,
      summary: { strong: 1, adequate: 0, weak: 1 },
      bullets: [
        {
          text: 'Led migration',
          score: 35,
          has_action_verb: true,
          has_metric: false,
          has_outcome: false,
          tags: ['no_metric', 'no_outcome'],
        },
        {
          text: 'Led 5 engineers, delivering 40% savings',
          score: 100,
          has_action_verb: true,
          has_metric: true,
          has_outcome: true,
          tags: [],
        },
      ],
    },
  ],
  [
    '- Led 5 engineers\n- Led 5 engineers, delivering 40% savings',
    {
      total_bullets: 2,
      overall_score: 85,
      summary: { strong: 1, adequate: 1, weak: 0 },
      bullets: [
        {
          text: 'Led 5 engineers',
          score: 70,
          has_action_verb: true,
          has_metric: true,
          has_outcome: false,
          tags: ['no_outcome'],
        },
        {
          text: 'Led 5 engineers, delivering 40% savings',
          score: 100,
          has_action_verb: true,
          has_metric: true,
          has_outcome: true,
          tags: [],
        },
      ],
    },
  ],
  [
    '1. Built X\n2. Built 3x Y\n3) Built 3x Y, enabling Z\n   - Delivered 10 releases',
    {
      total_bullets: 4,
      overall_score: 69,
      summary: { strong: 1, adequate: 2, weak: 1 },
      bullets: [
        {
          text: 'Built X',
          score: 35,
          has_action_verb: true,
          has_metric: false,
          has_outcome: false,
          tags: ['no_metric', 'no_outcome'],
        },
        {
          text: 'Built 3x Y',
          score: 70,
          has_action_verb: true,
          has_metric: true,
          has_outcome: false,
          tags: ['no_outcome'],
        },
        {
          text: 'Built 3x Y, enabling Z',
          score: 100,
          has_action_verb: true,
          has_metric: true,
          has_outcome: true,
          tags: [],
        },
        {
          text: 'Delivered 10 releases',
          score: 70,
          has_action_verb: true,
          has_metric: true,
          has_outcome: false,
          tags: ['no_outcome'],
        },
      ],
    },
  ],
  [
    '-NoSpaceAfterDash so not a bullet\n- real bullet improving 20%',
    {
      total_bullets: 1,
      overall_score: 65,
      summary: { strong: 0, adequate: 1, weak: 0 },
      bullets: [
        {
          text: 'real bullet improving 20%',
          score: 65,
          has_action_verb: false,
          has_metric: true,
          has_outcome: true,
          tags: ['weak_verb'],
        },
      ],
    },
  ],
  [
    '- Spearheaded Kubernetes, enabling X\n- Helped',
    {
      total_bullets: 2,
      overall_score: 32,
      summary: { strong: 0, adequate: 1, weak: 1 },
      bullets: [
        {
          text: 'Spearheaded Kubernetes, enabling X',
          score: 65,
          has_action_verb: true,
          has_metric: false,
          has_outcome: true,
          tags: ['no_metric'],
        },
        {
          text: 'Helped',
          score: 0,
          has_action_verb: false,
          has_metric: false,
          has_outcome: false,
          tags: ['weak_verb', 'no_metric', 'no_outcome'],
        },
      ],
    },
  ],
];

function asPy(result: ReturnType<typeof scoreBullet>): PyBullet {
  return {
    score: result.score,
    has_action_verb: result.hasActionVerb,
    has_metric: result.hasMetric,
    has_outcome: result.hasOutcome,
    tags: result.tags,
  };
}

describe('parity with cv_health_check.py — text checks', () => {
  it.each(SECTION_CASES)('_check_section_headers(%j)', (text, expected) => {
    expect(checkSectionHeaders(text)).toEqual(expected);
  });

  it.each(LENGTH_CASES)('_check_cv_length(%j)', (text, expected) => {
    expect(checkCvLength(text)).toEqual(expected);
  });

  it.each(CONTACT_CASES)('_check_contact_info(%j)', (text, expected) => {
    expect(checkContactInfo(text)).toEqual(expected);
  });
});

describe('parity with bullet_scorer.py', () => {
  it.each(BULLET_CASES)('score_bullet(%j)', (text, expected) => {
    expect(asPy(scoreBullet(text))).toEqual(expected);
  });

  it.each(CV_CASES)('score_cv_bullets(%j)', (text, expected) => {
    const result = scoreCvBullets(text);
    expect({
      total_bullets: result.totalBullets,
      overall_score: result.overallScore,
      summary: result.summary,
      bullets: result.bullets.map((bullet) => ({ text: bullet.text, ...asPy(bullet) })),
    }).toEqual(expected);
  });
});

describe('the measurements are not vacuous', () => {
  it('every case table is populated, and every status the Python can return appears', () => {
    for (const table of [SECTION_CASES, LENGTH_CASES, CONTACT_CASES, BULLET_CASES, CV_CASES]) {
      expect(table.length).toBeGreaterThan(5);
    }
    const statuses = new Set(
      [...SECTION_CASES, ...LENGTH_CASES, ...CONTACT_CASES].map(([, r]) => r.status),
    );
    expect(statuses).toEqual(new Set(['pass', 'warn', 'fail']));
  });

  it('the half-to-even probes are present (Math.round would get both wrong)', () => {
    const means = CV_CASES.map(([, r]) => r.overall_score);
    expect(means).toContain(68);
    expect(means).toContain(32);
  });
});
