import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * A SEPARATE config from `vite.config.ts` on purpose.
 *
 * `vite.config.ts` carries the Tailwind 4 plugin and the pdf.js asset copier,
 * neither of which a test has any use for. Vitest prefers `vitest.config.ts`
 * when both exist, so the test run stays lean.
 *
 * The React plugin IS here, because component tests are `.tsx` and something has
 * to compile the JSX. Tailwind deliberately is NOT: no test in this app asserts
 * a computed style, and one that did would be asserting that Tailwind works
 * rather than that our code does. The design system is guarded instead by
 * `src/styles/tokens.contract.test.ts`, which reads the source text of every
 * `.tsx` file — a check that needs no browser at all.
 *
 * ENVIRONMENT: `node` by default, because most of this app is pure functions,
 * data access and transport, and jsdom costs real time to stand up. The handful
 * of component tests opt in with a `// @vitest-environment jsdom` docblock on
 * their first line. That way a slow browser environment is paid for only by the
 * files that need one.
 *
 * The root `vitest.config.ts` lists this directory in `test.projects`. Without
 * that entry these tests are collected by nothing and `pnpm test` stays green
 * however broken the code is.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'light',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
