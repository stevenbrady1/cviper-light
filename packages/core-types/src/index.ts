/**
 * @cviper/core-types — the shared data model for CViper Light.
 *
 * The bottom of the dependency graph: every other package may depend on this
 * one, and this one depends on nothing but `zod`.
 */
export const CORE_TYPES_PACKAGE = '@cviper/core-types' as const;

export {
  type Analysis,
  type Application,
  type ApplicationStatus,
  type Cv,
  type ExtraFields,
  type IsoDate,
  type IsoTimestamp,
  type Job,
  type JobSource,
  type SalaryPeriod,
  AnalysisSchema,
  ApplicationSchema,
  CvSchema,
  JobSchema,
} from './entities';

export {
  CV_ANALYSIS_JSON_SCHEMA,
  CvAnalysisSchema,
  CvAnalysisSuggestionSchema,
  deriveVerdict,
  type CvAnalysis,
  type CvAnalysisSuggestion,
  type JsonSchemaNode,
  type SuggestionPriority,
  type Verdict,
} from './analysis';

export {
  BACKUP_SCHEMA_VERSION,
  exportBackup,
  importBackup,
  type BackupApp,
  type BackupError,
  type BackupErrorCode,
  type BackupPayload,
} from './backup';

export { err, isErr, isOk, ok, type Err, type Ok, type Result } from './result';
