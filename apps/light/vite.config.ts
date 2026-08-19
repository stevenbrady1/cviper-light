import { cpSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin, type ServerOptions } from 'vite';
import react from '@vitejs/plugin-react';
// Tailwind 4 ships as a Vite plugin. There is deliberately no tailwind.config.js
// and no PostCSS step — theme tokens live in src/styles/theme.css.
import tailwindcss from '@tailwindcss/vite';

/**
 * Copy pdf.js's runtime data directories into `public/pdfjs/`.
 *
 * ==========================================================================
 * WHY THIS PLUGIN EXISTS AT ALL
 * ==========================================================================
 * pdf.js fetches character maps and font metrics BY NAME at runtime — hundreds
 * of small files it picks between depending on what a given PDF contains. They
 * cannot be `import`ed, so the bundler never sees them, so they have to be real
 * static files sitting at a known URL.
 *
 * Leaving them out is the classic pdf.js deployment bug: unset asset URLs make
 * pdf.js fetch relative to `document.baseURI`, which resolves to something
 * under `vite dev` and to nothing once the app is packaged. It works for every
 * developer and is broken for every user. See `src/parsing/pdfjs-assets.ts`.
 *
 * Copied at build time rather than committed: they are ~2.3 MB of vendored
 * binaries that nobody can review in a diff, and copying keeps them in lockstep
 * with the installed pdfjs-dist instead of drifting from it at the next bump.
 * `public/pdfjs` is therefore gitignored.
 */
function copyPdfJsAssets(): Plugin {
  // Only the data pdf.js needs to extract TEXT. `wasm/` (image decoders) and
  // `iccs/` (colour profiles) are for rendering a page, which this app never
  // does — see the note in src/parsing/pdfjs-assets.ts.
  const directories = ['cmaps', 'standard_fonts'];

  return {
    name: 'cviper-copy-pdfjs-assets',
    // `buildStart` fires for `vite dev` and `vite build` alike, so dev and the
    // packaged app are served the same files from the same place.
    buildStart() {
      const require = createRequire(import.meta.url);
      const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
      const target = fileURLToPath(new URL('./public/pdfjs', import.meta.url));

      for (const directory of directories) {
        cpSync(join(pdfjsRoot, directory), join(target, directory), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

// Set by `tauri dev` when developing against a physical device.
const host = process.env.TAURI_DEV_HOST;

// Built imperatively rather than with an inline `hmr: host ? {...} : undefined`
// because `exactOptionalPropertyTypes` rejects assigning `undefined` to an
// optional property.
const server: ServerOptions = {
  port: 5173,
  strictPort: true,
  host: host || false,
  watch: {
    // Rust sources are watched by cargo, not Vite.
    ignored: ['**/src-tauri/**'],
  },
};

if (host) {
  server.hmr = { protocol: 'ws', host, port: 5174 };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPdfJsAssets()],
  // Don't let Vite wipe Rust compiler errors off the terminal.
  clearScreen: false,
  server,
});
