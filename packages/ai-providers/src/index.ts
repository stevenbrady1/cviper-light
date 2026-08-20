/**
 * @cviper/ai-providers — bring-your-own-key and local (Ollama) AI adapters.
 *
 * ============================================================================
 * NOTHING IN THIS PACKAGE TOUCHES THE NETWORK.
 * ============================================================================
 * Adapters build a request body and read a response body. Reaching the network
 * is the `ChatTransport`'s job, and the app injects one that `invoke()`s into
 * Rust — which is where the base URLs and the API keys live. That is why every
 * test here runs against a fake, and why a bug in this package cannot leak a
 * key: the key is never in this process.
 */
export const AI_PROVIDERS_PACKAGE = '@cviper/ai-providers' as const;

export type {
  AiProvider,
  ChatJsonRequest,
  ChatTransport,
  ModelInfo,
  ProviderError,
  ProviderErrorKind,
  ProviderHttpResponse,
  ProviderId,
} from './types';
export { providerError } from './types';

export {
  extractJson,
  safeParseJson,
  stripCodeFences,
  type ExtractJsonResult,
  type JsonFailureKind,
  type JsonParseResult,
  type RepairStrategy,
} from './extract-json';

export { clampAnalysis, type ClampResult } from './clamp';

export { clampExtraction, type ExtractionClampResult } from './extraction-clamp';

export {
  BLANK_VALUE_PATTERNS,
  NON_ANNUAL_PATTERNS,
  blankValueSalaryWording,
  hasMoneyFigure,
  nonAnnualSalaryWording,
  salaryWordingSnippet,
  type NonAnnualSalaryWording,
  type SalaryPattern,
} from './salary-wording';

export { ANALYSIS_FIELD_ORDER, reasoningFirstSchema } from './schema-order';

export {
  MAX_CV_CHARS,
  MAX_JOB_CHARS,
  buildAnalysisPrompt,
  buildRepairPrompt,
  type AnalysisPrompt,
  type AnalysisPromptInput,
} from './prompt/build-prompt';

export {
  ATS_SCORE_ANCHORS,
  FAIRNESS_GUARDRAIL,
  FIT_SCORE_ANCHORS,
  FIT_SCORE_WEIGHTS,
  JSON_ONLY,
  type PromptFragment,
} from './prompt/constants';

export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from './providers/anthropic';
export { createOpenAiProvider } from './providers/openai';
export {
  OLLAMA_DEFAULT_NUM_CTX,
  createOllamaProvider,
  type OllamaOptions,
} from './providers/ollama';

export {
  DEFAULT_MAX_OUTPUT_TOKENS,
  analyzeCv,
  type AnalysisError,
  type AnalysisMeta,
  type AnalysisSuccess,
  type AnalyzeCvOptions,
} from './analyze';

export {
  MAX_ADVERT_CHARS,
  buildExtractionPrompt,
  extractionSourceText,
  type ExtractionPrompt,
  type ExtractionPromptInput,
} from './prompt/build-extraction-prompt';

export {
  DEFAULT_MAX_EXTRACTION_TOKENS,
  extractJob,
  type ExtractJobOptions,
  type JobExtractionMeta,
  type JobExtractionOutcome,
} from './extract-job';
