/**
 * @cviper/resume-schema — the JSON Resume interchange format, read and written.
 *
 * Pure functions over text. Nothing here touches the file system, Tauri or
 * the network, and nothing throws across the boundary: every entry point that
 * can fail returns `Result<…, ResumeError>` from `@cviper/core-types`.
 */
export const RESUME_SCHEMA_PACKAGE = '@cviper/resume-schema' as const;

export {
  JsonResumeSchema,
  BasicsSchema,
  LocationSchema,
  ProfileSchema,
  WorkSchema,
  VolunteerSchema,
  EducationSchema,
  AwardSchema,
  CertificateSchema,
  PublicationSchema,
  SkillSchema,
  LanguageSchema,
  InterestSchema,
  ReferenceSchema,
  ProjectSchema,
  MetaSchema,
  CviperMetaSchema,
  RESUME_SECTION_KEYS,
  JSON_RESUME_SCHEMA_VERSION,
  type JsonResume,
  type Basics,
  type Work,
  type Volunteer,
  type Education,
  type Award,
  type Certificate,
  type Publication,
  type Skill,
  type Language,
  type Interest,
  type Reference,
  type Project,
  type CviperMeta,
  type ResumeSectionKey,
} from './schema';

export { type ResumeError, type ResumeErrorCode, MAX_ISSUES_IN_MESSAGE } from './errors';

export { parseJsonResume, parseJsonResumeBytes, describePath } from './parse';

export { flattenJsonResume } from './flatten';

export { serializeJsonResume } from './serialize';

export { stampCviperMeta } from './stamp';
