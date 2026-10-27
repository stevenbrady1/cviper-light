/**
 * The Word libraries load when a Word file is read or written, not at launch.
 *
 * `mammoth` (reading a .docx CV, with xmldom, underscore and friends) and
 * `docx` + `jszip` (Export to Word) were about 690 kB of the 1.6 MB main
 * chunk, parsed on every launch although most sessions never touch a Word
 * file. Two static imports pulled them in: `packages/cv-parsing/src/docx.ts`
 * importing `mammoth`, and `Tailor.tsx` importing `./docx`. Both now use
 * `await import(...)` at the moment they are needed, and Vite splits the code
 * into chunks of its own. pdf.js already works this way (`pdfjs.ts`).
 *
 * The guard reads the source rather than the built bundle so it runs in the
 * ordinary test loop; a static import anywhere in shipped code is what puts a
 * module in the main chunk, so that is the thing to forbid.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './repo-scan.ts';

const SHIPPED_ROOTS = [join(REPO_ROOT, 'apps', 'light', 'src'), join(REPO_ROOT, 'packages')];

/** Shipped source files: .ts/.tsx, not tests, not node_modules. */
function shippedSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...shippedSources(path));
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * Module specifiers imported STATICALLY (an `import ... from 'x'` or a bare
 * `import 'x'`), ignoring `import type`, which emits nothing.
 */
export function staticImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const pattern = /^\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (const match of code.matchAll(pattern)) found.push(match[1] ?? '');
  return found;
}

/** True for a specifier that names the Word export module or the mammoth library. */
export function isEagerWordImport(specifier: string, importer: string): boolean {
  if (specifier === 'mammoth' || specifier.startsWith('mammoth/')) return true;
  // The export module itself may import the `docx` library; nothing else may
  // import the export module statically.
  const importsExportModule =
    /(^|\/)tailor\/docx$/.test(specifier) ||
    (specifier === './docx' && /features[\\/]tailor[\\/]/.test(importer));
  return importsExportModule;
}

describe('Word code is loaded on demand', () => {
  it('no shipped file imports mammoth or the Word export module statically', () => {
    const offences: string[] = [];
    let scanned = 0;
    for (const root of SHIPPED_ROOTS) {
      for (const file of shippedSources(root)) {
        scanned += 1;
        for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
          if (isEagerWordImport(specifier, file)) {
            offences.push(`${relative(REPO_ROOT, file)} imports '${specifier}'`);
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offences).toEqual([]);
  });
});

describe('the guard itself', () => {
  it('negative: a static default import of mammoth is caught', () => {
    expect(staticImports("import mammoth from 'mammoth';")).toEqual(['mammoth']);
    expect(isEagerWordImport('mammoth', 'packages/cv-parsing/src/docx.ts')).toBe(true);
  });

  it('negative: Tailor importing ./docx statically is caught', () => {
    const src = "import { buildCvDocx } from './docx';";
    expect(staticImports(src)).toEqual(['./docx']);
    expect(isEagerWordImport('./docx', 'apps/light/src/features/tailor/Tailor.tsx')).toBe(true);
  });

  it('boundary: a dynamic import and a type-only import are not static', () => {
    expect(staticImports("const { default: m } = await import('mammoth');")).toEqual([]);
    expect(staticImports("import type { X } from './docx';")).toEqual([]);
  });

  it('boundary: a commented-out import is not read', () => {
    expect(staticImports("// import mammoth from 'mammoth';")).toEqual([]);
  });

  it('happy: the export module may use the docx library itself', () => {
    expect(isEagerWordImport('docx', 'apps/light/src/features/tailor/docx.ts')).toBe(false);
  });
});
