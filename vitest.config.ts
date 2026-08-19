import { defineConfig } from 'vitest/config';

// Vitest 4: `vitest.workspace.ts` was removed. Multi-package runs are declared
// via `test.projects` (introduced in Vitest 3.2). Installed major is 4.x, so
// this is the correct and only supported form here.
export default defineConfig({
  test: {
    // The stub packages (ai-providers, job-apis, cv-parsing, ui) still export
    // nothing but a name, so they legitimately have no tests. core-types and
    // apps/light do, and a project that has real logic must have real tests
    // with it.
    passWithNoTests: true,
    projects: ['packages/*', 'apps/light'],
  },
});
