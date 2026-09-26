#!/usr/bin/env bash
# Overlay pane: prompt for a task, route it with Laya, launch the agent.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

origin="$(cat "$ORIGIN_FILE" 2>/dev/null || true)"
if [ -z "$origin" ]; then
  echo "Could not tell which pane you were in. Trigger this from a pane (action or keybinding)."
  hold
  exit 4
fi

echo "Laya Router — describe the task (empty cancels)"
echo
read -r -e -p "task> " task || task=""
if [ -z "${task// /}" ]; then
  echo "Cancelled."
  exit 0
fi

echo
if router route "$task" --pane "$origin"; then
  notify "Laya Router" "Launched: ${task:0:60}"
  sleep 1
else
  code=$?
  notify "Laya Router" "Routing failed (exit $code), see the pane"
  hold
  exit "$code"
fi
