/**
 * The two facts a problem report carries, and the only way it can get them.
 *
 * Both are cheap and neither touches the network. `version` asks the Tauri
 * runtime what build this is; `system` reads the user agent that is already in
 * the page. There is deliberately no third method — see the note at the top of
 * `model.ts` about what a bug report must never grow into.
 */
import { APP_VERSION } from '../backup';

import { describeSystem } from './model';

export interface ReportPort {
  /** The running build, e.g. `0.1.0`. Never throws. */
  version(): Promise<string>;
  /** The operating system and web view, in one short line. */
  system(): string;
}

export function createTauriReportPort(): ReportPort {
  return {
    async version() {
      try {
        /*
         * Imported here rather than at the top of the file so that merely
         * rendering Settings does not pull the Tauri app module into the graph.
         * `getVersion` is covered by `core:app:default`, which `core:default`
         * in `capabilities/default.json` includes, so no capability entry is
         * needed for it.
         */
        const { getVersion } = await import('@tauri-apps/api/app');
        return await getVersion();
      } catch {
        /*
         * Not a swallow: `APP_VERSION` is the SAME number by construction —
         * `backup.test.ts` reads package.json and fails the build if the two
         * disagree — so the report stays accurate. This branch is what runs in
         * a Vitest process, where there is no Tauri runtime to ask, and it is
         * what would run if the permission were ever removed. Reporting
         * "unknown" instead would lose a fact we already hold.
         */
        return APP_VERSION;
      }
    },

    system() {
      // `navigator` is absent in the `node` Vitest environment. An empty string
      // is what `describeSystem` already answers "unknown" to.
      return describeSystem(typeof navigator === 'undefined' ? '' : navigator.userAgent);
    },
  };
}
