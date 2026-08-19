# CLAUDE.md — @cviper/cv-parsing

CV ingestion and text extraction. Runs fully locally.

Root rules in [../../CLAUDE.md](../../CLAUDE.md) apply in full. The HARD RULES
there are not negotiable from inside this package.

## This package is source-only

No `build` script. No `dist`. No compiled output — ever. Consumers import
`src/index.ts` directly; Vite compiles it, `tsc --noEmit` typechecks it,
Vitest runs it. If you find yourself adding a build step, stop: that is the
wrong shape for this repo.

## Verification

From the repo root — all five must pass:

```
pnpm verify
```

Scoped to just this package:

```
pnpm --filter @cviper/cv-parsing typecheck
pnpm --filter @cviper/cv-parsing lint
npx vitest run packages/cv-parsing
```

## Status

Implemented: PDF and .docx text extraction, format sniffing, whitespace
normalisation, prompt truncation, and prompt-injection sanitising.

## Conventions

- Parsing is entirely local. A CV must never leave the machine from this package.
- User-supplied files are hostile input: malformed, truncated, wrong-format and
  enormous files all need explicit handling. This package ships negative and
  boundary tests by default.
- Nothing throws across the boundary. Every entry point returns
  `Result<ExtractedDocument, ParseError>` from `@cviper/core-types`.

## Things that will bite you

- **`ParseError.message` is the product.** This is an offline app with no
  support channel, so the message on screen is the only help a user gets. Branch
  on `code`, never on `message`.

- **`warnings` is load-bearing.** A PDF with pages and no text is a scan. It is
  an error (`NO_TEXT_LAYER`), not an empty success — analysing an empty string
  and reporting "no skills found" looks like a verdict on the candidate. A PDF
  where only SOME pages are images succeeds, and says so in `warnings`. Any UI
  rendering `text` must render `warnings` too.

- **pdf.js ships two builds and they are not interchangeable.** `pdfjs-dist`
  (modern) needs a browser: it evaluates `new DOMMatrix()` at module top level
  and parses using `Uint8Array.prototype.toHex`, neither of which Node 24 has.
  Node tests load `pdfjs-dist/legacy/build/pdf.mjs` through the loader seam in
  `pdfjs.ts`. Do not "simplify" that seam away.

- **The app MUST call `configurePdfJs` at startup.** pdf.js resolves its worker
  and data files at runtime. Unconfigured, it looks relative to
  `document.baseURI` — which works under `vite dev` and breaks only once the app
  is packaged. `apps/light/src/parsing/pdfjs-assets.ts` owns that call.

- **mammoth's Node and browser builds read different input keys**
  (`buffer` vs `arrayBuffer`). `docx.ts` sets both, so the app and the test run
  make the same call. Removing either breaks one environment and not the other.

- **No binary fixtures, ever.** `src/test/fixtures.ts` builds every PDF and
  .docx in code — an uncompressed PDF with a real xref table, and an fflate zip
  with a pinned timestamp. Note that fflate REJECTS `mtime: 0`, because a zip
  cannot store a pre-1980 date.
