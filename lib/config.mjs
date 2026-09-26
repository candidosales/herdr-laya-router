import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAMILIES } from "./questions.mjs";

export const PLUGIN_ROOT = process.env.HERDR_PLUGIN_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const TIERS = ["light", "standard", "heavy"];

export class ConfigError extends Error {}

export function configPath() {
  if (process.env.LAYA_ROUTER_CONFIG) return process.env.LAYA_ROUTER_CONFIG;
  const dir = process.env.HERDR_PLUGIN_CONFIG_DIR;
  if (dir && existsSync(join(dir, "config.json"))) return join(dir, "config.json");
  return join(PLUGIN_ROOT, "config.example.json");
}

export function expandHome(p) {
  return p?.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function loadConfig(path = configPath()) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new ConfigError(`${path}: ${e.message}`);
  }
  cfg.laya = { url: "http://127.0.0.1:8770", timeoutMs: 5000, ...cfg.laya };
  if (process.env.LAYA_URL) cfg.laya.url = process.env.LAYA_URL;
  cfg.laya.url = cfg.laya.url.replace(/\/$/, "");
  cfg.askBelow ??= 0.45;

  for (const [id, m] of Object.entries(cfg.models ?? {})) {
    if (!cfg.agents?.[m.agent]) throw new ConfigError(`${path}: models.${id}.agent "${m.agent}" is not in agents`);
    m.efforts ??= [];
  }
  for (const family of Object.keys(FAMILIES)) {
    for (const tier of TIERS) {
      const list = cfg.routes?.[family]?.[tier];
      if (!Array.isArray(list) || list.length === 0) throw new ConfigError(`${path}: routes.${family}.${tier} must be a non-empty list`);
      for (const id of list) if (!cfg.models[id]) throw new ConfigError(`${path}: routes.${family}.${tier} names unknown model "${id}"`);
    }
  }
  cfg.path = path;
  return cfg;
}
