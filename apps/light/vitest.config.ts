import { defineConfig } from 'vitest/config';

/**
 * A SEPARATE config from `vite.config.ts` on purpose.
 *
 * `vite.config.ts` loads the React and Tailwind 4 plugins, which the data-access
 * tests have no use for. Vitest prefers `vitest.config.ts` when both exist, so
 * the test run stays a plain Node run with nothing to build.
 *
 * The root `vitest.config.ts` lists this directory in `test.projects`. Without
 * that entry these tests are collected by nothing and `pnpm test` stays green
 * however broken the code is.
 */
export default defineConfig({
  test: {
    name: 'light',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
