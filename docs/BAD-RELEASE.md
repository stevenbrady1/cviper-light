# When a release goes wrong

What to do when a published CViper Light release is broken (L-228). It is written
so every step can be done **from a phone**. The GitHub app runs workflows;
github.com in a phone browser does the rest.

Read this before you need it. During a bad release is the wrong time to learn
what the updater can and cannot do.

## What the updater can and cannot do

- **It can stop new installs of a bad version.** Installed copies ask one fixed
  address for `latest.json` (RELEASE-SIGNING.md §2). Point that file back at
  the last good release, and nobody else updates to the bad one.
- **It cannot move anyone backwards.** The updater only installs a version
  NEWER than the one installed. People who already took the bad version stay
  on it until a newer, fixed version is published.
- **So the fix for people already affected is always a new version** —
  `X.Y.Z+1` — never a re-publish of an older one.

## Step 1 — stop the spread (5 minutes)

1. **Point the updater back at the last good release.** GitHub app → the
   `cviper-light` repo → **Actions** → **Release** → **Run workflow** → set
   `promote_tag` to the last good tag, e.g. `light-v0.9.0` → **Run**. The
   `promote-manifest` job verifies that release's manifest before publishing
   it.
2. **Move the website's download button back too.** The landing page links to
   `/releases/latest`, which is the newest release that is not a pre-release.
   **Actions** → **Release admin** → **Run workflow** → action
   `set-prerelease`, tag = the bad tag → **Run**. The previous full release
   becomes "Latest" again.

Do not delete the bad release. Release admin refuses to delete a published
release on purpose: it is somebody's download, and the version number must
never be reused.

## Step 2 — fix forward

1. Fix the problem on `main` through a PR, as usual — with a test that fails
   without the fix.
2. Bump the version in `apps/light/package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json` to `X.Y.Z+1`.
3. Tag `light-vX.Y.Z+1` at the merge commit. The `ci-passed` gate waits for
   CI to be green on it before anything is built (L-221).
4. Publish the draft, then promote its manifest (RELEASE-SIGNING.md §3).

## Step 3 — tell people

- In the new release's notes, say in one plain sentence what went wrong and
  that updating fixes it.
- Open a GitHub issue titled with the symptom, link the fixed release, and pin
  it, so someone searching the symptom finds the answer.

## If people's data looks wrong after an update

Since L-227 the app keeps **one safety copy** of its database, made just before
an update changes how data is stored: `cviper.db.before-update`, next to
`cviper.db` in the app's data folder:

| System  | Folder                                            |
| ------- | ------------------------------------------------- |
| Windows | `%APPDATA%\com.cviper.light\`                     |
| macOS   | `~/Library/Application Support/com.cviper.light/` |
| Linux   | `~/.config/com.cviper.light/`                     |

To restore it, a person must **close the app**, rename `cviper.db` to
something else (keep it), and rename `cviper.db.before-update` to `cviper.db`.
If a `cviper.db.before-update-wal` exists, rename it to `cviper.db-wal` at the
same time.

Two warnings to give with those steps:

- The copy is from **before** the update, so anything added since is not in it.
- The app that opens the restored file must be a version whose update will run
  its migrations again — the fixed `X.Y.Z+1`, not the bad one.

## If the signing key is lost or leaks

There is no clean fix for either, which is why the backup in
RELEASE-SIGNING.md §1a matters more than anything on this page.

- **Lost:** no new update can ever be signed for existing installs. Every user
  would have to download a new installer by hand.
- **Leaked:** anyone holding it can sign an update every installed copy will
  accept. Remove the GitHub secrets at once (Settings → Secrets and variables →
  Actions) so CI stops using them, then get help before doing anything else —
  replacing the key is a planned release signed with the OLD key that carries
  the NEW public key, and getting it wrong locks every user out (§1).
