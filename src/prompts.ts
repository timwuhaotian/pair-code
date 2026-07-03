// Prompt templates for the pair engine. Extracted from process.ts so the
// engine file holds only control-flow logic. Keep the same export names that
// process.ts previously declared inline.

export const MENTOR_APPEND =
  'You are the MENTOR in a pair-programming loop: you PLAN and REVIEW, you never write code. ' +
  'You are running in READ-ONLY mode — you may use Read, Grep and Glob to inspect the repository and verify claims, but you have no write or shell tools. ' +
  'Be precise and demanding about correctness.';

export const EXECUTOR_APPEND =
  'You are the EXECUTOR in a pair-programming loop: you implement the mentor\'s plan with full tool access. ' +
  'After making changes, verify them yourself (build / typecheck / tests as appropriate) and include the relevant command output as evidence in your hand-off, because the mentor reviews statically and cannot run commands. ' +
  'Never emit the token TASK_COMPLETE — only the mentor may end the session.';

export const HANDOFF_PROMPTS = {
  initialMentor: (spec: string) =>
    `## Task\n${spec}\n\nCreate a detailed, actionable plan for the executor. Include: analysis of the task, a step-by-step implementation plan, files to create/modify, and key risks. You may Read/Grep/Glob the repo first to ground the plan. Do NOT emit TASK_COMPLETE in this planning turn.`,

  mentorToExecutor: (plan: string, spec: string) =>
    `## Task\n${spec}\n\n## Mentor's Plan\n${plan}\n\nExecute the plan. Make all necessary code changes, then verify them (build/typecheck/tests) and report what you changed plus the verification output. Do NOT emit TASK_COMPLETE — only the mentor can finish.`,

  executorToMentor: (executorResult: string, spec: string, history: string) =>
    `## Task\n${spec}\n\n## Conversation History\n${history}\n\n## Executor's Latest Work (with its own verification evidence)\n${executorResult}\n\nReview the work read-only. Use Read/Grep/Glob to independently confirm the changes and the evidence — do not trust the self-report blindly. Check completeness, correctness, and quality.\n\nIf it fully satisfies the task, respond with TASK_COMPLETE on its own line. Otherwise explain precisely what must be fixed and hand back.\n\nAlways include a structured review:\n\`\`\`json\n{"verdict":"pass|fail","risk":"low|medium|high","confidence":0.0-1.0,"issues":[],"evidence":[],"reasoning":"...","summary":"...","nextStep":{"action":"continue|finish","instructions":[]}}\n\`\`\``,
};

// ── Greeting smoke-test prompts ─────────────────────────────────────────
// A lightweight 3-turn script that exercises the pair loop (streaming, profile
// resolution, per-role tool asymmetry, session continuity, timeout) without a
// coding task. The mentor owns the finishing TASK_COMPLETE, preserving the
// invariant in CLAUDE.md; the executor is reminded of the prohibition on its
// turn (EXECUTOR_APPEND already forbids it).
export const GREETING_PROMPTS = {
  mentorHello: () =>
    `This is a greeting smoke-test of the pair loop — there is no coding task. ` +
    `Briefly say hello to the executor and ask it to confirm it is ready (one or two sentences). ` +
    `Do NOT plan, review, or write code. Do NOT emit TASK_COMPLETE.`,

  executorHello: (mentorHello: string) =>
    `## Mentor's greeting\n${mentorHello}\n\nThis is a greeting smoke-test — no coding task. ` +
    `Briefly say hello back and confirm you are ready (one or two sentences). Do NOT write code. ` +
    `Do NOT emit TASK_COMPLETE — only the mentor can finish.`,

  mentorFinish: (executorHello: string) =>
    `## Executor's greeting\n${executorHello}\n\nThe greeting exchange is complete. ` +
    `Acknowledge in one sentence, then end the session by emitting TASK_COMPLETE on its own line.`,
};
