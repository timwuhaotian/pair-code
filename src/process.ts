import { query, type Query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { PairState, AgentRuntime, ToolEvent, TokenUsage, ActivityPhase } from './types.js';
import { resolveProfile, profileEnv } from './providers.js';
import { addMessage, hasFinishSignal, setPairStatus, updateActivity, getConversationHistory, getGitChanges, prepareRun, getTaskSpec, initializeGreetingState, addGreetingMessage, isGreetingComplete } from './state.js';

const TURN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per turn
const EMPTY_OUTPUT = '(No textual output produced)';

// The mentor is statically read-only: it may inspect the repo to verify, but
// can never mutate it. The `tools` option (in runTurn's Options) is the
// primary enforcement — it restricts the mentor's *available* tool set to only
// these three. `disallowedTools` below is defense-in-depth in case a future SDK
// change re-introduces a tool outside the allowlist.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const NON_READ_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'Skill'];

// ── Streaming primitives ────────────────────────────────────────────────

export interface TurnCallbacks {
  onTextDelta: (text: string) => void;
  onToolStart: (ev: ToolEvent) => void;
  onToolEnd: (id: string, status: 'done' | 'error') => void;
  onSessionId: (id: string) => void;
  onActivity: (phase: ActivityPhase, label: string) => void;
}

export interface TurnResult {
  output: string;
  sessionId?: string;
  tokenUsage?: TokenUsage;
}

// Module-level reference to the active query, used by killActiveTurn() to
// interrupt an in-flight turn. This is safe because the pair engine is
// strictly sequential: at most one runTurn() is ever in flight (the loop
// awaits each turn before starting the next), so there is no concurrent
// access to this variable.
let activeQuery: Query | null = null;

export function killActiveTurn(): void {
  if (activeQuery) {
    // The AbortController.abort() in runTurn is the real interrupt mechanism;
    // interrupt() is best-effort. Chain a .catch so a rejected interrupt() can't
    // escape as an unhandled rejection (a sync throw is caught by the try too).
    try { void Promise.resolve(activeQuery.interrupt()).catch(() => {}); } catch { /* ignore */ }
  }
}

/** Best-effort extraction of a human-readable target (file path, command, …) from a tool_use input. */
function toolTarget(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

export async function runTurn(
  directory: string,
  role: 'mentor' | 'executor',
  runtime: AgentRuntime,
  message: string,
  cbs: TurnCallbacks,
): Promise<TurnResult> {
  const resolved = resolveProfile(runtime.profileName);
  if (!resolved) {
    throw new Error(`Profile "${runtime.profileName}" is not configured — set PAIR_PROFILE_${runtime.profileName.toUpperCase()}_KEY (and _BASE_URL) in your environment.`);
  }

  const isMentor = role === 'mentor';
  const controller = new AbortController();

  const options: Options = {
    cwd: directory,
    model: runtime.model,
    env: profileEnv(resolved),
    resume: runtime.sessionId,
    includePartialMessages: true,
    // The executor runs with full tool access and bypassed permissions (it
    // writes code). The mentor is read-only: `tools` restricts its available
    // set to Read/Grep/Glob (the primary enforcement), with `disallowedTools`
    // as defense-in-depth. Because the mentor only has safe read tools, it
    // does not need bypassPermissions or allowDangerouslySkipPermissions.
    permissionMode: isMentor ? undefined : 'bypassPermissions',
    allowDangerouslySkipPermissions: isMentor ? undefined : true,
    abortController: controller,
    tools: isMentor ? READ_ONLY_TOOLS : { type: 'preset', preset: 'claude_code' },
    allowedTools: isMentor ? READ_ONLY_TOOLS : undefined,
    disallowedTools: isMentor ? NON_READ_TOOLS : undefined,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: isMentor ? MENTOR_APPEND : EXECUTOR_APPEND,
    },
    stderr: (data: string) => {
      const line = data.trim();
      if (!line) return;
      const lower = line.toLowerCase();
      if (/(rate ?limit|exhausted|429|throttl|overload)/.test(lower)) cbs.onActivity('thinking', 'Throttled — waiting');
      else if (/(auth|unauthor|invalid api key|credential)/.test(lower)) cbs.onActivity('thinking', 'Auth issue');
    },
  };

  // Accumulate streamed text in an array and join once at the end — avoids
  // O(n²) string concatenation on very long responses.
  const textChunks: string[] = [];
  let finalText = '';
  let sessionId: string | undefined = runtime.sessionId;
  let tokenUsage: TokenUsage | undefined;
  let firstToken = true;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    killActiveTurn();
  }, TURN_TIMEOUT_MS);

  const q = query({ prompt: message, options });
  activeQuery = q;

  try {
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        cbs.onSessionId(sessionId);
        cbs.onActivity('thinking', 'Analyzing');
        continue;
      }

      if (msg.type === 'stream_event') {
        const ev = msg.event;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
          if (firstToken) { cbs.onActivity('responding', 'Writing'); firstToken = false; }
          textChunks.push(ev.delta.text);
          cbs.onTextDelta(ev.delta.text);
        }
        continue;
      }

      if (msg.type === 'assistant') {
        for (const b of msg.message.content) {
          if (b.type === 'tool_use') {
            cbs.onActivity('using_tools', b.name);
            cbs.onToolStart({ id: b.id, name: b.name, target: toolTarget(b.input), status: 'running' });
          }
        }
        continue;
      }

      if (msg.type === 'user') {
        const content = msg.message.content;
        const blocks = typeof content === 'string' ? [] : content;
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            cbs.onToolEnd(b.tool_use_id, b.is_error ? 'error' : 'done');
          }
        }
        continue;
      }

      if (msg.type === 'result') {
        sessionId = msg.session_id;
        tokenUsage = {
          outputTokens: msg.usage.output_tokens,
          inputTokens: msg.usage.input_tokens,
          costUsd: msg.total_cost_usd,
        };
        if (msg.subtype === 'success') {
          finalText = msg.result;
        } else {
          const detail = msg.errors.length ? msg.errors.join('; ') : msg.subtype;
          throw new Error(`${role} agent ended with ${msg.subtype}: ${detail}`);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    if (activeQuery === q) activeQuery = null;
  }

  if (controller.signal.aborted && !finalText) {
    // A timeout-driven abort and a user-stop abort look identical on the
    // signal; the timedOut flag lets us surface the real cause so the error
    // panel doesn't show a misleading "/model" hint for a 10-minute timeout.
    throw new Error(timedOut ? `${role} turn timed out after 10 minutes` : `${role} turn aborted`);
  }

  return {
    output: finalText.trim() || textChunks.join('').trim() || EMPTY_OUTPUT,
    sessionId,
    tokenUsage,
  };
}

