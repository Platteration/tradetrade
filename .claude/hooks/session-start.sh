#!/usr/bin/env bash
# Claude Code on the web prepares the same locked dependencies as CI.
# Other development environments use the documented setup commands.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
npm ci --no-audit --no-fund
