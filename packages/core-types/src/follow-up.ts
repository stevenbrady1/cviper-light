/**
 * A follow-up or thank-you DRAFT: a subject and a body, and nothing else.
 *
 * Two strings, flat, because the model's whole job here is two strings. There
 * is no recipient, no sender and no date in the shape — the app never sends
 * anything, so a field for where it would go would be a field for a lie.
 */
import { type JsonSchemaNode } from './analysis';
import { z } from './zod';

export type FollowUpDraft = {
  subject: string;
  body: string;
};

/**
 * Trimmed and non-empty on both fields. A model that returns an empty body has
 * not written a draft, and the repair turn should say so rather than the panel
 * showing two blank boxes as if that were an answer.
 */
export const FollowUpDraftSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

type AssertAssignable<TActual extends TExpected, TExpected> = TActual;

export type _FollowUpDraftSchemaMatchesType = AssertAssignable<
  z.infer<typeof FollowUpDraftSchema>,
  FollowUpDraft
>;
export type _FollowUpDraftTypeMatchesSchema = AssertAssignable<
  FollowUpDraft,
  z.infer<typeof FollowUpDraftSchema>
>;

/** Sent to the providers' structured-output fields. Flat, two strings. */
export const FOLLOW_UP_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'body'],
  properties: {
    subject: {
      type: 'string',
      description: 'The email subject line. One line, plain text.',
    },
    body: {
      type: 'string',
      description:
        'The email text: a greeting, two or three short paragraphs, a sign-off. Plain text, ' +
        'no sender address, no date.',
    },
  },
} as const satisfies JsonSchemaNode;
