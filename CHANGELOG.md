# Changelog

All notable changes to CViper Light are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Every symbol, badge and abbreviation now says what it means (L-215). Hover, tab to, or tap a mark to see a short explanation: the ATS score's ✓ ⚠ ✗, ▲ ▼, the dash, the band words, each row and column, "ATS" itself and the fabrication check; the step bar's ✓ ● ⊘ ○ and the CV/engine line; a tracker card's progress dots; the rail's keyboard shortcuts, service dots and "Requests today"; and the Analysis verdict. Tailor's change list also says what green and struck-through lines mean. Screen readers hear the same words. A test fails if a screen starts showing a symbol without an explanation.

## [0.7.0] — 2026-10-08

### Added

- Save the tailored CV and the cover letter as a PDF, beside Word and text (L-201). The PDF is built on this machine with no extra library or font file, keeps the same single-column, ATS-safe layout, and is read back by the app's own PDF reader in the tests. Accented names (é, ł, ñ, ő, ș…) come out exactly; a character the PDF's built-in font cannot show (Cyrillic, Chinese, emoji) is named after the save, with Word as the way to keep it.
- Choose your CV and AI engine once per job: what you pick on Analysis is what Tailor opens with, and the other way round. The step bar shows the choice ("CV: … · Engine: …"). Picking another CV for a job starts its draft again, as it always has on Tailor (L-200).
- Tracker cards for jobs you have started show how far each one has got (●●●○○) and a Continue button that takes you to the next thing to do — Analyse, Tailor or the ATS Score — on the right job (L-200).
- A step bar for each job on Analysis and Tailor: Find → Analyse → Tailor → ATS Score → Export, with Back and Next. It names the job, ticks off what is done, marks a step you went past as skipped (⊘) rather than locking anything, and takes you to any step — including back to the tracker. Moving between steps never runs a check or the AI; you still press the button on the step (L-200).
- Tailor keeps your work for each job. Leave Tailor for another screen and come back, and the tailored CV, the review and the letter are still there; pick another tracked job and it has its own draft, and the first one is waiting when you go back. A draft that finishes after you switched jobs lands on the job it was written for (L-199).
- Your tailoring survives closing the app. Each job's advert, chosen CV and model, and unsaved draft, review and letter are kept on this computer and come back when you reopen it, and "Continue where you left off" takes you back to the job you were on. Nothing is kept for an advert you pasted without a tracked job. "Delete everything" removes all of it (L-199).
- Editing a tracked job's advert on Tailor no longer unlinks the job. The screen says "Advert edited", "Restore the original" puts the job's own text back, and "Save to an application" saves your edited advert beside the CV (L-199).
- Interviewing can be split into your own stages (HR Screen, Technical Test, Panel Round, Final): add, rename, reorder and remove them, and put a card in one. Removing a stage never removes a card. Backups carry the stages (still format version 1). Note: importing a backup written before this release over a card you already have clears that card's stage, because an old file cannot say which stage it was in (L-205).

### Changed

- The keyboard focus ring and the edges of text boxes and drop-downs are now easy to see (L-212). The focus ring was blue at a quarter strength, about 1.5:1 against the page; it is now a crisp white-and-blue ring that measures 3:1 or more on every background, the dark side menu included. Every input, select and text area is edged in a new `field-line` grey at 3.2:1 or more, instead of the faint divider colour (about 1.3:1). The contrast test now checks both, as WCAG 1.4.11 asks.
- Every AI prompt now marks its sections with a random tag made for that prompt alone (`=== JOB ADVERT === #k3f9x2ma`), and tells the model that only a marker ending in that tag opens or closes a section (L-210). A job advert is written before the prompt exists, so it cannot guess the tag: even a fake section marker that got past the text cleaner is read as part of the advert. The cleaner (L-207) still removes marker-shaped lines first; this is a second wall behind it.
- The Store package's version must now be above every version already uploaded to the Store, not just equal to the app version (L-170). Uploads are recorded in `msix/store-submissions.json`; a rollback below the last upload fails `pnpm test`, and packing a version the Store has already been sent stops `msix.yml` before anything is packed.
- "Save to an application" works for a job that has no application yet: it starts one as Saved and saves into it, instead of sending you to the tracker first (L-199).

