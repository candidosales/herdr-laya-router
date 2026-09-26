import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const SECRETS = [
  /\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)\b/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gi,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\b(?:password|passwd|secret|token|cookie|authorization)\s*[:=]\s*\S+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(-----END[^-]*-----|$)/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'/:@]+:[^\s"'@]+@/gi,
];

export function redact(text) {
  return SECRETS.reduce((t, re) => t.replace(re, "[redacted]"), text);
}

function stateDir() {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR ?? join(homedir(), ".local/state/laya-router");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const file = () => join(stateDir(), "decisions.jsonl");

export function record(entry, task) {
  const line = {
    at: new Date().toISOString(),
    taskSha: createHash("sha256").update(task).digest("hex").slice(0, 12),
    taskPreview: redact(task).slice(0, 120),
    ...entry,
  };
  appendFileSync(file(), JSON.stringify(line) + "\n");
  return line;
}

export function recent(n = 10) {
  if (!existsSync(file())) return [];
  return readFileSync(file(), "utf8").trim().split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l));
}
