#!/usr/bin/env bash
# Action entrypoint: remember which pane the user was in, then open a plugin pane.
# The overlay gets its own HERDR_PANE_ID, so the origin must be captured here.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

entrypoint="${1:?usage: open-pane.sh <entrypoint-id>}"
mkdir -p "$(dirname "$ORIGIN_FILE")"
printf '%s' "${HERDR_PANE_ID:-}" >"$ORIGIN_FILE"
exec "$HERDR" plugin pane open --plugin "$PLUGIN_ID" --entrypoint "$entrypoint"