## [0.6.0] — 2026-09-29

One flow from finding a job to tailoring your CV for it, a tidier Set up
list, and your CV shown on the Tailor screen (L-195).

### Added

- Find a job, check your CV against it and tailor your CV for it, without
  copying anything between screens. "Analyse this job" on a search result saves
  it to your tracker (once — a job already there is reused) and opens it on
  Analysis with the advert filled in. Adzuna, Reed and the Guardian only send a
  preview of each advert, so the app reads the rest from the advert's own page
  when you press the button; if the site blocks apps, Analysis says so and asks
  you to paste the full advert. After a check, "Tailor my CV for this job"
  opens Tailor with the same job, CV and model. A tracker application has
  "Analyse this job" and "Tailor my CV" too, and the check is saved against
  that job (L-190).
- Fetching an advert from its link now reads the job details the page publishes
  for search engines when it has them, so the advert comes in without the menus,
  cookie banners and "similar jobs" around it (L-190).
- The Tailor screen shows the CV you choose right under the picker, as the
  text the rewrite will work from, so you can check it without opening the
  file. It changes as soon as you pick another CV, and "Hide CV" folds it away
  (L-192).

### Changed

- The sidebar's Set up list shows only what is set up. Missing keys and a
  stopped Ollama are no longer listed; a half-entered Adzuna or a key that
  cannot be read still shows, in gold, because it needs you. With nothing set
  up, one line says so and links to Settings (L-191).

## [0.5.0] — 2026-09-29

The CViper logo, a Gemini that finishes its answers, a choice of model per
provider, and fixes to the tracker, the Analysis screen and link fetching
(L-189).

### Added

- The sidebar's Set up list shows which AI providers have a key: each one with
  a saved key by name, gold if its key cannot be read, and one quiet "AI keys"
  dot when there are none (L-182).
- Each AI key card in Settings has a Model list: three to five models for that
  provider, starting with the one the app has always used. The choice is kept
  on this computer and used by everything that provider does in the app —
  analysis, tailoring, pasted adverts, follow-ups and interview packs (L-183).

### Changed

- CViper Light now uses the CViper logo — the navy badge with three teal bars —
  in the sidebar and as its app icon on the taskbar, Start menu, installer and
  Microsoft Store tiles (L-184).

### Fixed

- Google Gemini no longer fails every analysis with "the model ran out of
  room". Thinking models spend part of the answer allowance reasoning, and
  each job's allowance was sized for the answer alone; every cloud provider
  now gets room to think on top of it, so Grok, OpenAI's reasoning models and
  thinking models on OpenRouter are covered too. When a model still runs out,
  the message says the thinking used it up, and it no longer tells you to
  raise an output limit the app does not have (L-185).
- Tracker cards can now be dragged between columns on Windows. Tauri’s own
  file-drop handler was swallowing every in-page drag in WebView2; it is
  switched off, and a file or link dropped on the window is refused rather
  than opened in place of the app (L-186).
- Fetching a LinkedIn job link says what is really happening: LinkedIn blocks
  apps from reading its pages, so the advert has to be pasted as text. It
  used to say only that the page could not be read, which looked like a fault
  in the app. The same message is shown for any site that answers 401, 403 or
  999 (L-188).
- The Analysis screen keeps your CV, the advert, the chosen option and the
  last result when you go to another screen and come back, for as long as the
  app is open. They are held in memory only, never written to disk, and
  Delete everything clears them. A check still running when you leave shows
  its result when you return (L-187).

## [0.4.0] — 2026-09-29

More AI providers, a Settings page that leads with them, and a tracker that is
easier to search and to recover (L-180).

### Added

