# Changelog

All notable changes to CViper Light are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The first tagged release is pending (L-117). The tag `light-v0.1.0` exists and
the release workflow builds and signs installers from it, but no release has
been published yet. Everything below is built and on `main` today; it is
listed from the "Built" rows of
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

[Unreleased]: https://github.com/stevenbrady1/cviper-light/commits/main
