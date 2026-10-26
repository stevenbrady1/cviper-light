/**
 * Vite's `?raw` import, typed (same declaration as `@cviper/job-apis`).
 *
 * The eval CVs are plain text so a human can read and rate them. `?raw` brings
 * them into the test as strings without `node:fs`, which would need
 * `@types/node` in a package that is otherwise a pure function over two
 * strings.
 */
declare module '*?raw' {
  const content: string;
  export default content;
}