- The tracker has a search box, and a Retry button when applications fail to
  load, instead of leaving the board empty (#137).
- A pasted advert's salary keeps its period — per year, per day or per hour —
  and is never converted to another unit. A recruitment agency is recorded
  separately from the hiring company, in a new `agency` column that existing
  applications leave empty (#137).
- Four more bring-your-own-key AI providers: Google Gemini, Mistral, xAI Grok
  and OpenRouter, each with its own key card (tested before it is saved), its
  own consent dialog, and its own entry in the generated privacy policy. All
  four speak the OpenAI chat-completions dialect, so one adapter serves them;
  OpenRouter's key is tested against its key endpoint because its model list
  is public (L-177).
- A hand-run Release admin workflow for tidying releases (L-178): set or clear
  a published release's pre-release flag, or delete a draft. It never
  publishes a draft, never deletes a published release or a git tag, and never
  touches the `updater` release.

### Changed

- Settings leads with the AI provider keys. The free Adzuna and Reed keys move
  into an Advanced section that starts closed (L-176).
- The key box hint no longer says every key has a prefix; some providers'
  keys do not (L-177).

### Fixed

- The match score's WEAK / POSSIBLE / STRONG labels no longer print on top of
  each other. The scale had shrunk to the width of "65 out of 100", so every
  result showed the overlap; it now spans the row, the labels are anchored
  apart, and on a narrow window the verdict badge moves below it (L-181).
- Settings → Privacy no longer tells Microsoft Store or phone users the app
  checks for updates at startup. Those builds have no update check; their
  updates come from the store (L-181).

## [0.3.0] — 2026-09-28

The version the Microsoft Store submission and the next download are built
from (L-174).

### Added

- Pasting a job advert asks for AI consent right there (L-141): the paste form
  raises the same consent dialog as the Analysis screen, records the answer in
  the same store, and runs the pending extraction the moment you say yes.
  Decline and nothing is sent, with the paste still in the box. Previously the
  only place consent could be given was the Analysis screen, so a new user's
  first paste with a cloud key was refused and sent on a detour.
- The follow-up and interview panels ask for consent themselves the same way
  (L-171), instead of refusing and pointing at another screen.
- The Store package's version is asserted at pack time (L-169): packing stops
  with a clear message if the staged manifest's version disagrees with the app
  version, rather than shipping a stale one for the Store to reject.

### Changed

- Tracker cards say what the date is for (L-175): the footer reads "Reply by
  Friday · due in 2 days", "Due today" or "1 day overdue", in the same
  urgency colours, instead of a bare `2026-09-29`. The status pill is gone from
  the card, because the column above it already says the status.
- The funnel strip's labels say it counts flow: Applied and Interviewed, not
  Sent and Interviewing, so "Interviewed 2" no longer sits above an
  Interviewing column holding one card as if one of them were wrong.
- The Tailor screen, with no local model or key, has an Open Settings button
  beside the reason instead of only the words.

### Fixed

- The Store package's manifest version had stayed at `0.1.0.0` after the app
  moved to 0.2.0, because nothing tied the two together (L-168). A contract
  test now compares the manifest against the app version on every commit, and
  the manifest readers strip XML comments first, so a commented-out example
  pasted above the real entry can no longer fool every guard at once.
- Opening an application no longer crushes the board: columns keep a minimum
  width and the board scrolls sideways, where titles used to shrink to
  "Senior Pr…" and dates spilled past the edge of the card (L-175).

## [0.2.0] — 2026-09-19

The first published release. An earlier tag, `light-v0.1.0` (2026-09-13),
built installers but its GitHub release was never published — it stayed a
draft, and its contents are folded into this release. `light-v0.2.0` was
tagged 2026-09-15 and published 2026-09-19; the Windows installer it built is
the one the [cviper.ai](https://cviper.ai) download button points at.
Everything below is listed from the "Built" rows of
[docs/FEATURE-MATRIX.md](docs/FEATURE-MATRIX.md), which is the per-feature
source of truth.

### Added

- Application tracker: a board of every application, kept in a local SQLite
  database, with a coloured edge on each card showing how long it has sat
  still.
- CV text extraction from PDF, Word and JSON Resume files, done on your
  machine.
- JSON Resume import of any 1.0 file, and export of the file it arrived as,
  unchanged except for a `meta.cviper` note of when it left.
- Keyword-only CV match against a job advert: no AI, no key, always available.
- CV analysis with a local Ollama model: offline, no key, no network.
- CV analysis with your own AI provider's key, behind a per-provider consent
  dialog that names the provider and says what is sent before the first run.
- Job search inside the app with your own free Adzuna and Reed keys.
- Browse recent jobs with no key: the Arbeitnow and Guardian Jobs feeds, read
  on request and narrowed down on your computer.
- Cross-post detection: the same advert on two boards is flagged, never
  merged.
- Keyless search links to nine UK job boards that open in your own browser;
  Settings lets you turn any off, reorder them and add your own.
- API-key setup: each key is tested before it is saved, stored in the
  operating system's credential store, and can never be read back.
- Paste a job advert and a model fills in the form — title, company,
  location, salary, link and dates; nothing is saved until you have checked
  every field.
- A paste that is only a web link is spotted and moved to the link box rather
  than sent to a model.
- Fetch an advert from a link: one page, on request, with no credentials,
  private and loopback addresses refused.
- Export of all your data as one readable JSON file, and import that merges
  and never deletes.
- Delete everything: the database, every key in the credential store and every
  preference, in one action.
- A privacy notice in Settings generated from the registry of every address
  the app can contact.
- Update check for the direct-download build: once at launch by default,
  switchable off in Settings, plus a button; updates are signed.
- A Microsoft Store flavour of the Windows build with the updater compiled
  out, because the Store replaces the whole package itself.
- Open a CV from the iOS share sheet ("Open in CViper Light" for PDF, Word and
  JSON); built, not yet tested on a device.
- First-run introduction: three cards, reopenable from Settings.
- Candidate profile (L-154): headline, languages with levels, work rights,
  deal-breakers, target sectors, goals, what energises and drains you, a
  writing-style note and STAR examples; the first view, on Ctrl+1; carried in
  the backup file.
- Documents archived on an application (L-155): the advert, the CV and cover
  letter you sent, follow-up notes and interview packs, in the backup file.
- Every system prompt now states that the advert and the CV are material to
  analyse, never instructions to follow (L-153); a contract test derives every
  prompt builder and fails the build if one lacks the clause.
- Eligibility and language gates (L-156): citizenship, residency, clearance
  and language requirements are checked before the score, quoting the advert
  line, as pass, flag or hard stop; they never move the number.
- Search results ranked against your newest CV with no key (L-157), a
  best-match-first toggle, and deal-breaker chips from the profile.
- Skills-gap heatmap on the Profile view (L-158): the skills the adverts on
  your board ask for that your CV does not mention, ranked by how many want
  them.
- A funnel strip on the tracker (L-159): sent, interviewing, offers, rejected,
  with interview and offer rates.
- Follow-up and thank-you drafts from the tracker (L-162): offered after ten
  quiet days, at most twice per application, written only from the materials
  you sent; drafts only — the app never sends anything.
- An interview prep pack from the archived application (L-163): likely
  questions with STAR-shaped answers, talking points, questions to ask, and
  gaps to bridge honestly; saved as a document.
- Tailor a CV to an advert (L-160): a structured rewrite that may use only
  what the CV already says, a second-context reviewer that lists issues and
  never rewrites, a deterministic fabrication check (new metrics, employers,
  years or certifications absent from the original), a line diff against the
  original, saving to the application, and export as plain text.
- A cover letter from the tailored CV and the advert (L-161), with a word
  count and a note over 400 words; saved and exportable.
- Import a candidate profile from an ai-job-search folder (L-167): pick the
  folder, four Markdown files are read by name on this computer, and what was
  found is reviewed before it is added; lists are unioned and typed text is
  never overwritten. No name, contact details or work history are read.

- Save the tailored CV and the cover letter as a Word document (L-165), built
  on your machine and sent nowhere: a single column, the standard headings,
  one plain font, no tables and no images, so a parser reads it the way you
  do.

### Fixed

- Settings said the backup held jobs, applications, CVs and checks, and counted
  only those, while the file had carried the profile and the archived documents
  since L-154 and L-155 (L-166). The "Your data" paragraph, the export message,
  the import preview and the delete confirmation now name them: "2 jobs, 1 CV,
  3 archived documents and your profile".

[Unreleased]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.7.0...main
[0.7.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.6.0...light-v0.7.0
[0.6.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.5.0...light-v0.6.0
[0.5.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.4.0...light-v0.5.0
[0.4.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.3.0...light-v0.4.0
[0.3.0]: https://github.com/stevenbrady1/cviper-light/compare/light-v0.2.0...light-v0.3.0
[0.2.0]: https://github.com/stevenbrady1/cviper-light/releases/tag/light-v0.2.0
