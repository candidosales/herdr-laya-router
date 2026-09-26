#!/usr/bin/env bash
# Split pane: run the Laya server from laya.serverDir unless one is already up.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

read -r url dir < <(node --input-type=module -e '
  const { loadConfig, expandHome } = await import(process.argv[1]);
  const c = loadConfig();
  console.log(c.laya.url, expandHome(c.laya.serverDir ?? ""));
' "$PLUGIN_ROOT/lib/config.mjs")

if curl -fsS -m 2 "$url/api/health" >/dev/null 2>&1; then
  echo "Laya already running at $url"
  curl -fsS "$url/api/health"; echo
  hold
  exit 0
fi

if [ -z "$dir" ] || [ ! -x "$dir/.venv/bin/python" ] || [ ! -f "$dir/server.py" ]; then
  echo "laya.serverDir must point at a Laya checkout with .venv/bin/python and server.py."
  echo "Got: '${dir}'. Set it in $(router status --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).config)')"
  hold
  exit 2
fi

cd "$dir"
exec .venv/bin/python server.py
