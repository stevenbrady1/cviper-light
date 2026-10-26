# L-278 — ESCO skills list for the free scorer (spec, not built)

Status: **agreed except the licence**, 26 Oct 2026. No code until the licence is confirmed.

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

**Shipped separately as L-282** (27 Oct 2026), ahead of ESCO, because it needs
no licence decision: `lexicons-light/uk.json` + `uk-skills.ts`, 63 terms,
each a label plus aliases. ESCO, when it lands, should reuse that layer (labels
reported, aliases folded in) rather than add a second mechanism.

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

## Decisions (26 Oct 2026)

| #   | Question                                     | Decision                                                                                                                                                |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ESCO licence                                 | **Open — Steven is reading the legal notice** on esco.ec.europa.eu. No ESCO data is committed until he confirms the terms and any attribution wording.  |
| 2   | Commit the raw CSV or only the filtered JSON | **Filtered JSON plus the build script**, with the ESCO version it was built from recorded beside it. No raw CSV in the repo.                            |
| 3   | Infer requirements from a job title          | **No.** The free check scores only what the advert states. `occupationSkillRelations` is not used, so no requirement is ever invented from a job title. |
| 4   | The mothballed web app                       | **Light is the reference scorer.** If the web app is ever revived, port Light's divergences (L-275 and this item) to it; do not revert them here.       |

Build starts when decision 1 is closed.

## Effort

About 1–2 weeks of evenings: the script and filtering (2–3 days), the UK list
and its review (1–2 days), the advert test set (2–3 days, the slowest part),
and lazy loading plus guards (1–2 days).

## Not in scope

Semantic (meaning) matching with a small embedding model, the unified scoring
engine, and AI-side changes. Those are phase 2 of the audit roadmap.
