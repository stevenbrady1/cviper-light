#!/usr/bin/env bash
# Say plainly why the WebKit job is red when no test ran (L-367).
#
# ci.yml runs this only when the job has already failed AND `pnpm webkit`
# never ran. Before L-367 such a run ended on "exit code 124" from the install
# step, which reads exactly like a failing test to anyone scanning the checks
# (CI #1102 and #1107, 11 Nov 2026) — and a main that goes red for no real
# reason teaches people to ignore red. This names what broke and says no test
# ran. It still exits 1: it can explain a red job, never turn one green.
#
# Inputs from ci.yml: DEPS, INSTALL and CHECK are those steps' outcomes;
# NEEDS_APT is "true" when the cache could not cover WebKit's system packages.
set -u

if [ "${INSTALL:-}" = failure ] && [ -n "${NEEDS_APT:-}" ]; then
  why="WebKit's system packages could not be downloaded: the cache did not hold them all, and the Ubuntu package servers did not answer in time (the install step's log shows the 'Err:' or 'Temporary failure resolving' lines)."
elif [ "${INSTALL:-}" = failure ]; then
  why="The WebKit browser could not be downloaded from Playwright's server. Its system packages came from the cache."
elif [ "${CHECK:-}" = failure ]; then
  why="WebKit's system packages were still missing after the install; the check step lists them."
elif [ "${DEPS:-}" = failure ]; then
  why="Installing WebKit's system packages from the cache broke before the browser install began."
else
  why="A setup step failed before the tests."
fi

echo "::error title=No WebKit test ran::$why No test ran, so this is not a test failure. Re-run the job once the download works."
{
  echo "### No WebKit test ran"
  echo
  echo "$why"
  echo
  echo "This job is red because of a download or setup problem, not because a test failed."
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
exit 1
