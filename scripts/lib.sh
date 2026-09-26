#!/usr/bin/env bash
# Shared helpers for the Laya Router plugin scripts.

set -euo pipefail

PLUGIN_ROOT="${HERDR_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PLUGIN_ID="${HERDR_PLUGIN_ID:-candidosales.laya-router}"
HERDR="${HERDR_BIN_PATH:-herdr}"
ORIGIN_FILE="${HERDR_PLUGIN_STATE_DIR:-${TMPDIR:-/tmp}}/origin-pane"

# Herdr starts plugin commands with a minimal PATH; node and agent CLIs often
# live in mise/nvm/homebrew paths set up by the login shell. Borrow its PATH.
if ! command -v node >/dev/null 2>&1; then
  login_path="$("${SHELL:-/bin/zsh}" -lic 'printf "__PATH__%s\n" "$PATH"' 2>/dev/null | sed -n 's/^__PATH__//p' | tail -1)"
  [ -n "$login_path" ] && export PATH="$login_path:$PATH"
fi

router() {
  node "$PLUGIN_ROOT/bin/router.mjs" "$@"
}

notify() {
  "$HERDR" notification show "$1" --body "$2" >/dev/null 2>&1 || true
}

# Overlay panes close when the command exits; keep output readable.
hold() {
  echo
  read -r -p "Press Enter to close… " _ || true
}
