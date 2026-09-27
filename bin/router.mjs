#!/usr/bin/env node
// laya-router: classify a task with Laya, pick agent/model/effort, launch it in a Herdr pane.
//
//   router.mjs route "<task>" [--dry-run] [--json] [--cwd DIR] [--pane ID] [--yes]
//   router.mjs explain "<task>"            (route --dry-run)
//   router.mjs status [--json]
//   router.mjs warm                        (one Laya request so the next route is fast)

import { createInterface } from "node:readline/promises";
import { ConfigError, loadConfig } from "../lib/config.mjs";
import { classify, health } from "../lib/laya.mjs";
import { classifyTask } from "../lib/classify.mjs";
import { agentArgs, decide, onPath } from "../lib/policy.mjs";
import { launch, LaunchError, originPane, paneCwd } from "../lib/herdr.mjs";
import { recent, record } from "../lib/log.mjs";

const EXIT = { usage: 2, noCandidate: 3, noHerdr: 4, launch: 5 };

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { cmd, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--dry-run" || a === "--json" || a === "--yes") opts[a.slice(2).replace("-", "")] = true;
    else if (a === "--cwd" || a === "--pane") opts[a.slice(2)] = rest[++i];
    else opts.positional.push(a);
  }
  return opts;
}

function fmtRoute(r) {
  return `${r.kind}${r.model ? ` --model ${r.model}` : ""}${r.effort ? ` (effort ${r.effort})` : ""}  [${r.modelId}]`;
}

function describe(answers, decision) {
  const out = [];
  if (answers.source === "fallback") out.push(`! Laya unavailable, keyword fallback: ${answers.fallbackReason}`);
  const fam = answers.family.p == null ? answers.family.choice : `${answers.family.choice} (p=${answers.family.p.toFixed(2)})`;
  out.push(`family   ${fam}`);
  out.push(`scope    ${answers.scope.score.toFixed(2)} -> ${decision.tier}`);
  out.push(`flags    ambiguous=${answers.ambiguous.toFixed(2)} risky=${answers.risky.toFixed(2)}${answers.layaRisky == null ? "" : ` (keyword; laya said ${answers.layaRisky.toFixed(2)})`}`);
  out.push(`effort   ${decision.effortWanted}  (${decision.reasons.join("; ")})`);
  for (const s of decision.skipped) out.push(`skipped  ${s.id}: ${s.why}`);
  out.push(decision.chosen ? `route    ${fmtRoute(decision.chosen)}` : "route    none eligible");
  if (decision.alternative) out.push(`alt      ${fmtRoute(decision.alternative)}  (if this is really ${decision.alternative.family})`);
  if (answers.source === "laya") out.push(`laya     ${answers.latencyMs} ms (${answers.checkpoint})`);
  return out.join("\n");
}

async function maybeAskAlternative(decision, opts) {
  if (!decision.alternative || opts.yes || opts.json || !process.stdin.isTTY) return decision.chosen;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`\nLaya is unsure and the task looks risky.\n  1) ${fmtRoute(decision.chosen)}\n  2) ${fmtRoute(decision.alternative)}\nPick [1]: `);
  rl.close();
  return a.trim() === "2" ? decision.alternative : decision.chosen;
}

async function route(cfg, opts) {
  const task = opts.positional.join(" ").trim();
  if (!task) {
    console.error("task is empty");
    return EXIT.usage;
  }
  const answers = await classifyTask(cfg, task);
  const decision = decide(cfg, answers);
  const base = { source: answers.source, answers, decision };

  if (!opts.json) console.log(describe(answers, decision));
  if (!decision.chosen) {
    record({ ...base, outcome: "no-candidate" }, task);
    if (opts.json) console.log(JSON.stringify({ ...base, outcome: "no-candidate" }));
    return EXIT.noCandidate;
  }
  if (opts.dryrun) {
    const entry = record({ ...base, outcome: "dry-run", args: agentArgs(decision.chosen) }, task);
    if (opts.json) console.log(JSON.stringify(entry));
    return 0;
  }

  const chosen = await maybeAskAlternative(decision, opts);
  const origin = opts.pane ?? originPane();
  if (!origin) {
    console.error("not inside Herdr (no origin pane); use --dry-run or --pane");
    return EXIT.noHerdr;
  }
  const cwd = opts.cwd ?? paneCwd(origin) ?? process.cwd();
  try {
    const launched = launch({ route: chosen, task, origin, cwd, log: (l) => !opts.json && console.log(`\n${l}`) });
    const entry = record({ ...base, chosen, outcome: "launched", ...launched, cwd }, task);
    console.log(opts.json ? JSON.stringify(entry) : `\nlaunched ${launched.name} in ${launched.paneId}`);
    return 0;
  } catch (e) {
    if (!(e instanceof LaunchError)) throw e;
    record({ ...base, chosen, outcome: "launch-failed", error: e.message }, task);
    console.error(e.message);
    return EXIT.launch;
  }
}

async function status(cfg, opts) {
  let laya;
  try {
    laya = { ok: true, ...(await health(cfg.laya)) };
  } catch (e) {
    laya = { ok: false, error: e.message };
  }
  const agents = Object.entries(cfg.agents).map(([id, a]) => ({ id, ...a, onPath: onPath(a.bin ?? a.kind) }));
  const last = recent(5);
  if (opts.json) {
    console.log(JSON.stringify({ config: cfg.path, laya, agents, recent: last }));
    return 0;
  }
  console.log(`config  ${cfg.path}`);
  console.log(laya.ok ? `laya    ${cfg.laya.url}  v${laya.version} on ${laya.device}  ${JSON.stringify(laya.models)}` : `laya    DOWN  ${laya.error}`);
  for (const a of agents) {
    const state = !a.enabled ? "disabled" : a.exhausted ? "exhausted" : a.onPath ? "ready" : "not on PATH";
    console.log(`agent   ${a.id.padEnd(10)} ${state}`);
  }
  for (const d of last) console.log(`recent  ${d.at.slice(0, 16)} ${d.outcome.padEnd(13)} ${d.decision?.family ?? ""}/${d.decision?.tier ?? ""} -> ${d.chosen?.modelId ?? d.decision?.chosen?.modelId ?? "-"}  "${d.taskPreview.slice(0, 50)}"`);
  return 0;
}

// The first prediction after the server idles can take longer than the request
// timeout; one throwaway request up front keeps the user's first route off the fallback.
async function warm(cfg) {
  const t0 = Date.now();
  try {
    await classify(cfg.laya, "warm up");
  } catch (e) {
    console.error(`warm-up failed: ${e.message}`);
    return 1;
  }
  console.log(`laya warm in ${Date.now() - t0} ms`);
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`config error: ${e.message}`);
      return EXIT.usage;
    }
    throw e;
  }
  switch (opts.cmd) {
    case "route":
      return route(cfg, opts);
    case "explain":
      return route(cfg, { ...opts, dryrun: true });
    case "status":
      return status(cfg, opts);
    case "warm":
      return warm(cfg);
    default:
      console.error('usage: router.mjs route|explain "<task>" [--dry-run] [--json] [--cwd DIR] [--pane ID] [--yes]\n       router.mjs status [--json]\n       router.mjs warm');
      return EXIT.usage;
  }
}

process.exitCode = await main();
