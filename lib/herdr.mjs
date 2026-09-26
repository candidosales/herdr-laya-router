import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { agentArgs } from "./policy.mjs";

const HERDR = process.env.HERDR_BIN_PATH ?? "herdr";
const START_TIMEOUT_MS = Number(process.env.LAYA_ROUTER_START_TIMEOUT_MS ?? 60_000);

export class LaunchError extends Error {}

export function herdr(args, { timeoutMs = 60_000 } = {}) {
  const r = spawnSync(HERDR, args, { encoding: "utf8", timeout: timeoutMs });
  // Success JSON goes to stdout, error JSON to stderr.
  let json = null;
  for (const out of [r.stdout, r.stderr]) {
    try {
      json = JSON.parse(out);
      break;
    } catch {}
  }
  const error = json?.error ?? (r.status === 0 ? null : { code: "exit", message: (r.stderr || r.stdout || String(r.error)).trim() });
  return { ok: r.status === 0 && !json?.error, json, error };
}

export function notify(title, body) {
  herdr(["notification", "show", title, "--body", body], { timeoutMs: 5000 });
}

/**
 * The pane the user was in when they triggered the route. Plugin overlay panes
 * get their own HERDR_PANE_ID, so prefer the invocation context.
 */
export function originPane() {
  if (process.env.LAYA_ROUTER_ORIGIN_PANE) return process.env.LAYA_ROUTER_ORIGIN_PANE;
  try {
    const ctx = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}");
    const id = ctx.pane_id ?? ctx.pane?.pane_id ?? ctx.focused_pane_id;
    if (id) return id;
  } catch {}
  return process.env.HERDR_PANE_ID ?? null;
}

export function paneCwd(paneId) {
  const r = herdr(["pane", "get", paneId]);
  const p = r.json?.result?.pane ?? r.json?.result;
  return p?.foreground_cwd ?? p?.cwd ?? null;
}

function waitForStatus(name, states, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = herdr(["agent", "get", name]).json?.result?.agent?.agent_status;
    if (states.includes(status)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

/**
 * Split next to `origin`, start the agent, submit the task.
 * `log` receives progress lines for the interactive pane.
 */
export function launch({ route, task, origin, cwd, log = () => {} }) {
  const split = herdr(["pane", "split", "--pane", origin, "--direction", "right", ...(cwd ? ["--cwd", cwd] : []), "--no-focus"]);
  const paneId = split.json?.result?.pane?.pane_id;
  if (!split.ok || !paneId) throw new LaunchError(`herdr pane split failed: ${split.error?.message ?? "no pane id"}`);

  const name = `laya-${route.kind}-${randomBytes(2).toString("hex")}`;
  const args = agentArgs(route);
  log(`starting ${name} in ${paneId}: ${route.kind} ${args.join(" ")}`);
  const started = herdr(["agent", "start", name, "--kind", route.kind, "--pane", paneId, "--timeout", String(START_TIMEOUT_MS), "--", ...args], { timeoutMs: START_TIMEOUT_MS + 30_000 });

  if (!started.ok) {
    if (started.error?.code !== "agent_not_ready") {
      herdr(["pane", "close", paneId]);
      throw new LaunchError(`herdr agent start failed: ${started.error?.message}`);
    }
    // Blocked at startup: trust-folder prompt, login, etc. The user answers it.
    log(`${name} is waiting for input in ${paneId} (trust/login prompt). Answer it there; waiting up to 3 min…`);
    notify("Laya Router", `${name} needs your answer in its pane before the task can be sent`);
    // `agent wait` matches transitions, and the agent may already be idle once the
    // prompt is answered, so poll the status instead.
    if (!waitForStatus(name, ["idle", "done"], 180_000)) throw new LaunchError(`${name} never became ready. Pane ${paneId} left open.`);
  }

  const sent = herdr(["agent", "prompt", name, task]);
  if (!sent.ok) throw new LaunchError(`agent started in ${paneId} but the task was not sent (${sent.error?.message}). Paste it manually.`);
  return { paneId, name };
}
