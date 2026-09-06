/**
 * Shared file-walking for the repository-wide contract tests
 * (`outbound-hosts`, `no-analytics-dependencies`, `no-paywall`,
 * `no-baked-in-key`).
 *
 * This is NOT a test module. The telemetry and token contracts keep private
 * copies of their three-line helpers because importing one TEST module from
 * another re-registers its whole suite under the wrong name. A plain module
 * has no suites to re-register, so the four guards that scan the same tree can
 * share one walker without that hazard — and without four walkers that drift
 * apart until one of them silently skips a directory.
 *
 * Everything here is deliberately dumb: no globbing library, no AST. The
 * guards that import it forbid LEXICAL shapes (a host in a string, a package
 * name in a manifest), and for those a walk plus a regular expression is
 * exactly as strong as anything heavier and far easier to read when it fires.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The monorepo root: `apps/light/src/lib` → four levels up. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Directories that never hold shipped source. Generated, vendored, or output. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'dist-ssr',
  'target',
  'gen',
  '.turbo',
  '.git',
  'coverage',
]);

/**
 * A test file by this repository's own naming: `*.test.ts(x)`, or anything under
 * a `test/` or `fixtures/` directory (recorded API responses are test data).
 */
export function isTestFile(path: string): boolean {
  const normalised = path.replaceAll('\\', '/');
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalised) ||
    /(^|\/)(test|tests|__tests__|fixtures|__fixtures__)\//.test(normalised)
  );
}

export interface WalkOptions {
  /** File extensions to keep, with the dot: `['.ts', '.rs']`. */
  readonly extensions: readonly string[];
  /** Drop test files (default `true`) — guards are about what SHIPS. */
  readonly excludeTests?: boolean;
}

/**
 * Every file under `directory` (recursively) with one of the extensions,
 * sorted, as absolute paths. Skips generated and vendored directories.
 */
export function walk(directory: string, options: WalkOptions): string[] {
  const excludeTests = options.excludeTests ?? true;
  const found: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(full);
        continue;
      }
      if (!options.extensions.some((extension) => entry.name.endsWith(extension))) continue;
      if (excludeTests && isTestFile(full)) continue;
      found.push(full);
    }
  };
  if (statSync(directory).isDirectory()) visit(directory);
  return found.sort();
}

/** A path relative to the repository root with forward slashes, for messages. */
export function displayPath(path: string): string {
  return relative(REPO_ROOT, path).replaceAll('\\', '/');
}

/**
 * Drop `//` line comments and `/* *\/` block comments.
 *
 * Works for TypeScript, TSX, Rust and JSON-with-comments alike — all four use
 * the same two comment shapes. Stripping can only ever HIDE a violation, never
 * invent one, and the violations these guards look for do not live in
 * comments: a host in a comment reaches nobody and a package name in a comment
 * installs nothing. What stripping buys is that a guard never fires on its own
 * documentation, which is the failure that gets a guard deleted.
 *
 * The `(^|[^:])` before `//` keeps `https://` intact.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Drop a Rust file's `#[cfg(test)]` module.
 *
 * Rust keeps unit tests in the same file as the code, conventionally at the
 * bottom under `#[cfg(test)] mod tests { … }`. Those tests legitimately name
 * hosts that must never be contacted (`evil.example.com`, cloud metadata
 * addresses) precisely to prove they are refused. Everything from the first
 * `#[cfg(test)]` to the end of the file is test code and is not shipped.
 */
export function stripRustTests(source: string): string {
  const index = source.indexOf('#[cfg(test)]');
  return index === -1 ? source : source.slice(0, index);
}

/** Source text of a file with comments (and, for Rust, tests) removed. */
export function shippedText(path: string): string {
  const raw = readFileSync(path, 'utf8');
  const withoutTests = path.endsWith('.rs') ? stripRustTests(raw) : raw;
  return stripComments(withoutTests);
}
