/**
 * @cviper/resume-schema — the JSON Resume interchange format, read and written.
 *
 * Pure functions over text. Nothing here touches the file system, Tauri or
 * the network, and nothing throws across the boundary: every entry point that
 * can fail returns `Result<…, ResumeError>` from `@cviper/core-types`.
 */
export const RESUME_SCHEMA_PACKAGE = '@cviper/resume-schema' as const;

export {
  AwardSchema,
  BasicsSchema,
  CertificateSchema,
  CviperMetaSchema,
  EducationSchema,
  InterestSchema,
  JSON_RESUME_SCHEMA_VERSION,
  JsonResumeSchema,
  LanguageSchema,
  LocationSchema,
  MetaSchema,
  ProfileSchema,
  ProjectSchema,
  PublicationSchema,
  RESUME_SECTION_KEYS,
  ReferenceSchema,
  SkillSchema,
  VolunteerSchema,
  WorkSchema,
  type Award,
  type Basics,
  type Certificate,
  type CviperMeta,
  type Education,
  type Interest,
  type JsonResume,
  type Language,
  type Project,
  type Publication,
  type Reference,
  type ResumeSectionKey,
  type Skill,
  type Volunteer,
  type Work,
} from './schema';

export { MAX_ISSUES_IN_MESSAGE, type ResumeError, type ResumeErrorCode } from './errors';

export { describePath, parseJsonResume, parseJsonResumeBytes } from './parse';

export { flattenJsonResume } from './flatten';

export { serializeJsonResume } from './serialize';

export { stampCviperMeta } from './stamp';