// ── Handoff prompts ─────────────────────────────────────────────────────

const MENTOR_APPEND =
  'You are the MENTOR in a pair-programming loop: you PLAN and REVIEW, you never write code. ' +
  'You are running in READ-ONLY mode — you may use Read, Grep and Glob to inspect the repository and verify claims, but you have no write or shell tools. ' +
  'Be precise and demanding about correctness.';

const EXECUTOR_APPEND =
  'You are the EXECUTOR in a pair-programming loop: you implement the mentor\'s plan with full tool access. ' +
  'After making changes, verify them yourself (build / typecheck / tests as appropriate) and include the relevant command output as evidence in your hand-off, because the mentor reviews statically and cannot run commands. ' +
  'Never emit the token TASK_COMPLETE — only the mentor may end the session.';

const HANDOFF_PROMPTS = {
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
const GREETING_PROMPTS = {
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

// ── Engine loop ─────────────────────────────────────────────────────────

export interface EngineCallbacks {
  onStateUpdate: (state: PairState) => void;
  onTextDelta: (role: string, text: string) => void;
  onToolStart: (role: string, ev: ToolEvent) => void;
  onToolEnd: (role: string, id: string, status: 'done' | 'error') => void;
  onMessage: (state: PairState) => void;
  shouldStop: () => boolean;
}

/**
 * Shared mutable state + helpers for the engine loops. Both runPairEngine and
 * runGreetingSession need the same turn-callback bridging and stop-checking
 * logic — extracting them here eliminates a 25-line copy and keeps the two
 * loops in lockstep if the contract changes.
 */
interface EngineLoop {
  state: PairState;
  update(s: PairState): void;
  turnCallbacks(role: 'mentor' | 'executor'): TurnCallbacks;
  checkStop(): boolean;
}

function createEngineLoop(initial: PairState, callbacks: EngineCallbacks): EngineLoop {
  const loop = { state: initial } as EngineLoop;
  const { onTextDelta, onToolStart, onToolEnd, shouldStop, onStateUpdate } = callbacks;

  loop.update = (s: PairState) => { loop.state = s; onStateUpdate(s); };

  loop.turnCallbacks = (role: 'mentor' | 'executor'): TurnCallbacks => ({
    onTextDelta: (t) => onTextDelta(role, t),
    onToolStart: (ev) => onToolStart(role, ev),
    onToolEnd: (id, status) => onToolEnd(role, id, status),
    onSessionId: (id) => {
      loop.state = role === 'mentor'
        ? { ...loop.state, mentor: { ...loop.state.mentor, sessionId: id } }
        : { ...loop.state, executor: { ...loop.state.executor, sessionId: id } };
    },
    onActivity: (phase, label) => {
      loop.state = updateActivity(loop.state, role, phase, label);
      loop.update(loop.state);
    },
  });

  loop.checkStop = (): boolean => {
    if (shouldStop()) {
      killActiveTurn();
      loop.state = setPairStatus(loop.state, 'paused', 'Stopped by user');
      loop.update(loop.state);
      return true;
    }
    return false;
  };

  return loop;
}

/** Apply a turn's sessionId + tokenUsage back into the runtime for the given role. */
function applyTurnResult(state: PairState, role: 'mentor' | 'executor', result: TurnResult): PairState {
  // Accumulate spend on every turn (including greeting turns) regardless of whether a sessionId came back.
  const withCost: PairState = { ...state, totalCostUsd: state.totalCostUsd + (result.tokenUsage?.costUsd ?? 0) };
  if (!result.sessionId) return withCost;
  return role === 'mentor'
    ? { ...withCost, mentor: { ...withCost.mentor, sessionId: result.sessionId, tokenUsage: result.tokenUsage } }
    : { ...withCost, executor: { ...withCost.executor, sessionId: result.sessionId, tokenUsage: result.tokenUsage } };
}

export async function runPairEngine(
  initialState: PairState,
  callbacks: EngineCallbacks,
): Promise<PairState> {
  const loop = createEngineLoop(initialState, callbacks);
  const { update, turnCallbacks, checkStop } = loop;
  const { onMessage } = callbacks;

  // Derive resumption from progress, not from a sessionId: a mentor-endpoint
  // change clears mentor.sessionId, but the run still has prior iterations and
  // messages, so it must NOT be re-planned from scratch. The sessionId is only
  // used to pass resume:<sessionId> at turn time (and only when present).
  const isResumption = loop.state.iteration > 0 || loop.state.messages.length > 0;
  if (!isResumption) loop.state = { ...loop.state, turn: 'mentor' };

  // Resuming from a finite max-iterations pause would otherwise run one
  // unreviewed executor turn and immediately re-pause without advancing. Raise
  // the effective cap by one full round so a resume guarantees at least one
  // executor→mentor round-trip. The default Infinity is unaffected.
  if (isResumption && Number.isFinite(loop.state.maxIterations) && loop.state.iteration >= loop.state.maxIterations) {
    loop.state = { ...loop.state, maxIterations: loop.state.iteration + 1 };
  }

  try {
    let latestPlan: string;
    const spec = getTaskSpec(loop.state);

    // No-progress guard: an executor that produces no usable text (empty turns
    // substitute EMPTY_OUTPUT) — or repeats the prior turn verbatim — would
    // otherwise spin until maxIterations (default Infinity). Bail after this
    // many consecutive empty/identical executor outputs.
    const MAX_NO_PROGRESS_TURNS = 3;
    let noProgressTurns = 0;
    let prevExecutorOutput: string | undefined;

    if (!isResumption) {
      loop.state = prepareRun(loop.state, 'mentor');
      update(loop.state);
      if (checkStop()) return loop.state;

      const mentorResult = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, HANDOFF_PROMPTS.initialMentor(spec), turnCallbacks('mentor'));

      loop.state = applyTurnResult(loop.state, 'mentor', mentorResult);
      loop.state = addMessage(loop.state, { from: 'mentor', to: 'executor', type: 'plan', content: mentorResult.output });
      loop.state = updateActivity(loop.state, 'mentor', 'idle', 'Planning complete');
      update(loop.state);
      onMessage(loop.state);
      latestPlan = mentorResult.output;
    } else {
      // Skip 'handoff' marker messages — they carry only a UI label ("Passing
      // back to executor with feedback"), not an actionable plan.
      const lastMentorMsg = [...loop.state.messages].reverse().find(m => m.from === 'mentor' && m.type !== 'handoff');
      latestPlan = lastMentorMsg?.content ?? `Continue the task: ${spec}`;
    }

    while (loop.state.status !== 'finished' && loop.state.status !== 'error' && loop.state.status !== 'paused') {
      if (checkStop()) break;

      loop.state = prepareRun(loop.state, 'executor');
      update(loop.state);

      const history = getConversationHistory(loop.state);
      const executorResult = await runTurn(loop.state.directory, 'executor', loop.state.executor, HANDOFF_PROMPTS.mentorToExecutor(latestPlan, spec), turnCallbacks('executor'));

      loop.state = applyTurnResult(loop.state, 'executor', executorResult);
      loop.state = addMessage(loop.state, { from: 'executor', to: 'mentor', type: 'result', content: executorResult.output });
      loop.state = updateActivity(loop.state, 'executor', 'idle', 'Execution complete');
      update(loop.state);
      onMessage(loop.state);

      const { files: changes, gitStatus } = await getGitChanges(loop.state.directory);
      loop.state = { ...loop.state, gitStatus };
      if (changes.length > 0) loop.state = { ...loop.state, modifiedFiles: changes };
      update(loop.state);

      // No-progress guard: count consecutive executor turns that produced no
      // usable output (empty / EMPTY_OUTPUT) or repeated the prior turn verbatim.
      const trimmedOutput = executorResult.output.trim();
      const noProgress = trimmedOutput === '' || trimmedOutput === EMPTY_OUTPUT || trimmedOutput === prevExecutorOutput;
      noProgressTurns = noProgress ? noProgressTurns + 1 : 0;
      prevExecutorOutput = trimmedOutput;
      if (noProgressTurns >= MAX_NO_PROGRESS_TURNS) {
        loop.state = setPairStatus(loop.state, 'error', `No progress: ${noProgressTurns} consecutive empty/identical turns`);
        update(loop.state);
        break;
      }

      if (checkStop()) break;

      loop.state = prepareRun(loop.state, 'mentor');
      update(loop.state);

      const reviewResult = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, HANDOFF_PROMPTS.executorToMentor(executorResult.output, spec, history), turnCallbacks('mentor'));

      loop.state = applyTurnResult(loop.state, 'mentor', reviewResult);

      const mentorWantsFinish = hasFinishSignal(reviewResult.output);
      loop.state = addMessage(loop.state, { from: 'mentor', to: 'executor', type: 'acceptance', content: reviewResult.output });
      loop.state = updateActivity(loop.state, 'mentor', 'idle', 'Review complete');
      update(loop.state);
      onMessage(loop.state);

      if (mentorWantsFinish) {
        loop.state = setPairStatus(loop.state, 'finished', 'Mentor signaled task complete');
        update(loop.state);
        break;
      }

      // Finite-cap check, AFTER the mentor review so a finite cap ends on a
      // completed, reviewed round rather than on unreviewed executor work.
      // Only fires when a finite cap was set explicitly; the default is
      // Infinity (unlimited), so the loop runs until the mentor finishes.
      if (Number.isFinite(loop.state.maxIterations) && loop.state.iteration >= loop.state.maxIterations) {
        loop.state = setPairStatus(loop.state, 'paused', `Max iterations reached (${loop.state.maxIterations})`);
        update(loop.state);
        break;
      }

      latestPlan = reviewResult.output;

      if (loop.state.status !== 'finished' && loop.state.status !== 'paused' && loop.state.status !== 'error') {
        loop.state = addMessage(loop.state, { from: 'mentor', to: 'executor', type: 'handoff', content: 'Passing back to executor with feedback' });
        update(loop.state);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (callbacks.shouldStop()) {
      loop.state = setPairStatus(loop.state, 'paused', 'Stopped by user during turn');
    } else {
      loop.state = setPairStatus(loop.state, 'error', msg);
    }
    update(loop.state);
  }

  return loop.state;
}

// ── Greeting smoke-test loop ─────────────────────────────────────────────
//
// Unlike the open-ended task loop (which must NOT auto-finish — it waits for
// the mentor's TASK_COMPLETE up to maxIterations), the greeting session owns
// its own termination: once the mentor's ack turn runs and the exchange is
// complete, it finishes unconditionally so it can never hang.
//
// Round flow (matches GreetingState.maxRounds = 2):
//   1. mentor  — greet the executor            → greeting round 1
//   2. executor — greet back, confirm ready     → greeting round 2 (complete)
//   3. mentor  — ack, then emit TASK_COMPLETE   → status 'finished'
export async function runGreetingSession(
  initialState: PairState,
  callbacks: EngineCallbacks,
): Promise<PairState> {
  const loop = createEngineLoop(initialState, callbacks);
  const { update, turnCallbacks, checkStop } = loop;
  const { onMessage } = callbacks;

  if (!loop.state.greetingState) loop.state = { ...loop.state, greetingState: initializeGreetingState() };

  try {
    // Turn 1 — mentor greets.
    loop.state = { ...prepareRun(loop.state, 'mentor'), status: 'greeting' };
    update(loop.state);
    if (checkStop()) return loop.state;

    const mentorHello = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, GREETING_PROMPTS.mentorHello(), turnCallbacks('mentor'));
    loop.state = applyTurnResult(loop.state, 'mentor', mentorHello);
    loop.state = addGreetingMessage(loop.state, 'mentor', mentorHello.output);
    loop.state = addMessage(loop.state, { from: 'mentor', to: 'executor', type: 'greeting', content: mentorHello.output });
    loop.state = updateActivity(loop.state, 'mentor', 'idle', 'Greeting sent');
    update(loop.state);
    onMessage(loop.state);

    if (checkStop()) return loop.state;

    // Turn 2 — executor greets back.
    loop.state = { ...prepareRun(loop.state, 'executor'), status: 'greeting' };
    update(loop.state);
    if (checkStop()) return loop.state;

    const executorHello = await runTurn(loop.state.directory, 'executor', loop.state.executor, GREETING_PROMPTS.executorHello(mentorHello.output), turnCallbacks('executor'));
    loop.state = applyTurnResult(loop.state, 'executor', executorHello);
    loop.state = addGreetingMessage(loop.state, 'executor', executorHello.output);
    loop.state = addMessage(loop.state, { from: 'executor', to: 'mentor', type: 'greeting', content: executorHello.output });
    loop.state = updateActivity(loop.state, 'executor', 'idle', 'Ready');
    update(loop.state);
    onMessage(loop.state);

    if (checkStop()) return loop.state;

    // Turn 3 — mentor acknowledges and finishes (owns TASK_COMPLETE).
    loop.state = { ...prepareRun(loop.state, 'mentor'), status: 'greeting' };
    update(loop.state);
    if (checkStop()) return loop.state;

    const mentorAck = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, GREETING_PROMPTS.mentorFinish(executorHello.output), turnCallbacks('mentor'));
    loop.state = applyTurnResult(loop.state, 'mentor', mentorAck);
    loop.state = addMessage(loop.state, { from: 'mentor', to: 'executor', type: 'greeting', content: mentorAck.output });
    loop.state = updateActivity(loop.state, 'mentor', 'idle', 'Acknowledged');
    update(loop.state);
    onMessage(loop.state);

    // The greeting session finishes on its own terms — finish whether or not the
    // model emitted the token, so it can never hang to maxIterations.
    if (hasFinishSignal(mentorAck.output) || isGreetingComplete(loop.state)) {
      loop.state = setPairStatus(loop.state, 'finished', 'Greeting complete');
      update(loop.state);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (callbacks.shouldStop()) {
      loop.state = setPairStatus(loop.state, 'paused', 'Stopped by user during turn');
    } else {
      loop.state = setPairStatus(loop.state, 'error', msg);
    }
    update(loop.state);
  }

  return loop.state;
}
