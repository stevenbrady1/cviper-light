# CLAUDE.md — @cviper/resume-schema

The JSON Resume interchange format (jsonresume.org, v1.0.0): read a file,
validate it, flatten it to CV text, and write it back byte-for-byte.

Root rules in [../../CLAUDE.md](../../CLAUDE.md) apply in full. The HARD RULES
there are not negotiable from inside this package.

## This package is source-only

No `build` script. No `dist`. Consumers import `src/index.ts` directly; Vite
compiles it, `tsc --noEmit` typechecks it, Vitest runs it.

## Verification

From the repo root — all five must pass:

```
pnpm verify
```

Scoped to just this package:

```
pnpm --filter @cviper/resume-schema typecheck
pnpm --filter @cviper/resume-schema lint
npx vitest run packages/resume-schema
```

## What it does, and what it must keep doing

- `parseJsonResume(text)` / `parseJsonResumeBytes(bytes)` return
  `Result<JsonResume, ResumeError>`. Nothing throws. Every error message says
  what happened, why, and what to do; branch on `code`, never on `message`.
- **Lenient on content, strict on shape.** Every field is optional and dates
  are plain strings, because real exporters disagree about them. A string
  field holding a number, or a list holding a string, is an error reported by
  path (`work[0].highlights: …`), all problems at once, nothing imported.
- **Unknown keys survive.** Every object is a `z.looseObject`, and the parser
  returns the object it read rather than Zod's copy, so `serializeJsonResume`
  writes back the same file, keys in the same order. `serialize.test.ts` pins
  this; it is the L-20 acceptance criterion.
- **`flattenJsonResume` is deterministic.** Fixed section order, entries in
  file order, no dates or locale. `flatten.test.ts` pins the full output —
  a change there is a change to every imported CV and must be deliberate.
- **`meta.cviper`** is the only place CViper writes its own notes. Never put
  a CViper key anywhere else in the document.
- No I/O. No Tauri. No network. `@cviper/cv-parsing` calls this for `.json`
  files; the Rust side (`files.rs`) only reads the bytes.
