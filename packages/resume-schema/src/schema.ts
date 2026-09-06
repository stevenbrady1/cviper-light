/**
 * The JSON Resume schema, version 1.0.0, as Zod.
 *
 * JSON Resume (jsonresume.org) is the one CV interchange format that more than
 * one tool speaks: CVAurum, Reactive Resume, the `resume-cli` themes and a long
 * tail of converters all read and write it. Supporting it means a CV built
 * anywhere else can be brought into CViper Light without retyping it — and,
 * later, taken out again.
 *
 * ============================================================================
 * LENIENT ON CONTENT, STRICT ON SHAPE
 * ============================================================================
 * Every field is optional, because the upstream schema makes every field
 * optional and real files omit most of them. Unknown keys are KEPT, not
 * stripped — `z.looseObject` — so a file that goes in and comes out again is
 * the same file, including whatever another tool put in it. Dates are plain
 * strings: the upstream schema says ISO 8601, exporters disagree about how
 * much of it, and refusing a CV over `2019-3` would help nobody.
 *
 * What IS enforced is that a string field holds a string and a list holds a
 * list. `"highlights": "one thing"` is a shape error, reported by path, because
 * silently coercing it hides a bug in whichever tool wrote the file.
 *
 * ============================================================================
 * `meta.cviper`
 * ============================================================================
 * The upstream `meta` object is where tools keep their own notes. CViper's go
 * under `meta.cviper`, one namespace, so nothing here can collide with another
 * tool's keys and another tool's keys survive a round trip through here.
 */
import { z } from 'zod';

const text = z.string();
const texts = z.array(z.string());

export const LocationSchema = z.looseObject({
  address: text.optional(),
  postalCode: text.optional(),
  city: text.optional(),
  countryCode: text.optional(),
  region: text.optional(),
});

export const ProfileSchema = z.looseObject({
  network: text.optional(),
  username: text.optional(),
  url: text.optional(),
});

export const BasicsSchema = z.looseObject({
  name: text.optional(),
  label: text.optional(),
  image: text.optional(),
  email: text.optional(),
  phone: text.optional(),
  url: text.optional(),
  summary: text.optional(),
  location: LocationSchema.optional(),
  profiles: z.array(ProfileSchema).optional(),
});

export const WorkSchema = z.looseObject({
  name: text.optional(),
  location: text.optional(),
  description: text.optional(),
  position: text.optional(),
  url: text.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  summary: text.optional(),
  highlights: texts.optional(),
});

export const VolunteerSchema = z.looseObject({
  organization: text.optional(),
  position: text.optional(),
  url: text.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  summary: text.optional(),
  highlights: texts.optional(),
});

export const EducationSchema = z.looseObject({
  institution: text.optional(),
  url: text.optional(),
  area: text.optional(),
  studyType: text.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  score: text.optional(),
  courses: texts.optional(),
});

export const AwardSchema = z.looseObject({
  title: text.optional(),
  date: text.optional(),
  awarder: text.optional(),
  summary: text.optional(),
});

export const CertificateSchema = z.looseObject({
  name: text.optional(),
  date: text.optional(),
  issuer: text.optional(),
  url: text.optional(),
});

export const PublicationSchema = z.looseObject({
  name: text.optional(),
  publisher: text.optional(),
  releaseDate: text.optional(),
  url: text.optional(),
  summary: text.optional(),
});

export const SkillSchema = z.looseObject({
  name: text.optional(),
  level: text.optional(),
  keywords: texts.optional(),
});

export const LanguageSchema = z.looseObject({
  language: text.optional(),
  fluency: text.optional(),
});

export const InterestSchema = z.looseObject({
  name: text.optional(),
  keywords: texts.optional(),
});

export const ReferenceSchema = z.looseObject({
  name: text.optional(),
  reference: text.optional(),
});

export const ProjectSchema = z.looseObject({
  name: text.optional(),
  description: text.optional(),
  highlights: texts.optional(),
  keywords: texts.optional(),
  startDate: text.optional(),
  endDate: text.optional(),
  url: text.optional(),
  roles: texts.optional(),
  entity: text.optional(),
  type: text.optional(),
});

/** CViper's own corner of `meta`. Every key optional; nothing here is load-bearing. */
export const CviperMetaSchema = z.looseObject({
  /** Which CViper wrote the file, e.g. `cviper-light`. */
  app: text.optional(),
  /** When it was written, ISO 8601 with offset. */
  exportedAt: text.optional(),
  /** The `cvs.id` row the file came from, so a re-import can be recognised. */
  sourceCvId: text.optional(),
});

export const MetaSchema = z.looseObject({
  canonical: text.optional(),
  version: text.optional(),
  lastModified: text.optional(),
  cviper: CviperMetaSchema.optional(),
});

export const JsonResumeSchema = z.looseObject({
  $schema: text.optional(),
  basics: BasicsSchema.optional(),
  work: z.array(WorkSchema).optional(),
  volunteer: z.array(VolunteerSchema).optional(),
  education: z.array(EducationSchema).optional(),
  awards: z.array(AwardSchema).optional(),
  certificates: z.array(CertificateSchema).optional(),
  publications: z.array(PublicationSchema).optional(),
  skills: z.array(SkillSchema).optional(),
  languages: z.array(LanguageSchema).optional(),
  interests: z.array(InterestSchema).optional(),
  references: z.array(ReferenceSchema).optional(),
  projects: z.array(ProjectSchema).optional(),
  meta: MetaSchema.optional(),
});

export type JsonResume = z.infer<typeof JsonResumeSchema>;
export type Basics = z.infer<typeof BasicsSchema>;
export type Work = z.infer<typeof WorkSchema>;
export type Volunteer = z.infer<typeof VolunteerSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Award = z.infer<typeof AwardSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type Publication = z.infer<typeof PublicationSchema>;
export type Skill = z.infer<typeof SkillSchema>;
export type Language = z.infer<typeof LanguageSchema>;
export type Interest = z.infer<typeof InterestSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type CviperMeta = z.infer<typeof CviperMetaSchema>;

/**
 * The keys that make an object a résumé rather than some other JSON.
 *
 * `meta` and `$schema` are deliberately absent: a file that is nothing but
 * `{ "meta": {} }` describes nobody. One of these, present and non-empty, is
 * what `parseJsonResume` looks for before it validates anything.
 */
export const RESUME_SECTION_KEYS = [
  'basics',
  'work',
  'volunteer',
  'education',
  'awards',
  'certificates',
  'publications',
  'skills',
  'languages',
  'interests',
  'references',
  'projects',
] as const;

export type ResumeSectionKey = (typeof RESUME_SECTION_KEYS)[number];

/** The schema URL the upstream project publishes for version 1.0.0. */
export const JSON_RESUME_SCHEMA_VERSION = 'v1.0.0' as const;
