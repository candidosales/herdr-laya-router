# Laya Router for Herdr

Local task routing for AI coding agents in [Herdr](https://herdr.dev).

Describe a task. [Laya](https://brainfunctioncollapse.com/laya), a decision model running on your machine, classifies it. The router picks the agent, model and reasoning effort, then starts that agent in a new pane next to the one you are working in and hands it the task.

```text
$ router explain "Audit the auth module for security issues"
family   review (p=0.81)
scope    1.75 -> standard
flags    ambiguous=0.11 risky=0.65
effort   high  (standard scope -> medium; risky -> bump to high)
route    claude --model sonnet (effort high)  [claude-sonnet]
laya     266 ms (english)
```

> **Pre-release (0.1.x).** Routing accuracy is measured on 42 hand-labelled tasks that were also used for tuning, so treat the numbers under [Tests](#tests) as optimistic.

## Why Laya Router?

- **Task text stays on your machine.** Laya runs locally. There is no API key and no hosted LLM call.
- **Fast.** A warm classification takes about 110 to 270 ms.
- **The model reads the task; the policy makes the decision.** Laya only answers questions about the task (type, size, ambiguous, risky). Plain code and your config pick the agent, model and effort, so every route can be explained and changed.
- **Keeps working when Laya is down.** A keyword classifier takes over, and the decision says so.
- **Agent-agnostic.** Claude Code, Codex and OpenCode, launched through Herdr's own `agent start`.
- **No build step.** Plain Node.js ESM with no dependencies.

Inspired by [agent-router](https://github.com/nidhi-singh02/agent-router):

| | agent-router | Laya Router |
|---|---|---|
| Ranking | TypeSafe, a hosted API that receives the task text | Laya, a local model |
| When the ranker is unavailable | No routing | Keyword fallback |
| Quota handling | Usage collectors and reserve floors | Manual `exhausted` flag per agent |
| Agents | Cursor, Claude Code, Codex, OpenCode | Claude Code, Codex, OpenCode |
| Packaging | CLI plus a Herdr plugin | Herdr plugin with a CLI |

## How it routes

1. Laya answers four questions about the task:
   - **family**: planning, coding, debugging, review, research or writing
   - **scope**: a score from 0 to 3
   - **ambiguous**: P(true)
   - **risky**: P(true) that the task touches production, security, auth, payments, migrations or deleting data
2. Deterministic code maps those answers to a route:
   - **tier**: scope < 1.25 is light, < 2.25 is standard, anything higher is heavy.
   - **effort**: follows the tier (low, medium, high). It goes up one level when the task is ambiguous or risky. Planning and research never get less than medium.
   - **candidates**: `routes[family][tier]` in the config, tried in order. A candidate is skipped when its agent is disabled, marked exhausted, or missing from PATH.
   - **effort flag**: clamped to what the chosen model supports.
3. If a keyword check finds a risk word and Laya scored the task as safe, the risky score is raised to 0.8.
4. If the family confidence is below `askBelow` and the task is risky, the interactive pane offers the runner-up route before launching.
5. If Laya is down or does not answer within `laya.timeoutMs` (15 s), a keyword classifier takes over and the decision is marked `source: "fallback"`. The first request after Laya sits idle can take more than 5 s, so the startup hook sends one warm-up request.

Every decision is appended to `decisions.jsonl` in the plugin state directory. The log stores a hash of the task and a 120-character preview with secrets redacted.

## Requirements

- Herdr 0.9.0 or later, on macOS or Linux
- Node.js 20 or later. There are no npm dependencies and no build step.
- A running Laya server. The default URL is `http://127.0.0.1:8770`.
- At least one agent CLI: `claude`, `opencode` or `codex`

## Install

```sh
herdr plugin install candidosales/herdr-laya-router
# or, from a checkout:
herdr plugin link ~/Documents/Projects/herdr-laya-router
```

Copy `config.example.json` to `~/.config/herdr/plugins/config/candidosales.laya-router/config.json` and edit it. The router looks for its config in this order:

1. `LAYA_ROUTER_CONFIG`
2. `$HERDR_PLUGIN_CONFIG_DIR/config.json`
3. `config.example.json`

The `LAYA_URL` environment variable overrides `laya.url`.

## Use

Herdr actions:

| Action | What it does |
|---|---|
| Laya: route a task | Prompts for a task, then launches the chosen agent in a split to the right |
| Laya: router status | Shows Laya health, agent availability and recent decisions |
| Laya: start server | Runs `server.py` from `laya.serverDir` in a split, unless Laya is already up |

CLI, for scripts or other agents. The examples above use `router` as an alias for `node bin/router.mjs`:

```sh
node bin/router.mjs explain "Fix the login crash in production"     # decide only, launch nothing
node bin/router.mjs route "Add a --verbose flag" --pane w1:p4 --yes  # decide and launch
node bin/router.mjs status --json
node bin/router.mjs warm            # one throwaway Laya request; the startup hook runs this
```

Exit codes: `2` usage or config error, `3` no eligible agent, `4` not inside Herdr, `5` launch failed.

## Config

- `agents`: a map from name to `{kind, enabled, exhausted, bin?}`. Set `exhausted: true` to stop routing to an agent while you are out of quota.
- `models`: each entry is `{agent, model, efforts}`. Set `model: null` to use the agent's default model. An empty `efforts` list means no effort flag is passed.
- `routes`: `family → tier → [modelId, ...]`, in order of preference.

The config is validated at load time. An unknown model or agent reference makes the router exit with code 2 and name the bad key.

## Tests

Both tests are end-to-end. Each writes a timestamped artifact to `artifacts/`.

```sh
node e2e/routing-eval.mjs             # 42 labelled tasks against live Laya
node e2e/routing-eval.mjs --fallback  # the same tasks against the keyword classifier
node e2e/herdr-launch.mjs             # run inside a Herdr pane: real splits and real agent launches
```

Latest routing eval:

| Classifier | Family | Tier | Risky | p50 |
|---|---|---|---|---|
| Laya | 88% | 62% | 90% | 112 ms |
| Keyword fallback | 76% | 43% | 86% | 0 ms |

Tier is the weakest signal. Most tier misses are one level off, so the result is an effort one step too high or too low, not the wrong agent.

`herdr-launch.mjs` result: 10/10. The run covers:

- empty task
- bad config
- no eligible agent
- running outside Herdr
- Laya down, with fallback
- secret redaction in the log
- two real Claude launches, one of them in an untrusted directory where the test answers Claude's folder-trust prompt
- routing falling through to another agent when Claude is disabled
- an agent that fails to start, which must leave no pane behind

[docs/failure-modes.md](docs/failure-modes.md) lists each failure mode and the check that covers it.

## Known limits

- When an agent stops at a trust or login prompt, the router notifies you and waits up to 3 minutes for you to answer before it sends the task.
- The `opencode` launch path is only covered by a dry run. On the development machine `opencode --version` is killed with exit code 137.
- Codex routes are configured but untested, because Codex was not installed.
