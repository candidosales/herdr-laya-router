# Failure modes

Written before the implementation. Each entry names the expected behaviour and the
E2E check that covers it.

| # | Failure | Expected behaviour | Covered by |
|---|---|---|---|
| F1 | Laya server not running (connection refused) | Route with keyword fallback, mark `source: "fallback"`, show reason | `e2e/herdr-launch.mjs` laya-down-fallback |
| F2 | Laya slow or still loading checkpoints (timeout) | Abort request after `laya.timeoutMs`, fall back like F1 | `e2e/herdr-launch.mjs` laya-down-fallback (dead port) |
| F3 | Laya returns 400 (bad question, options over head budget) | Fall back, surface the server error text | `e2e/routing-eval.mjs` fails loudly on any 400 |
| F4 | Laya returns malformed JSON / missing answers | Fall back, name the missing answer | `e2e/routing-eval.mjs` |
| F5 | Task empty or whitespace | Refuse before any call, exit 2 | `e2e/herdr-launch.mjs` empty-task |
| F6 | Task very long (state cut at 512 tokens) | Send the first 2000 chars only | `e2e/routing-eval.mjs` long case |
| F7 | Task contains a secret | Laya is local so routing proceeds, but the decision log stores a redacted preview | `e2e/herdr-launch.mjs` secret-redacted-in-log |
| F8 | Wrong family / scope classification | Measured, not prevented: eval accuracy report per question | `e2e/routing-eval.mjs` |
| F9 | Low confidence on a risky task | Interactive pane offers the top two routes; non-interactive takes the top one and says so | `e2e/routing-eval.mjs` records `ask` |
| F10 | Chosen model does not support chosen effort | Clamp to nearest supported effort; no flag when model lists none | `e2e/routing-eval.mjs` asserts effort is in model's list |
| F11 | Every candidate disabled, exhausted or not on PATH | Exit 3 with the list of skipped candidates and why | `e2e/herdr-launch.mjs` no-eligible-agent, claude-disabled-falls-through |
| F12 | Agent CLI missing from PATH | Skip that candidate (F11 if none left) | same as F11 |
| F13 | Not running inside Herdr / no origin pane | `--dry-run` works; launch exits 4 with a clear message | `e2e/herdr-launch.mjs` outside-herdr |
| F14 | `herdr pane split` fails | No agent started, exit 5, herdr error shown | manual |
| F15 | `herdr agent start` blocked (trust prompt, login) | Keep pane, notify user, poll for idle up to 3 min, then send the task | `e2e/herdr-launch.mjs` launch-planning-task-untrusted-dir |
| F16 | `herdr agent start` fails otherwise | Close the new pane, exit 5 | `e2e/herdr-launch.mjs` agent-start-fails (unstartable agent kind) |
| F17 | `herdr agent prompt` fails | Leave agent running, print the task so the user can paste it, exit 5 | manual |
| F18 | Config file invalid JSON / unknown model id in routes | Exit 2 naming the file and the bad key | `e2e/herdr-launch.mjs` bad-config |
