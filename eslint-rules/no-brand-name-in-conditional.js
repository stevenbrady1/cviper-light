/**
 * `cviper/no-brand-name-in-conditional` (W9, coordinator review of PR #96).
 *
 * ============================================================================
 * THE DEFECT THIS PINS
 * ============================================================================
 * `tracker/extraction.ts` had:
 *
 *     `Sending the advert to ${option.kind === 'anthropic' ? 'Anthropic' : 'OpenAI'}.`
 *
 * which is correct for exactly the two cloud kinds this file was written
 * against, and silently wrong for any third one: a hypothetical Mistral or
 * Gemini option would still say "OpenAI" — a fallback that looks like a
 * reasonable default and is actually a wrong answer stated with full
 * confidence. `analysis/model.ts`'s `providerLabel()` (backed by the total,
 * keyed `PROVIDER_LABELS` table) is the fix, and this rule is what stops the
 * same shape from coming back the next time someone needs a provider's name
 * inside a branch.
 *
 * ============================================================================
 * WHY A LOOKUP TABLE IS THE RIGHT SHAPE AND A TERNARY/SWITCH IS NOT
 * ============================================================================
 * A table keyed by provider id is total by construction once every id has an
 * entry, and a linter can make "every id has an entry" checkable
 * (`providerLabel`'s own fallback to the raw string, plus
 * `providerLabel.test.ts`'s coverage, does that job). A ternary or `switch`
 * branching on provider id has no such property: it is exactly as complete as
 * whoever wrote it remembered to make it, and a brand name typed directly
 * into one of its branches is the tell that a lookup table was needed instead.
 *
 * ============================================================================
 * WHY `analysis/model.ts` IS ALLOW-LISTED
 * ============================================================================
 * `PROVIDER_LABELS` in that file IS the lookup table this rule exists to
 * push code towards — it is an object literal, not a ternary or switch, so it
 * would not match this rule's selectors anyway, but the file is named
 * explicitly so a future reader never has to work that out from the selector
 * shapes alone.
 */

/** Provider brand names this rule forbids inside a ternary or switch arm. */
const BRAND_NAMES = ['OpenAI', 'Anthropic', 'Claude', 'Gemini', 'Mistral'];

/** Matches any of `BRAND_NAMES` as a whole word, case-sensitively. */
const BRAND_PATTERN = new RegExp(`\\b(${BRAND_NAMES.join('|')})\\b`);

/** The one file this rule does not scan — see the docblock above. */
function isAllowlistedFile(filename) {
  return filename.replaceAll('\\', '/').endsWith('features/analysis/model.ts');
}

/** The brand name inside a string literal node, or `null`. */
function brandIn(node) {
  if (node?.type !== 'Literal' || typeof node.value !== 'string') return null;
  const match = BRAND_PATTERN.exec(node.value);
  return match ? match[1] : null;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Forbid a hardcoded AI provider brand name inside a ternary or switch statement; use a lookup table (analysis/model.ts providerLabel) instead.',
    },
    schema: [],
    messages: {
      brandInConditional:
        'Do not hardcode the AI provider name "{{brand}}" inside a {{shape}}. Branching on a provider id and typing its name at each branch silently gives the WRONG name to any provider the branch was not written for — use providerLabel() (analysis/model.ts) or another total, keyed lookup table instead.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAllowlistedFile(filename)) return {};

    return {
      ConditionalExpression(node) {
        for (const branch of [node.consequent, node.alternate]) {
          const brand = brandIn(branch);
          if (brand !== null) {
            context.report({
              node: branch,
              messageId: 'brandInConditional',
              data: { brand, shape: 'ternary' },
            });
          }
        }
      },

      // Every string literal anywhere in a `case` body — deliberately wider
      // than "the value the case returns", because a brand literal typed into
      // a `switch` is the same defect however it is used inside that arm
      // (returned, assigned, or interpolated).
      'SwitchCase Literal'(node) {
        const brand = brandIn(node);
        if (brand !== null) {
          context.report({
            node,
            messageId: 'brandInConditional',
            data: { brand, shape: 'switch' },
          });
        }
      },
    };
  },
};

export default rule;
