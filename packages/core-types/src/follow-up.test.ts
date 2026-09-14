import { describe, expect, it } from 'vitest';

import { FOLLOW_UP_JSON_SCHEMA, FollowUpDraftSchema } from './follow-up';

describe('FollowUpDraftSchema', () => {
  it('accepts a subject and a body, trimmed', () => {
    const parsed = FollowUpDraftSchema.safeParse({
      subject: '  Following up on my application  ',
      body: 'Hello,\n\nI wanted to check in.\n\nKind regards,\n',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.subject).toBe('Following up on my application');
      expect(parsed.data.body.endsWith('Kind regards,')).toBe(true);
    }
  });

  it('negative: an empty body is not a draft', () => {
    expect(FollowUpDraftSchema.safeParse({ subject: 'Hi', body: '   ' }).success).toBe(false);
  });

  it('negative: a missing subject is not a draft', () => {
    expect(FollowUpDraftSchema.safeParse({ body: 'Hello' }).success).toBe(false);
  });

  it('boundary: a one-character subject and body are enough', () => {
    expect(FollowUpDraftSchema.safeParse({ subject: 'a', body: 'b' }).success).toBe(true);
  });

  it('drops keys the shape does not have — there is nowhere for a recipient to go', () => {
    const parsed = FollowUpDraftSchema.safeParse({ subject: 'Hi', body: 'x', to: 'a@b.c' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual({ subject: 'Hi', body: 'x' });
  });
});

describe('FOLLOW_UP_JSON_SCHEMA', () => {
  it('is flat, closed, and exactly two strings', () => {
    expect(FOLLOW_UP_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...FOLLOW_UP_JSON_SCHEMA.required]).toEqual(['subject', 'body']);
    expect(Object.keys(FOLLOW_UP_JSON_SCHEMA.properties)).toEqual(['subject', 'body']);
    for (const field of Object.values(FOLLOW_UP_JSON_SCHEMA.properties)) {
      expect(field.type).toBe('string');
    }
  });

  it('negative: names no recipient, sender or address field', () => {
    const keys = Object.keys(FOLLOW_UP_JSON_SCHEMA.properties).join(' ');
    expect(keys).not.toMatch(/to|from|recipient|address|email/i);
  });
});
