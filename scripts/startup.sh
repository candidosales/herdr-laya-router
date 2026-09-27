#!/usr/bin/env bash
# Startup hook: warm Laya up, or warn once if it is down. Routing still works via
# keyword fallback.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if ! router status --json | node -e 'process.exit(JSON.parse(require("fs").readFileSync(0,"utf8")).laya.ok ? 0 : 1)'; then
  notify "Laya Router" "Laya server is down; routing will use keyword fallback. Run action 'Laya: start server'."
  exit 0
fi
router warm >/dev/null 2>&1 || true
