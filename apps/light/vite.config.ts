import { defineConfig, type ServerOptions } from 'vite';
import react from '@vitejs/plugin-react';
// Tailwind 4 ships as a Vite plugin. There is deliberately no tailwind.config.js
// and no PostCSS step — theme tokens live in src/styles/theme.css.
import tailwindcss from '@tailwindcss/vite';

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
  plugins: [react(), tailwindcss()],
  // Don't let Vite wipe Rust compiler errors off the terminal.
  clearScreen: false,
  server,
});
