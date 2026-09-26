import { classify, LayaError } from "./laya.mjs";
import { classifyByKeywords, mentionsRisk } from "./fallback.mjs";

/**
 * Laya first, keyword fallback when it is unreachable. An explicit mention of
 * production/auth/payments/etc. is a fact code can check, so it floors `risky`
 * (Laya alone scored 79% on risky in the eval, Laya-or-keyword 86%).
 */
export async function classifyTask(cfg, task) {
  let answers;
  try {
    answers = await classify(cfg.laya, task);
  } catch (e) {
    if (!(e instanceof LayaError)) throw e;
    return { ...classifyByKeywords(task), fallbackReason: e.message };
  }
  if (mentionsRisk(task) && answers.risky <= 0.5) {
    answers.layaRisky = answers.risky;
    answers.risky = 0.8;
  }
  return answers;
}
