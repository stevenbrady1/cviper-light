# L-278 — ESCO skills list for the free scorer (spec, not built)

Status: **proposed**, 26 Oct 2026. No code until this is agreed.

## The problem, measured

The free check (`packages/keyword-scoring`) only treats a word as a
requirement if it is in its own skill vocabulary: 92 default skills, mostly
tech, plus 14 small sector lexicons of 4–11 related terms each. An advert
written in any other vocabulary barely registers.

Measured on 26 Oct 2026 (product audit) with a care-assistant advert and two
CVs:

| CV                                | Requirements found | Score    |
| --------------------------------- | ------------------ | -------- |
| Senior care assistant (good fit)  | 2 of ~8            | 49, weak |
| Barista (no care experience)      | 2 of ~8            | 10, weak |
| Senior Python dev → Python advert | 4 of 4             | 92       |

The care advert asks for NVQ Level 2/3, personal care, dementia care,
medication administration, safeguarding, a driving licence and own car, and an
enhanced DBS. The scorer found safeguarding and medication administration
only. The ordering is right; the numbers are not, and care, retail, admin and
trades are most of the UK job market.

L-275 (punctuation) does not move this: with it applied the care score stays 49. Only a bigger vocabulary does.

## Proposal

Add a **Light-only** skills list built from ESCO (the European Commission's
skills and occupations classification) plus a short hand-made UK list, and use
it for requirement detection in the free scorer.

### What ESCO gives

- A free download (CSV among the formats) with a `skills_en` file and an
  `occupationSkillRelations` file linking each occupation to its essential and
  optional skills. [ESCO downloadable datasets](https://esco.ec.europa.eu/en/structure-esco-downloadable-datasets)
- Roughly 3,000 occupations in v1.2, in 28 languages.
  [Wikipedia](https://en.wikipedia.org/wiki/European_Skills,_Competences,_Qualifications_and_Occupations)
- Preferred labels and alternative labels per skill. Labels are often verb
  phrases ("administer medication"), which is why alternative labels matter.

### What ESCO does not give

UK qualifications and checks: NVQ levels, DBS, CSCS card, SIA licence, Level 3
diploma names, "full UK driving licence", right to work. These go in a small
hand-made `uk.json` (target under 150 terms), reviewed by Steven.

## Design

1. **A build-time script, not a runtime download.** `tools/esco/build.ts`
   reads the ESCO CSV (committed? see open question 2), filters it and writes
   `packages/keyword-scoring/src/lexicons-light/esco.json`. The app never
   fetches ESCO; the scorer stays offline.
2. **Filter hard.** Keep skills whose reuse level is sector- or
   occupation-specific; drop transversal labels ("communicate", "work in
   teams") that would match every CV. Keep labels of 1–4 words. Target
   5,000–8,000 terms after filtering.
3. **A separate lexicon directory, as a named divergence.** The existing
   `lexicons/*.json` must stay byte-identical to the web app's (package
   CLAUDE.md). The new files live in `lexicons-light/` and are merged after
   them. This is the second deliberate divergence after L-275 and is recorded
   the same way.
4. **Requirement detection only, at first.** ESCO terms join
   `SKILL_VOCABULARY` for finding requirements in the advert and skills on the
   CV. Weights default to 1.0; the existing rarity weights stay as they are.
5. **Lazy-loaded.** The JSON is imported on the first free check, not at
   launch (the same pattern as the Word libraries, which cut the main chunk
   from 1.6 MB to 900 kB). Budget: **≤ 400 kB gzipped**, measured in the build.
6. **Every match still goes through `termInText`**, so the token rules,
   UK/US spelling and plural folding apply unchanged.

## Acceptance criteria

- [ ] Care example: at least 6 of the 8 requirements found; good-fit CV
      scores **≥ 70**; barista **≤ 30**.
- [ ] A test set of at least 20 non-tech UK adverts (care, retail,
      hospitality, admin, warehouse, trades, teaching assistant), each with a
      good-fit and a poor-fit CV: good fit beats poor fit in **every** pair.
- [ ] Existing tech fixtures move by no more than ±3 points.
- [ ] Negative list, each with a test: no match for "go" in "go-to-market",
      "excel" in "excellent", "care" in "career", "nurse" in "nursery".
- [ ] No transversal ESCO label (communication, teamwork, problem solving)
      counts as a requirement.
- [ ] Launch bundle unchanged; ESCO chunk within budget; a contract test holds
      both.
- [ ] Still no network: the existing outbound-hosts guard passes unchanged.
- [ ] Attribution shown wherever the licence requires it (open question 1).

## Open questions — Steven to decide

1. **Licence.** ESCO is published by the European Commission and is generally
   described as free to reuse, including commercially, with attribution.
   **Not verified**: the ESCO site refused my fetch on 26 Oct. Read the
   legal notice on esco.ec.europa.eu before any data is committed. If
   attribution is required, it goes in Settings → About and in the README.
2. **Commit the raw CSV, or only the filtered JSON?** Committing the raw file
   makes the build reproducible but adds tens of MB to the repo. Recommended:
   commit only the filtered JSON plus the script and the ESCO version it was
   built from.
3. **Also use `occupationSkillRelations`?** It could infer likely requirements
   from a job title alone ("care assistant" implies personal care). Powerful,
   but it invents requirements the advert never stated. Recommended: not in
   this item.
4. **Port back to the web app?** Only if it is ever revived. Until then,
   Light-only.

## Effort

About 1–2 weeks of evenings: the script and filtering (2–3 days), the UK list
and its review (1–2 days), the advert test set (2–3 days, the slowest part),
and lazy loading plus guards (1–2 days).

## Not in scope

Semantic (meaning) matching with a small embedding model, the unified scoring
engine, and AI-side changes. Those are phase 2 of the audit roadmap.
