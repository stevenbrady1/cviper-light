/**
 * Test résumés. Built as objects and serialised, so a fixture is never a
 * hand-typed string that drifts from what it claims to contain.
 */

/**
 * A full résumé, one entry in every section, with an unknown key at each
 * level that another tool might have left there. Modelled on the sample at
 * jsonresume.org with the names changed.
 */
export const FULL_RESUME = {
  $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json',
  basics: {
    name: 'Jane Smith',
    label: 'Senior Credit Risk Analyst',
    image: '',
    email: 'jane@example.com',
    phone: '+44 7700 900123',
    url: 'https://janesmith.example.com',
    summary: 'Ten years modelling credit risk for UK retail banks. Python, SQL and a calm head.',
    location: {
      address: '',
      postalCode: 'EC2A 1AA',
      city: 'London',
      countryCode: 'GB',
      region: 'England',
    },
    profiles: [
      {
        network: 'LinkedIn',
        username: 'janesmith',
        url: 'https://linkedin.example.com/in/janesmith',
      },
      { network: 'GitHub', username: 'jsmith' },
    ],
    'x-pronouns': 'she/her',
  },
  work: [
    {
      name: 'Acme Bank',
      position: 'Senior Credit Risk Analyst',
      url: 'https://acme.example.com',
      startDate: '2019-03',
      endDate: '',
      summary: 'Own the IFRS 9 impairment models for the unsecured lending book.',
      highlights: [
        'Cut model run time by 40 % by moving the pipeline from SAS to Python.',
        'Led the 2023 model validation with no material findings.',
      ],
    },
    {
      name: 'Beta Building Society',
      position: 'Credit Risk Analyst',
      startDate: '2014-09',
      endDate: '2019-02',
      summary: 'Scorecard development and monitoring.',
      highlights: [],
    },
  ],
  volunteer: [
    {
      organization: 'Code Club',
      position: 'Volunteer tutor',
      startDate: '2020',
      summary: 'Weekly Python sessions for 9–11 year olds.',
      highlights: ['Wrote the club’s first data-science workbook.'],
    },
  ],
  education: [
    {
      institution: 'University of Example',
      area: 'Mathematics',
      studyType: 'BSc',
      startDate: '2011',
      endDate: '2014',
      score: 'First',
      courses: ['Statistics', 'Numerical Methods'],
    },
  ],
  awards: [
    {
      title: 'Analyst of the Year',
      date: '2022-11',
      awarder: 'Acme Bank',
      summary: 'For the SAS-to-Python migration.',
    },
  ],
  certificates: [
    { name: 'CFA Level II', date: '2018-06', issuer: 'CFA Institute' },
    { name: 'AWS Cloud Practitioner', issuer: 'Amazon' },
  ],
  publications: [
    {
      name: 'Practical IFRS 9 staging',
      publisher: 'Risk Quarterly',
      releaseDate: '2021-04',
      summary: 'A field guide to significant increase in credit risk.',
    },
  ],
  skills: [
    {
      name: 'Credit risk modelling',
      level: 'Expert',
      keywords: ['IFRS 9', 'scorecards', 'PD/LGD/EAD'],
    },
    { name: 'Python', level: 'Advanced', keywords: ['pandas', 'scikit-learn'] },
    { name: 'SQL' },
  ],
  languages: [
    { language: 'English', fluency: 'Native' },
    { language: 'French', fluency: 'Professional working' },
  ],
  interests: [{ name: 'Cycling', keywords: ['audax', 'touring'] }],
  references: [{ name: 'A. Manager', reference: 'Available on request.' }],
  projects: [
    {
      name: 'Open scorecard toolkit',
      description: 'An open-source scorecard builder.',
      highlights: ['400 GitHub stars'],
      keywords: ['Python', 'open source'],
      startDate: '2021-01',
      url: 'https://github.example.com/jsmith/scorecard',
      roles: ['Maintainer'],
      entity: 'Personal',
      type: 'application',
    },
  ],
  meta: {
    canonical: 'https://janesmith.example.com/resume.json',
    version: 'v1.0.0',
    lastModified: '2026-09-01T10:00:00',
    theme: 'elegant',
    cviper: { app: 'cviper-light', exportedAt: '2026-09-06T09:00:00Z', sourceCvId: 'cv-1' },
  },
} as const;

/** The same résumé as file text, the way a tool would write it. */
export const FULL_RESUME_TEXT = `${JSON.stringify(FULL_RESUME, null, 2)}\n`;

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** `FULL_RESUME_TEXT` with a UTF-8 byte-order mark in front, as Windows tools write. */
export function withBom(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(bytes, 3);
  return out;
}
