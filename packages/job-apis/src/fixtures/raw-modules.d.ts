/**
 * Vite's `?raw` import, typed.
 *
 * A fixture that is not JSON (the Guardian feed is RSS) has to reach a test as
 * a string. `?raw` is Vite's own mechanism and Vitest is Vite, so it works in
 * both test environments this package uses — unlike `node:fs`, which cannot
 * resolve `import.meta.url` in a jsdom file.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
