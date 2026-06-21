#!/usr/bin/env bash
# Idempotent venv bootstrap for scrape.py. Creates <scriptsDir>/.venv once and installs deps;
# re-runs are near-instant (pip no-ops when satisfied). The venv is cached across workflow runs.
# Pass --with-playwright to additionally install playwright + the Chromium browser (needed only
# for `scrape.py --render`). Prints the venv python path on the last line for the caller to use.
set -euo pipefail

WITH_PLAYWRIGHT=0
[ "${1:-}" = "--with-playwright" ] && WITH_PLAYWRIGHT=1

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"
PY="${PYTHON:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r "$DIR/requirements.txt"

if [ "$WITH_PLAYWRIGHT" = "1" ]; then
  "$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r "$DIR/requirements-playwright.txt"
  # Chromium lands in the venv (PLAYWRIGHT_BROWSERS_PATH=0) so it is removed with the venv and
  # stays out of any user-global browser cache. Idempotent: re-runs no-op once installed.
  PLAYWRIGHT_BROWSERS_PATH=0 "$VENV/bin/python" -m playwright install chromium >&2
fi

echo "$VENV/bin/python"
