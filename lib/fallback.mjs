// Keyword classifier used when Laya is unreachable. Same output shape as
// laya.classify so policy.mjs does not care which one ran.

const FAMILY_RULES = [
  ["debugging", /\b(bug|fix|error|crash|fail(s|ing|ed)?|broken|exception|regression|stack ?trace|flaky)\b/i],
  ["review", /\b(review|audit|critique|pull request|PR #?\d*)\b/i],
  ["planning", /\b(plan|design|architect(ure)?|spec|proposal|rfc|roadmap)\b/i],
  ["writing", /\b(readme|docs?|documentation|changelog|commit message|email|blog|write-?up)\b/i],
  ["research", /\b(investigate|compare|research|explain|why does|how does|evaluate)\b/i],
];

const RISK = /\b(prod(uction)?|secur\w*|auth\w*|login|credential\w*|secrets?|keys?|payments?|billing|migrations?|delete|drop table)\b/i;

export function mentionsRisk(task) {
  return RISK.test(task);
}

export function classifyByKeywords(task) {
  const family = FAMILY_RULES.find(([, re]) => re.test(task))?.[0] ?? "coding";
  let score = 1;
  if (/\b(rename|typo|one-?liner|bump|tweak)\b/i.test(task)) score = 0;
  if (/\b(several|multiple|across|end-to-end|feature|migrate|integration)\b/i.test(task)) score = 2;
  if (/\b(rewrite|system|entire|whole|platform|monorepo|from scratch)\b/i.test(task)) score = 3;
  return {
    source: "fallback",
    family: { choice: family, p: null, probabilities: null },
    scope: { score, probabilities: null },
    ambiguous: /\b(improve|better|clean ?up|somehow|ideas?)\b/i.test(task) ? 0.7 : 0.2,
    risky: mentionsRisk(task) ? 0.8 : 0.1,
    latencyMs: 0,
  };
}
