# CLAUDE.md — @cviper/keyword-scoring

CV-vs-advert scoring with no API key, no Ollama and no network. The first-run
path: this is what analyses a CV before the user has configured anything.

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
pnpm --filter @cviper/keyword-scoring typecheck
pnpm --filter @cviper/keyword-scoring lint
npx vitest run packages/keyword-scoring
```

## Status

Implemented: the full keyword scorer. `scoreByKeywords(cvText, jobDescription)`
returns `Result<CvAnalysis, ScoringError>` — the same `CvAnalysis` the AI path
produces, so the UI renders one component either way.

## THIS IS A PORT. DO NOT REDESIGN IT.

The scoring maths came from the CViper web application, where it has been tuned
across CV-700 through CV-1040 against real adverts. Sources, in the
**read-only** repository at `c:\Dev\job-match-pro`:

| Here              | There                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| `spelling.ts`     | `backend/ai/keywords.py` lines 30, 53 (`_US_TO_UK`, `_fold_spelling`)      |
| `plurals.ts`      | `backend/ai/keywords.py` line 85 (`_plural_variants`)                      |
| `term.ts`         | `backend/ai/keywords.py` line 302 (`term_in_text`) + lines 21-22           |
| `similar.ts`      | `backend/ai/keywords.py` line 334 (`get_similar_terms`)                    |
| `weights.ts`      | `backend/ai/keywords.py` line 284 (`skill_weight`)                         |
| `lexicon.ts`      | `backend/ai/keywords.py` line 113 (`load_lexicons`) + `skill_canonical.py` |
| `lexicons/*.json` | `backend/ai/data/lexicons/*.json` — **byte-for-byte copies**               |
| `vocabulary.ts`   | `backend/ai/keywords.py` lines 156-187, 232                                |
| `match.ts`        | `backend/ai/fallbacks.py` line 398 (`matching`) + constants at 75-94       |
| `ats.ts`          | `backend/ai/fallbacks.py` lines 940, 949, 965                              |
| `profile.ts`      | `backend/ai/fallbacks.py` lines 203, 238, 763-869                          |

If a number here looks wrong, measure the Python before changing it. Two
implementations of the same scorer that disagree are worse than one with a
known quirk, because neither number can be trusted.

## Things that will bite you

- **`skillWeight` is the whole point.** Coverage is rarity-WEIGHTED, not
  counted. Stub it to a constant and the package silently reverts to naive
  match counting — `match.test.ts` and `score.test.ts` both fail on purpose
  when you do, and nothing else does.

- **The lexicon JSON is DATA, not code.** Fifteen files, byte-identical to the
  source repository. Do not edit, tidy, reformat or "improve" them here.
  Improve them upstream and re-copy, or the two scorers drift apart.

- **`_base.json` must load FIRST.** `relatedTerms` and `skillWeights` merge
  last-write-wins, so the merge order in `LEXICON_FILENAMES` is load-bearing.
  It reproduces Python's `sorted(glob("*.json"))`, which is why the file is
  named with a leading underscore.

- **`escapeRegExp` must not emit `\-`.** It is an Annex B identity escape, and
  Annex B is off inside a `u`-flag regex. `term.ts` needs `u` for `\p{L}`, so
  any hyphenated lexicon term (`t-sql`, `front-end`, `problem-solving`) throws
  `Invalid escape` at runtime. The hyphen is escaped as `\x2d`.

- **`pythonRound`, never `Math.round`.** Python rounds half to even; JavaScript
  rounds half away from zero. The formula rounds four times and lands on `.5`
  in ordinary use, so `Math.round` makes this package disagree with the web app
  by a point on some CVs and not others.

- **`missing_skills` and `keyword_gaps` are different questions.** The first is
  "cannot do it"; the second is "can probably do it, but the word an applicant
  tracking system scans for is not on the page". Populating either by copying
  the other tells a qualified candidate to go and learn a skill they have.

- **The reported keywords quote the ADVERT'S spelling, deliberately.** Matching
  folds `optimization` and `optimisation` together, but the gap list shows the
  advert's spelling, because that is the string the employer's system looks
  for. Folding the labels too would advise a candidate into a miss.

- **A trailing full stop hides a skill.** `termInText('python', 'I know
Python.')` is `false`, in the Python original as well as here — `.` is inside
  the token character class so that `node` cannot match inside `node.js`.
  Reproduced on purpose and pinned in `parity.test.ts`; reported upstream
  rather than fixed on one side only.

- **The score cannot reach 0 or 100.** It is floored at 10 and capped at 95
  (`RAW_SCORE_CAP`). Nothing in this package has read the CV, so it never
  claims certainty in either direction. The ATS sub-score does reach both ends.

- **An empty CV is an ERROR, not a zero.** A 0 on screen reads as a verdict on
  the candidate rather than a note that nothing was supplied.

- **No dependency on `@cviper/cv-parsing`.** It statically imports `mammoth`,
  and this is a pure function over two strings. Both extraction paths in that
  package already apply `normalizeWhitespace` before returning, so text
  arriving here is already clean; `score.ts` strips zero-width characters as a
  two-line defence for text that arrives another way.
