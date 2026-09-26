// Laya reads the task; code decides. Every question asks what the task *says*
// (perception), never what to do about it — Laya is an entailment-style encoder
// and inverts "what should we do" questions. Effort and model are derived in
// policy.mjs from these answers.

export const FAMILIES = {
  planning: "design, architecture, a plan, spec or proposal before writing code",
  coding: "build a new feature, add or change code, refactor, migrate",
  debugging: "a bug, error, crash, failing test or wrong behaviour to fix",
  review: "review, audit or critique existing code or a pull request",
  research: "investigate, compare options, read docs, explain how something works",
  writing: "docs, README, changelog, commit message, prose or an email",
};

export const SCOPE_LEVELS = [
  "a trivial one-line change or a quick question",
  "a small change in one file or one function",
  "a feature or fix touching several files",
  "a large multi-part project or a system-wide change",
];

export function taskQuestions() {
  return {
    family: {
      type: "choice",
      instructions: "What kind of work does `task` ask for?",
      criteria: FAMILIES,
    },
    scope: {
      type: "score",
      instructions: "How much work does `task` describe?",
      criteria: SCOPE_LEVELS,
    },
    ambiguous: {
      type: "noul",
      instructions: "Is `task` vague or open-ended, without a clear finished state?",
    },
    risky: {
      type: "noul",
      instructions:
        "Does `task` touch production, security, auth, payments, data migrations or deleting data?",
    },
  };
}

// The English checkpoint reads 512 tokens and cuts from the end; keep the front.
export const MAX_TASK_CHARS = 2000;

export function taskState(task) {
  return { task: task.slice(0, MAX_TASK_CHARS) };
}
