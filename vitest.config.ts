import { defineConfig } from 'vitest/config';

// Vitest 4: `vitest.workspace.ts` was removed. Multi-package runs are declared
// via `test.projects` (introduced in Vitest 3.2). Installed major is 4.x, so
// this is the correct and only supported form here.
export default defineConfig({
  test: {
    // Phase 0 is a scaffold: the packages export stubs only and have no tests
    // yet. This keeps `pnpm test` honest (it really runs) rather than fake
    // (no invented placeholder tests). Phase 1 adds real coverage.
    passWithNoTests: true,
    projects: ['packages/*'],
  },
});
