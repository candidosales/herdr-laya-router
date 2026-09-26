// Deterministic routing: Laya's answers + config -> agent, model, effort.

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

const EFFORTS = ["low", "medium", "high"];

export function onPath(bin) {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function tierFor(score) {
  if (score < 1.25) return "light";
  if (score < 2.25) return "standard";
  return "heavy";
}

export function effortFor({ tier, family, ambiguous, risky }) {
  let i = { light: 0, standard: 1, heavy: 2 }[tier];
  const reasons = [`${tier} scope -> ${EFFORTS[i]}`];
  if (ambiguous > 0.5 || risky > 0.5) {
    i = Math.min(i + 1, 2);
    reasons.push(`${risky > 0.5 ? "risky" : "ambiguous"} -> bump to ${EFFORTS[i]}`);
  }
  if ((family === "planning" || family === "research") && i < 1) {
    i = 1;
    reasons.push(`${family} -> at least medium`);
  }
  return { effort: EFFORTS[i], reasons };
}

/** Nearest effort the model supports; null means pass no effort flag. */
export function clampEffort(effort, supported) {
  if (supported.length === 0) return null;
  if (supported.includes(effort)) return effort;
  const want = EFFORTS.indexOf(effort);
  return [...supported].sort((a, b) => Math.abs(EFFORTS.indexOf(a) - want) - Math.abs(EFFORTS.indexOf(b) - want))[0];
}

function eligibility(cfg, modelId, isAvailable) {
  const m = cfg.models[modelId];
  const agent = cfg.agents[m.agent];
  if (!agent.enabled) return `agent ${m.agent} disabled`;
  if (agent.exhausted) return `agent ${m.agent} marked exhausted`;
  if (!isAvailable(agent.bin ?? agent.kind)) return `${agent.bin ?? agent.kind} not on PATH`;
  return null;
}

function pick(cfg, family, tier, isAvailable) {
  const skipped = [];
  for (const id of cfg.routes[family][tier]) {
    const why = eligibility(cfg, id, isAvailable);
    if (!why) return { id, skipped };
    skipped.push({ id, why });
  }
  return { id: null, skipped };
}

export function decide(cfg, answers, { isAvailable = onPath } = {}) {
  const family = answers.family.choice;
  const tier = tierFor(answers.scope.score);
  const { effort, reasons } = effortFor({ tier, family, ambiguous: answers.ambiguous, risky: answers.risky });
  const { id, skipped } = pick(cfg, family, tier, isAvailable);

  const route = (modelId) => {
    const m = cfg.models[modelId];
    return { modelId, agent: m.agent, kind: cfg.agents[m.agent].kind, model: m.model, effort: clampEffort(effort, m.efforts) };
  };

  // Offer the runner-up family's route when Laya is unsure about a risky task.
  let alternative = null;
  const probs = answers.family.probabilities;
  if (probs && answers.family.p < cfg.askBelow && answers.risky > 0.5) {
    const second = Object.entries(probs).sort((a, b) => b[1] - a[1])[1]?.[0];
    const alt = second && pick(cfg, second, tier, isAvailable).id;
    if (alt && alt !== id) alternative = { family: second, ...route(alt) };
  }

  return {
    family,
    tier,
    effortWanted: effort,
    reasons,
    skipped,
    chosen: id ? route(id) : null,
    alternative,
  };
}

/** Agent CLI args (after `--`, without the executable). */
export function agentArgs(route) {
  const args = [];
  if (route.model) args.push("--model", route.model);
  if (route.effort) {
    if (route.kind === "claude") args.push("--effort", route.effort);
    if (route.kind === "codex") args.push("-c", `model_reasoning_effort="${route.effort}"`);
  }
  return args;
}
