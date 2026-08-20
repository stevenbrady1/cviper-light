/**
 * The pasted-advert extraction result — the FLAT, NINE-FIELD schema.
 *
 * PORTED FROM: c:\Dev\job-match-pro\backend\ai\schemas.py
 *   `EmailJobExtractionResult` — line 452, seventeen fields.
 *
 * ============================================================================
 * THIS IS DELIBERATELY *NOT* THE SOURCE'S SCHEMA. NINE FIELDS, NOT SEVENTEEN.
 * ============================================================================
 * The source shape exists for a server talking to a large cloud model, and it
 * carries `agency`, `recruiter_name`, `recruiter_email`, `ir35_status`,
 * `contract_type`, `contract_duration`, `notice_period`, `seniority_level`,
 * `benefits[]`, `essential_skills[]`, `desirable_skills[]` and a nested
 * `estimated_salary` object. Ours has to be produced by a 3-billion-parameter
 * quantised model running locally through Ollama, and small models fail on
 * breadth the same way they fail on nesting: seventeen fields is seventeen
 * chances to lose the thread, and the nested object is the exact shape that
 * makes one emit unparseable JSON.
 *
 * Same discipline as the CV-analysis port: TAKE THE PROMPT WISDOM, KEEP THE
 * LOCKED FLAT SHAPE. Every field here is a nullable scalar. There is no array
 * and no sub-object anywhere in this file, and `job-extraction.test.ts` asserts
 * exactly one object node exists.
 *
 * WHAT WAS LOST, AND WHY THAT IS SAFE: the source separates `company` (the end
 * client) from `agency` (the recruiter who sent the email) and its prompt
 * forbids copying one into the other. We have no `agency` field, so an agency
 * posting records the agency AS the company. That is a real loss of a
 * distinction the source considered important — and it is survivable here for
 * one reason only: THE USER REVIEWS EVERY FIELD BEFORE ANYTHING IS SAVED. A
 * wrong company in a box the user is already looking at costs a correction; the
 * same wrong company written straight to the database would cost a bad
 * decision. See `build-extraction-prompt.ts`, which says this to the model too.
 *
 * TWO REPRESENTATIONS, DELIBERATELY HAND-MAINTAINED — the same arrangement as
 * `analysis.ts`, for the same reason:
 *   1. `JobExtractionSchema`         — Zod. Validates what a provider sent.
 *   2. `JOB_EXTRACTION_JSON_SCHEMA`  — JSON Schema. Goes in Ollama's `format`
 *      and the cloud providers' structured-output slots.
 * They are NOT generated from each other, because the JSON Schema's
 * descriptions are hand-tuned instructions to a small model and that tuning
 * must not leak into runtime validation. The guard against drift is a test
 * asserting the two agree on their required-key sets. Change one, change the
 * other, in the same commit.
 */
import { z } from 'zod';

import { type IsoDate } from './entities';

export { type JsonSchemaNode, type JsonSchemaType } from './analysis';

import { type JsonSchemaNode } from './analysis';

/**
 * One advert's worth of fields, every one nullable.
 *
 * NULLABLE, NOT OPTIONAL. The key is always present; "the advert did not say"
 * is spelled `null`. That is what lets the review form render one state instead
 * of three (absent / empty string / null), and it matches the source's
 * `_normalise_email_fields`, which collapsed `""` and missing into `None` for
 * exactly this reason.
 */
export type JobExtraction = {
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  description: string | null;
  posted_date: IsoDate | null;
  /** ISO-4217, e.g. `GBP`. Never a symbol — `clampExtraction` maps `£` to it. */
  salary_currency: string | null;
  /** ANNUAL, or null. A day rate, hourly rate or pro-rata figure is never one. */
  salary_min: number | null;
  /** ANNUAL, or null. Same rule as `salary_min`. */
  salary_max: number | null;
};

/**
 * The answer when nothing could be extracted.
 *
 * The source's fail-open contract returned `fields: {}` and left the frontend to
 * work out what was missing. Naming the empty result here instead means the
 * "extraction unavailable" path and the "the advert said nothing" path produce
 * the SAME object, so the review form has one shape to render and no branch
 * where a field is simply absent.
 */
export const EMPTY_JOB_EXTRACTION: JobExtraction = {
  title: null,
  company: null,
  location: null,
  url: null,
  description: null,
  posted_date: null,
  salary_currency: null,
  salary_min: null,
  salary_max: null,
};

// --- Zod representation -----------------------------------------------------

