#!/usr/bin/env bash
# Idempotent venv bootstrap for recon.py's OPTIONAL tree-sitter backend. Creates <scriptsDir>/.venv
# once and installs requirements.txt; re-runs are near-instant (pip no-ops when satisfied). The venv
# is cached across workflow runs. recon.py works WITHOUT this (degraded heuristics); the venv only
# buys precise multi-language function spans + call edges. Prints the venv python path on the last
# line so the caller can run `"$(setup_venv.sh)" recon.py ...`.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$DIR/.venv"
PY="${PYTHON:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check -r "$DIR/requirements.txt" >&2

echo "$VENV/bin/python"
