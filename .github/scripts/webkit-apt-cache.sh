#!/usr/bin/env bash
# Keep the system packages WebKit needs between CI runs (L-284), and install
# them without the Ubuntu package servers whenever the cache holds them (L-367).
#
# `playwright-core install --with-deps webkit` pulls ~70 system packages
# through apt. On 26 Oct 2026 the Ubuntu mirror served them at a few kB/s three
# times in one day; L-280 capped the wait, but a capped install still fails.
# The fix is not to download them again: point apt's package cache at a folder
# `actions/cache` saves and restores, and tell apt to keep what it fetches.
#
# L-367: keeping the packages was not enough. `--with-deps` always runs
# `apt-get update` first, and that always needs the network. On 11 Nov 2026 the
# cache was a full hit, the runner could not resolve the Ubuntu servers, and the
# update alone ran out both 5-minute caps (CI #1102, #1107). So `offline`
# installs from the cache with `--no-download` — apt reads the package lists the
# runner image already has, and checks each cached file against them — and the
# install step adds `--with-deps` only when that fails.
#
#   keys            name the caches: the runner image and the Playwright version.
#                   Written to $GITHUB_OUTPUT as os=, image= and playwright=.
#   configure DIR   before the install: apt reads and writes .deb files in DIR.
#                   Packages already there (restored by actions/cache) are used
#                   as-is; apt fetches only what is missing or newer.
#   offline DIR     install what WebKit is missing from DIR, with no network.
#                   Writes needs-apt= (done) or needs-apt=true (the cache could
#                   not cover it) to $GITHUB_OUTPUT.
#   report DIR      after the install, BEFORE the tests: fail if anything WebKit
#                   needs is still missing, then say how many packages DIR now
#                   holds, so a run that cached nothing is visible in the log.
#
# Why a config file and not copying files in and out of /var/cache/apt: images
# that ship docker-clean (and some runners do) delete /var/cache/apt/archives
# after every install, by that literal path. A different directory is out of
# its reach, and APT::Keep-Downloaded-Packages stops apt's own clean-up.
set -euo pipefail

mode="${1:?usage: webkit-apt-cache.sh keys | configure|offline|report DIR}"
dir="${2:-}"
if [ "$mode" != keys ] && [ -z "$dir" ]; then
  echo "usage: webkit-apt-cache.sh $mode DIR" >&2
  exit 2
fi

count() { find "$dir" -maxdepth 1 -name '*.deb' 2>/dev/null | wc -l; }

case "$mode" in
  keys)
    # ImageOS and ImageVersion are set on GitHub's runner images, in
    # /etc/environment. They are not in the workflow's `env`, so `${{ }}`
    # cannot see them; this step reads them and hands them on.
    os="${ImageOS:-}"
    version="${ImageVersion:-}"
    if [ -z "$os" ] || [ -z "$version" ]; then
      # shellcheck disable=SC1091
      . /etc/os-release
      os="${os:-$ID$VERSION_ID}"
      version="${version:-unknown}"
      echo "::warning::ImageOS/ImageVersion are not set; the cache keys use $os-$version (L-367)."
    fi
    playwright="$(cd apps/light && node -p "require('playwright-core/package.json').version")"
    printf 'os=%s\nimage=%s-%s\nplaywright=%s\n' "$os" "$os" "$version" "$playwright" |
      tee -a "${GITHUB_OUTPUT:?}"
    ;;
  configure)
    mkdir -p "$dir/partial"
    # apt downloads as the unprivileged _apt user; without this it still works,
    # but warns and falls back to downloading as root.
    sudo chown _apt:root "$dir/partial" 2>/dev/null || true
    sudo tee /etc/apt/apt.conf.d/99-webkit-apt-cache >/dev/null <<CONF
Dir::Cache::Archives "$dir/";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
CONF
    echo "apt will use $dir for packages; $(count) already cached."
    ;;
  offline)
    # Playwright's dry run asks apt (`install -s`, local lists only) what is
    # missing and prints one package per indented line; it exits 0 when
    # nothing is. An unreadable listing simply leaves the job on the servers.
    if listing="$(pnpm --filter @cviper/light exec playwright-core install-deps --dry-run webkit)"; then
      echo "WebKit's system packages are already installed."
      echo "needs-apt=" >>"${GITHUB_OUTPUT:?}"
      exit 0
    fi
    mapfile -t packages < <(sed -n 's/^  \([^[:space:]]\{1,\}\)$/\1/p' <<<"$listing")
    if [ "${#packages[@]}" -gt 0 ] &&
      sudo timeout --kill-after=10 120 apt-get install -y --no-install-recommends --no-download "${packages[@]}"; then
      echo "Installed ${#packages[@]} package(s) from $dir in ${SECONDS}s, with no download (L-367)."
      echo "needs-apt=" >>"${GITHUB_OUTPUT:?}"
    else
      # --no-download stops before dpkg is touched; this only repairs a cut
      # made by the cap mid-unpack, and does nothing otherwise.
      sudo dpkg --configure -a
      echo "::notice::The cache could not supply all ${#packages[@]} of WebKit's system packages; the install step will fetch them from the Ubuntu package servers (L-367)."
      echo "needs-apt=true" >>"${GITHUB_OUTPUT:?}"
    fi
    ;;
  report)
    # The same dry run, as a gate: a missing library fails HERE, named as an
    # install problem, instead of surfacing as a test that could not launch.
    if ! pnpm --filter @cviper/light exec playwright-core install-deps --dry-run webkit; then
      echo "WebKit's system packages are still missing after the install (L-367)." >&2
      exit 1
    fi
    n="$(count)"
    if [ "$n" -eq 0 ]; then
      echo "::warning::No packages cached in $dir; the next run will download WebKit's dependencies again (L-284)."
    else
      echo "$n package(s) cached in $dir for the next run."
    fi
    route="from the cache, with no download"
    [ -z "${NEEDS_APT:-}" ] || route="from the Ubuntu package servers (the cache did not cover them)"
    echo "WebKit's system packages came $route; $n cached for the next run." >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
