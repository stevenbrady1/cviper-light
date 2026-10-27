#!/usr/bin/env bash
# Free the dpkg lock left by a capped WebKit install, before the retry (L-280).
#
# The WebKit job installs the browser with `timeout 300 pnpm ... playwright-core
# install --with-deps webkit`. When a slow Ubuntu mirror makes that run past the
# cap, `timeout` stops pnpm — but the apt-get that playwright starts runs under
# sudo, in its own process group, so it is not stopped. It keeps downloading,
# keeps /var/lib/dpkg/lock-frontend, and the retry fails within a second with
# "Could not get lock". That is exactly what the first live run of L-280 did.
#
# So: stop any apt-get still running, wait for it to let go, force it if it
# will not, and repair a half-finished unpack. apt resumes partial downloads
# from /var/cache/apt/archives/partial, so the retry does not start from zero.
#
# Safe when nothing is running: it does nothing and exits 0.
set -u

apt_busy() { pgrep -x apt-get >/dev/null 2>&1 || pgrep -x dpkg >/dev/null 2>&1; }

if ! apt_busy; then
  exit 0
fi

echo "::warning::A capped WebKit install left apt running; stopping it before the retry (L-280)."
sudo pkill -TERM -x apt-get || true

for _ in $(seq 1 20); do
  apt_busy || break
  sleep 1
done

if apt_busy; then
  sudo pkill -KILL -x apt-get || true
  sudo pkill -KILL -x dpkg || true
  sleep 1
fi

# A no-op when the cut came during the download, which is the slow part; it
# finishes the job when the cut came mid-unpack.
sudo dpkg --configure -a
