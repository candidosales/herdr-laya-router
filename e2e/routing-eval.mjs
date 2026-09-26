#!/usr/bin/env node
// Routing eval against a live Laya server. Runs every labeled case through the
// same classify -> decide path as `router route`, then writes a JSON + markdown
// artifact to artifacts/. Re-run after changing lib/questions.mjs to compare.
//
//   node e2e/routing-eval.mjs [--fallback]     (--fallback evaluates the keyword classifier)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, PLUGIN_ROOT } from "../lib/config.mjs";
import { classify } from "../lib/laya.mjs";
import { classifyTask } from "../lib/classify.mjs";
import { classifyByKeywords } from "../lib/fallback.mjs";
import { decide } from "../lib/policy.mjs";
import { FAMILIES, taskQuestions } from "../lib/questions.mjs";

const useFallback = process.argv.includes("--fallback");
const cfg = loadConfig();
const cases = JSON.parse(readFileSync(join(PLUGIN_ROOT, "e2e/cases.json"), "utf8"));
const allAvailable = () => true; // eval the policy, not this machine's PATH

// Warm-up so the first case does not carry checkpoint load time.
if (!useFallback) await classify(cfg.laya, "warm up");

const rows = [];
for (const c of cases) {
  const a = useFallback ? classifyByKeywords(c.task) : await classifyTask(cfg, c.task);
  if (a.source !== (useFallback ? "fallback" : "laya")) throw new Error(`Laya failed mid-eval: ${a.fallbackReason}`);
  const d = decide(cfg, a, { isAvailable: allAvailable });
  const model = d.chosen && cfg.models[d.chosen.modelId];
  if (d.chosen?.effort && !model.efforts.includes(d.chosen.effort)) throw new Error(`effort ${d.chosen.effort} not supported by ${d.chosen.modelId}`);
  rows.push({
    task: c.task.slice(0, 90),
    expected: { family: c.family, tier: c.tier, risky: c.risky },
    got: { family: a.family.choice, familyP: a.family.p, scope: a.scope.score, tier: d.tier, risky: a.risky, ambiguous: a.ambiguous },
    ok: { family: a.family.choice === c.family, tier: d.tier === c.tier, risky: a.risky > 0.5 === c.risky },
    route: d.chosen && `${d.chosen.modelId}/${d.chosen.effort ?? "-"}`,
    ask: Boolean(d.alternative),
    latencyMs: a.latencyMs,
  });
}

const acc = (k) => rows.filter((r) => r.ok[k]).length / rows.length;
const lat = rows.map((r) => r.latencyMs).sort((x, y) => x - y);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
const fams = Object.keys(FAMILIES);
const confusion = Object.fromEntries(fams.map((e) => [e, Object.fromEntries(fams.map((g) => [g, 0]))]));
for (const r of rows) confusion[r.expected.family][r.got.family]++;

const summary = {
  at: new Date().toISOString(),
  classifier: useFallback ? "keyword-fallback" : `laya @ ${cfg.laya.url}`,
  cases: rows.length,
  accuracy: { family: acc("family"), tier: acc("tier"), risky: acc("risky") },
  latencyMs: { p50: pct(0.5), p95: pct(0.95), max: lat.at(-1) },
  asks: rows.filter((r) => r.ask).length,
  questions: taskQuestions(),
};

const stamp = summary.at.replace(/[:.]/g, "-").slice(0, 19);
const tag = useFallback ? "fallback" : "laya";
mkdirSync(join(PLUGIN_ROOT, "artifacts"), { recursive: true });
const base = join(PLUGIN_ROOT, "artifacts", `routing-eval-${tag}-${stamp}`);
writeFileSync(`${base}.json`, JSON.stringify({ summary, confusion, rows }, null, 2));

const pc = (x) => `${(x * 100).toFixed(0)}%`;
const md = [
  `# Routing eval (${summary.classifier}) ${summary.at}`,
  "",
  `cases ${rows.length} | family ${pc(summary.accuracy.family)} | tier ${pc(summary.accuracy.tier)} | risky ${pc(summary.accuracy.risky)} | p50 ${summary.latencyMs.p50} ms | p95 ${summary.latencyMs.p95} ms | asks ${summary.asks}`,
  "",
  "## Family confusion (rows expected, cols got)",
  "",
  `| | ${fams.join(" | ")} |`,
  `|---|${fams.map(() => "---").join("|")}|`,
  ...fams.map((e) => `| ${e} | ${fams.map((g) => confusion[e][g] || "").join(" | ")} |`),
  "",
  "## Misses",
  "",
  "| task | expected | got | route |",
  "|---|---|---|---|",
  ...rows
    .filter((r) => !r.ok.family || !r.ok.tier || !r.ok.risky)
    .map((r) => `| ${r.task.slice(0, 60)} | ${r.expected.family}/${r.expected.tier}/${r.expected.risky ? "risky" : "safe"} | ${r.got.family}${r.got.familyP == null ? "" : `(${r.got.familyP.toFixed(2)})`}/${r.got.tier}(${r.got.scope.toFixed(2)})/${r.got.risky.toFixed(2)} | ${r.route} |`),
].join("\n");
writeFileSync(`${base}.md`, md + "\n");

console.log(md.split("\n").slice(0, 3).join("\n"));
console.log(`\nartifacts: ${base}.{json,md}`);
