import { taskQuestions, taskState } from "./questions.mjs";

export class LayaError extends Error {}

async function call(url, { method = "GET", body, timeoutMs }) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const why = e.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : e.cause?.code ?? e.message;
    throw new LayaError(`Laya unreachable at ${url}: ${why}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new LayaError(`Laya returned non-JSON (HTTP ${res.status})`);
  }
  if (!res.ok) throw new LayaError(`Laya HTTP ${res.status}: ${data.error ?? "unknown error"}`);
  return data;
}

export function health(cfg) {
  return call(`${cfg.url}/api/health`, { timeoutMs: Math.min(cfg.timeoutMs, 3000) });
}

/** One forward pass for all task questions. Returns normalised answers. */
export async function classify(cfg, task) {
  const t0 = performance.now();
  const data = await call(`${cfg.url}/api/predict`, {
    method: "POST",
    body: { state: taskState(task), questions: taskQuestions() },
    timeoutMs: cfg.timeoutMs,
  });
  const a = data.answers ?? {};
  for (const id of ["family", "scope", "ambiguous", "risky"]) {
    if (!a[id]) throw new LayaError(`Laya response missing answer "${id}"`);
  }
  return {
    source: "laya",
    // `confidence` from Laya is 1 - normalised entropy and stays low even when the
    // top option is right; the top option's probability is the useful number.
    family: { choice: a.family.choice, p: a.family.probabilities[a.family.choice], probabilities: a.family.probabilities },
    scope: { score: a.scope.score, probabilities: a.scope.probabilities },
    ambiguous: a.ambiguous.noul,
    risky: a.risky.noul,
    latencyMs: Math.round(performance.now() - t0),
    serverLatencyMs: data.latency_ms,
    checkpoint: data.routing?.model,
  };
}
