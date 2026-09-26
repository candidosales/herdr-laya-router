#!/usr/bin/env node
// Launch E2E: drives bin/router.mjs against real Herdr and the live Laya server.
// Must run inside a Herdr pane. Everything happens in a sandbox pane split off
// the current one; every pane the test opens is closed at the end.
//
// Launched agents get read-only tasks and are closed as soon as the test has
// verified which agent/model started, so they do little or no work.
//
//   node e2e/herdr-launch.mjs
//
// Writes artifacts/launch-<timestamp>.json.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLUGIN_ROOT } from "../lib/config.mjs";
import { agentArgs } from "../lib/policy.mjs";

const ROUTER = join(PLUGIN_ROOT, "bin/router.mjs");
const HERDR = process.env.HERDR_BIN_PATH ?? "herdr";
const me = process.env.HERDR_PANE_ID;
if (!me) {
  console.error("run this inside a Herdr pane (HERDR_PANE_ID is unset)");
  process.exit(1);
}

function herdr(...args) {
  const r = spawnSync(HERDR, args, { encoding: "utf8" });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { raw: r.stdout, stderr: r.stderr, status: r.status };
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const paneIds = () => new Set((herdr("pane", "list").result?.panes ?? []).map((p) => p.pane_id));
const read = (id) => spawnSync(HERDR, ["pane", "read", id, "--source", "recent", "--lines", "80"], { encoding: "utf8" }).stdout ?? "";

// Isolated config variants and decision log.
const work = mkdtempSync(join(tmpdir(), "laya-router-e2e-"));
const stateDir = join(work, "state");
mkdirSync(stateDir);
const example = JSON.parse(readFileSync(join(PLUGIN_ROOT, "config.example.json"), "utf8"));
const variant = (name, mutate) => {
  const c = structuredClone(example);
  mutate?.(c);
  const p = join(work, `${name}.json`);
  writeFileSync(p, JSON.stringify(c));
  return p;
};
const configs = {
  base: variant("base"),
  noClaude: variant("no-claude", (c) => (c.agents.claude.enabled = false)),
  none: variant("none", (c) => Object.values(c.agents).forEach((a) => (a.enabled = false))),
  // Passes the PATH check via `bin`, but herdr cannot start a gemini agent here.
  brokenAgent: variant("broken-agent", (c) => {
    c.agents = { fake: { kind: "gemini", bin: "ls", enabled: true } };
    c.models = { fake: { agent: "fake", model: null, efforts: [] } };
    for (const f of Object.keys(c.routes)) for (const t of Object.keys(c.routes[f])) c.routes[f][t] = ["fake"];
  }),
};
const badConfig = join(work, "bad.json");
writeFileSync(badConfig, "{ not json");

const sandbox = herdr("pane", "split", "--pane", me, "--direction", "down", "--cwd", PLUGIN_ROOT, "--no-focus").result?.pane?.pane_id;
if (!sandbox) throw new Error("could not create sandbox pane");
const opened = new Set([sandbox]);

function env(extra = {}) {
  return { ...process.env, HERDR_PLUGIN_STATE_DIR: stateDir, LAYA_ROUTER_CONFIG: configs.base, LAYA_ROUTER_START_TIMEOUT_MS: "20000", ...extra };
}

function runSync(args, extra) {
  const r = spawnSync(process.execPath, [ROUTER, ...args], { encoding: "utf8", env: env(extra) });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split("\n").at(-1));
  } catch {}
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

/** Run a real launch; answer Claude's folder-trust prompt if it shows up. */
async function runLaunch(task, extra, cwd = PLUGIN_ROOT) {
  const known = paneIds();
  const child = spawn(process.execPath, [ROUTER, "route", task, "--pane", sandbox, "--cwd", cwd, "--json", "--yes"], { env: env(extra) });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((r) => child.on("close", r));
  let answeredTrust = false;
  let code = null;
  const deadline = Date.now() + 240_000;
  while (code === null && Date.now() < deadline) {
    code = await Promise.race([done, sleep(1000).then(() => null)]);
    for (const id of paneIds()) {
      if (known.has(id)) continue;
      opened.add(id);
      if (!answeredTrust && /trust this folder/i.test(read(id))) {
        herdr("pane", "send-keys", id, "down", "enter");
        answeredTrust = true;
      }
    }
  }
  if (code === null) child.kill("SIGKILL");
  let json = null;
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1));
  } catch {}
  return { code, json, stderr, answeredTrust };
}

