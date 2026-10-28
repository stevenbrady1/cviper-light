/**
 * The build behind the rendered contrast check (L-300) — `e2e/contrast/`,
 * production-built, the real app mounted with a stubbed IPC bridge. See
 * `e2e/contrast/harness.tsx` for what is stubbed and why that is honest.
 *
 * The same React and Tailwind plugins as the app, so the CSS axe measures is
 * the CSS the app ships: the same `@theme` tokens, the same utilities, the same
 * self-hosted fonts from the app's own `public/`.
 */
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: here('./e2e/contrast'),
  publicDir: here('./public'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: here('./e2e/contrast/dist'),
    emptyOutDir: true,
    minify: false,
    target: 'es2022',
  },
  envPrefix: ['CVIPER_HARNESS_NOTHING_'],
});
