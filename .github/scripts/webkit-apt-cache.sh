#!/usr/bin/env bash
# Keep the system packages WebKit needs between CI runs (L-284).
#
# `playwright-core install --with-deps webkit` pulls ~70 system packages
# through apt. On 26 Oct 2026 the Ubuntu mirror served them at a few kB/s three
# times in one day; L-280 capped the wait, but a capped install still fails.
# The fix is not to download them again: point apt's package cache at a folder
# `actions/cache` saves and restores, and tell apt to keep what it fetches.
#
#   configure DIR   before the install: apt reads and writes .deb files in DIR.
#                   Packages already there (restored by actions/cache) are used
#                   as-is; apt fetches only what is missing or newer.
#   report DIR      after the install: say how many packages DIR now holds, so a
#                   run that cached nothing is visible in the log.
#
# Why a config file and not copying files in and out of /var/cache/apt: images
# that ship docker-clean (and some runners do) delete /var/cache/apt/archives
# after every install, by that literal path. A different directory is out of
# its reach, and APT::Keep-Downloaded-Packages stops apt's own clean-up.
set -euo pipefail

mode="${1:?usage: webkit-apt-cache.sh configure|report DIR}"
dir="${2:?usage: webkit-apt-cache.sh configure|report DIR}"

count() { find "$dir" -maxdepth 1 -name '*.deb' 2>/dev/null | wc -l; }

case "$mode" in
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
  report)
    n="$(count)"
    if [ "$n" -eq 0 ]; then
      echo "::warning::No packages cached in $dir; the next run will download WebKit's dependencies again (L-284)."
    else
      echo "$n package(s) cached in $dir for the next run."
    fi
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