const results = [];
async function check(id, failureMode, fn) {
  const t0 = Date.now();
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { pass: false, detail: `threw: ${e.message}` };
  }
  results.push({ id, failureMode, ms: Date.now() - t0, ...r });
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${id}${r.pass ? "" : `  ${JSON.stringify(r.detail).slice(0, 300)}`}`);
}

// The eval measures routing accuracy; this checks that the launch matches the decision.
async function launchCheck(task, expectKind, { extra, cwd, expectTrust = false } = {}) {
  const r = await runLaunch(task, extra, cwd);
  const e = r.json;
  if (r.code !== 0 || e?.outcome !== "launched") return { pass: false, detail: { code: r.code, stderr: r.stderr, json: e, answeredTrust: r.answeredTrust } };
  const agent = herdr("agent", "get", e.name).result?.agent;
  const command = [e.chosen.kind, ...agentArgs(e.chosen)].join(" ");
  // The agent TUI clears the screen, so look for the command line in the process table.
  const sawCommand = spawnSync("ps", ["-Ao", "args"], { encoding: "utf8" }).stdout.split("\n").some((l) => l.trim().endsWith(command));
  const pass = e.chosen.kind === expectKind && agent?.agent === e.chosen.kind && sawCommand && (!expectTrust || r.answeredTrust);
  herdr("pane", "close", e.paneId);
  return {
    pass,
    detail: { chosen: e.chosen, family: e.decision.family, tier: e.decision.tier, pane: e.paneId, command, sawCommand, agent: agent && { name: agent.name, agent: agent.agent, status: agent.agent_status }, answeredTrust: r.answeredTrust },
  };
}

try {
  await check("empty-task", "F5", () => {
    const r = runSync(["route", "   "]);
    return { pass: r.code === 2, detail: { code: r.code, stderr: r.stderr.trim() } };
  });

  await check("bad-config", "F18", () => {
    const r = runSync(["explain", "anything"], { LAYA_ROUTER_CONFIG: badConfig });
    return { pass: r.code === 2 && /config error/.test(r.stderr), detail: { code: r.code, stderr: r.stderr.trim() } };
  });

  await check("no-eligible-agent", "F11", () => {
    const r = runSync(["route", "Add a --verbose flag to the CLI.", "--json"], { LAYA_ROUTER_CONFIG: configs.none });
    return { pass: r.code === 3 && r.json?.decision?.skipped?.length > 0, detail: { code: r.code, skipped: r.json?.decision?.skipped } };
  });

  await check("outside-herdr", "F13", () => {
    const r = runSync(["route", "Add a --verbose flag to the CLI."], { HERDR_PANE_ID: "", HERDR_PLUGIN_CONTEXT_JSON: "" });
    return { pass: r.code === 4, detail: { code: r.code, stderr: r.stderr.trim() } };
  });

  await check("laya-down-fallback", "F1/F2", () => {
    const r = runSync(["explain", "Fix the login crash in production", "--json"], { LAYA_URL: "http://127.0.0.1:9" });
    return { pass: r.code === 0 && r.json?.source === "fallback" && r.json?.decision?.chosen, detail: { code: r.code, source: r.json?.source, reason: r.json?.answers?.fallbackReason, chosen: r.json?.decision?.chosen } };
  });

  await check("secret-redacted-in-log", "F7", () => {
    const r = runSync(["explain", "Connect to the db with password=hunter2 and fix the query", "--json"]);
    const log = readFileSync(join(stateDir, "decisions.jsonl"), "utf8");
    return { pass: r.code === 0 && !log.includes("hunter2") && log.includes("[redacted]"), detail: { code: r.code, preview: r.json?.taskPreview } };
  });

  await check("launch-read-only-task", "happy path", () =>
    launchCheck("Find out whether Stripe supports partial refunds on disputed charges. Answer in chat only; do not edit files.", "claude"),
  );

  // A fresh directory is untrusted, so Claude stops at its folder-trust prompt (F15).
  await check("launch-planning-task-untrusted-dir", "F15", () =>
    launchCheck("Draft an architecture for a model router before any code is written. Answer in chat only; do not edit files.", "claude", { cwd: mkdtempSync(join(work, "untrusted-")), expectTrust: true }),
  );

  // Dry run: routing must fall through to the next agent. Launching is covered by
  // the claude cases; a broken agent binary by agent-start-fails.
  await check("claude-disabled-falls-through", "F11 partial", () => {
    const r = runSync(["explain", "Explain how Node's event loop orders promises and timers.", "--json"], { LAYA_ROUTER_CONFIG: configs.noClaude });
    const skippedClaude = r.json?.decision?.skipped?.some((s) => /claude disabled/.test(s.why));
    return { pass: r.code === 0 && r.json?.decision?.chosen?.modelId === "opencode" && skippedClaude, detail: { code: r.code, decision: r.json?.decision } };
  });

  await check("agent-start-fails", "F16", async () => {
    const known = paneIds();
    const r = await runLaunch("Add a --verbose flag to the CLI.", { LAYA_ROUTER_CONFIG: configs.brokenAgent });
    const leftover = [...paneIds()].filter((id) => !known.has(id));
    return { pass: r.code === 5 && leftover.length === 0, detail: { code: r.code, stderr: r.stderr.trim().slice(0, 200), leftover } };
  });
} finally {
  for (const id of opened) if (paneIds().has(id)) herdr("pane", "close", id);
}

const summary = { at: new Date().toISOString(), herdr: spawnSync(HERDR, ["--version"], { encoding: "utf8" }).stdout.trim(), passed: results.filter((r) => r.pass).length, total: results.length };
mkdirSync(join(PLUGIN_ROOT, "artifacts"), { recursive: true });
const out = join(PLUGIN_ROOT, "artifacts", `launch-${summary.at.replace(/[:.]/g, "-").slice(0, 19)}.json`);
writeFileSync(out, JSON.stringify({ summary, results, decisions: readFileSync(join(stateDir, "decisions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) }, null, 2));
console.log(`\n${summary.passed}/${summary.total} passed\nartifact: ${out}`);
process.exitCode = summary.passed === summary.total ? 0 : 1;
