// Flat config (ESLint 9+ format). Composed with typescript-eslint's `config()` helper.
// Type-aware rules are intentionally NOT enabled in Phase 0 — see docs/PLAN.md.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

import noBrandNameInConditional from './eslint-rules/no-brand-name-in-conditional.js';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // W9, coordinator review of PR #96: a brand-name literal branching inside
    // a ternary or switch is the exact shape that misnamed a third provider
    // in `tracker/extraction.ts` (see the rule's own docblock). Scoped to
    // `apps/light/src/features/**`, where every provider-branching surface in
    // this app lives; `analysis/model.ts`'s own lookup table is exempted by
    // the rule itself, not by narrowing this glob, so the exemption is
    // documented once, in the one place a reader would look for it.
    files: ['apps/light/src/features/**/*.ts', 'apps/light/src/features/**/*.tsx'],
    plugins: {
      cviper: { rules: { 'no-brand-name-in-conditional': noBrandNameInConditional } },
    },
    rules: {
      'cviper/no-brand-name-in-conditional': 'error',
    },
  },
  prettier,
);