const jobExtractionShape = {
  title: z.string().nullable(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  url: z.string().nullable(),
  description: z.string().nullable(),
  posted_date: z.string().nullable(),
  salary_currency: z.string().nullable(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
};

/**
 * LOOSE, while the JSON Schema below is closed. Not a contradiction — the same
 * split `analysis.ts` documents at length: the JSON Schema constrains what we
 * ASK for (closing it is mandatory; Anthropic rejects an open schema), and Zod
 * validates what came BACK without deleting fields it does not recognise. A
 * bigger cloud model that volunteers `ir35_status` should not have it silently
 * eaten on the way to a form the user is about to read.
 */
export const JobExtractionSchema = z.looseObject(jobExtractionShape);

/** Fails to compile if the Zod schema and the hand-written type drift apart. */
type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _JobExtractionSchemaMatchesType = AssertAssignable<
  z.infer<typeof JobExtractionSchema>,
  JobExtraction
>;
export type _JobExtractionTypeMatchesSchema = AssertAssignable<
  JobExtraction,
  z.infer<typeof JobExtractionSchema>
>;

// --- Hand-written JSON Schema representation --------------------------------

/**
 * Sent verbatim to Ollama's `format` and the cloud providers' structured-output
 * fields.
 *
 * HAND-TUNED. Descriptions are short imperatives because a 3B model treats them
 * as instructions rather than documentation. Every one of them ends by naming
 * `null` as an allowed answer, because the single most valuable behaviour in
 * this whole feature is the model declining to invent a value.
 *
 * ============================================================================
 * THE PROPERTY ORDER IS LOAD-BEARING. WHAT IT SAYS BEFORE WHAT WE WORK OUT.
 * ============================================================================
 * Every provider enforces this schema with CONSTRAINED DECODING — Ollama
 * compiles `format` into a llama.cpp grammar, OpenAI's `strict: true` and
 * Anthropic's `output_config.format` do the equivalent — and a grammar walks
 * the properties in the order declared here. Whatever is listed first is
 * emitted first, BEFORE the model has written anything it could reason from.
 * `schema-order.ts` in @cviper/ai-providers records the measurement that
 * established this on the analysis schema: the same input scored 92 with the
 * conclusion declared first and 85 with it declared last, schema-valid every
 * time. Nothing errored; the number was simply wrong.
 *
 * So the reading order below is the REASONING order:
 *
 *   1-4  title, company, location, url — copied off the page. Nothing to derive,
 *        so they cost the model no reasoning and they establish what the advert
 *        actually is before anything harder is asked.
 *   5    description — the role written out in prose, and the place the RAW
 *        salary wording is preserved. This must come before the salary numbers:
 *        writing "£500 per day, outside IR35" down is what makes the next three
 *        fields an easy `null` instead of a guess.
 *   6    posted_date — derived: "posted last Tuesday" has to become a date.
 *   7-9  salary_currency, salary_min, salary_max — the most derived fields in
 *        the schema, and the ones a wrong answer does the most damage in. Last,
 *        with the wording already on the page above them.
 *
 * `required` is listed in the same order for the same reason: it is the list a
 * grammar walks to decide what must come next.
 */
export const JOB_EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'company',
    'location',
    'url',
    'description',
    'posted_date',
    'salary_currency',
    'salary_min',
    'salary_max',
  ],
  properties: {
    title: {
      type: ['string', 'null'],
      description: 'The job title exactly as written. null if the advert does not give one.',
    },
    company: {
      type: ['string', 'null'],
      description:
        'The organisation named as hiring. If a recruitment agency posted it, use the agency ' +
        'name. null if no organisation is named at all.',
    },
    location: {
      type: ['string', 'null'],
      description:
        'Where the role is based, copied word for word. KEEP any hybrid, remote or on-site ' +
        'wording in this field. null if the advert does not say.',
    },
    url: {
      type: ['string', 'null'],
      description: 'A link to the advert if one appears in the text. null otherwise.',
    },
    description: {
      type: ['string', 'null'],
      description:
        'Two to four sentences on the role. If the advert states pay as a day rate, an hourly ' +
        'rate, pro rata, or as words like Competitive, put that wording here word for word. ' +
        'null if there is nothing to summarise.',
    },
    posted_date: {
      type: ['string', 'null'],
      description: 'The date the advert was posted, as YYYY-MM-DD. null unless a date is stated.',
    },
    salary_currency: {
      type: ['string', 'null'],
      description:
        'Three-letter currency code for the salary, e.g. GBP. null when salary_min and ' +
        'salary_max are both null.',
    },
    salary_min: {
      type: ['integer', 'null'],
      description:
        'Bottom of the YEARLY salary, as a plain number. null for a day rate, an hourly rate, ' +
        'pro rata pay, or any advert with no yearly figure.',
    },
    salary_max: {
      type: ['integer', 'null'],
      description:
        'Top of the YEARLY salary, as a plain number. Same number as salary_min if only one ' +
        'figure is given. null under the same rules as salary_min.',
    },
  },
} as const satisfies JsonSchemaNode;
