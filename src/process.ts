import { query, type Query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { PairState, AgentRuntime, ToolEvent, TokenUsage, ActivityPhase } from './types.js';
import { resolveProfile, profileEnv } from './providers.js';
import { addMessage, hasFinishSignal, setPairStatus, updateActivity, getConversationHistory, getGitChanges, prepareRun, getTaskSpec, initializeGreetingState, addGreetingMessage, isGreetingComplete } from './state.js';

const TURN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per turn
const EMPTY_OUTPUT = '(No textual output produced)';

// The mentor is statically read-only: it may inspect the repo to verify, but
// can never mutate it. Everything not in this allowlist is also explicitly
// disallowed so the model is never even offered a write/exec tool.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const NON_READ_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch', 'TodoWrite'];

// ── Streaming primitives ────────────────────────────────────────────────

export interface TurnCallbacks {
  onTextDelta: (text: string) => void;
  onToolStart: (ev: ToolEvent) => void;
  onToolEnd: (id: string, status: 'done' | 'error') => void;
  onSessionId: (id: string) => void;
  onActivity: (phase: ActivityPhase, label: string) => void;
  onLog: (line: string) => void;
}

export interface TurnResult {
  output: string;
  sessionId?: string;
  tokenUsage?: TokenUsage;
}

let activeQuery: Query | null = null;

export function killActiveTurn(): void {
  if (activeQuery) {
    try { void activeQuery.interrupt(); } catch { /* ignore */ }
  }
}

interface LooseBlock { type?: string; id?: string; name?: string; text?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean; content?: unknown }
interface LooseStreamEvent { type?: string; delta?: { type?: string; text?: string }; content_block?: { type?: string } }

function toolTarget(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ['file_path', 'path', 'notebook_path', 'command', 'pattern', 'url', 'query']) {
    const v = input[key];
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
    permissionMode: 'bypassPermissions',
    abortController: controller,
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
      cbs.onLog(`[stderr] ${line}`);
      const lower = line.toLowerCase();
      if (/(rate ?limit|exhausted|429|throttl|overload)/.test(lower)) cbs.onActivity('thinking', 'Throttled — retrying');
      else if (/(auth|unauthor|invalid api key|credential)/.test(lower)) cbs.onActivity('thinking', 'Auth issue');
    },
  };

  let streamedText = '';
  let finalText = '';
  let sessionId: string | undefined = runtime.sessionId;
  let tokenUsage: TokenUsage | undefined;
  let firstToken = true;

  const timer = setTimeout(() => {
    controller.abort();
    killActiveTurn();
  }, TURN_TIMEOUT_MS);

  const q = query({ prompt: message, options });
  activeQuery = q;

  try {
    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        sessionId = msg.session_id;
        cbs.onSessionId(sessionId);
        cbs.onActivity('thinking', 'Analyzing');
        continue;
      }

      if (msg.type === 'stream_event') {
        const ev = msg.event as unknown as LooseStreamEvent;
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          if (firstToken) { cbs.onActivity('responding', 'Writing'); firstToken = false; }
          streamedText += ev.delta.text;
          cbs.onTextDelta(ev.delta.text);
        }
        continue;
      }

      if (msg.type === 'assistant') {
        const blocks = (msg.message.content as unknown as LooseBlock[]) ?? [];
        for (const b of blocks) {
          if (b.type === 'tool_use' && b.id) {
            cbs.onActivity('using_tools', `${b.name ?? 'tool'}`);
            cbs.onToolStart({ id: b.id, name: b.name ?? 'tool', target: toolTarget(b.input), status: 'running' });
          }
        }
        continue;
      }

      if (msg.type === 'user') {
        const blocks = (msg.message.content as unknown as LooseBlock[]) ?? [];
        for (const b of blocks) {
          if (b.type === 'tool_result' && b.tool_use_id) {
            cbs.onToolEnd(b.tool_use_id, b.is_error ? 'error' : 'done');
          }
        }
        continue;
      }

      if (msg.type === 'result') {
        sessionId = msg.session_id;
        const u = msg.usage as unknown as { output_tokens?: number; input_tokens?: number } | undefined;
        tokenUsage = {
          outputTokens: u?.output_tokens ?? 0,
          inputTokens: u?.input_tokens,
          costUsd: msg.total_cost_usd,
        };
        if (msg.subtype === 'success') {
          finalText = msg.result;
        } else {
          const detail = (msg.errors && msg.errors.length) ? msg.errors.join('; ') : msg.subtype;
          throw new Error(`${role} agent ended with ${msg.subtype}: ${detail}`);
        }
      }
    }
  } finally {
    clearTimeout(timer);
    if (activeQuery === q) activeQuery = null;
  }

  if (controller.signal.aborted && !finalText) {
    throw new Error(`${role} turn aborted`);
  }

  return {
    output: finalText.trim() || streamedText.trim() || EMPTY_OUTPUT,
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
  onLog: (role: string, line: string) => void;
  onActivity: (role: string, phase: ActivityPhase, label: string) => void;
  onTextDelta: (role: string, text: string) => void;
  onToolStart: (role: string, ev: ToolEvent) => void;
  onToolEnd: (role: string, id: string, status: 'done' | 'error') => void;
  onMessage: (state: PairState) => void;
  onError: (error: string) => void;
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
  const { onActivity, onTextDelta, onToolStart, onToolEnd, onLog, shouldStop, onStateUpdate } = callbacks;

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
      onActivity(role, phase, label);
      loop.update(loop.state);
    },
    onLog: (line) => onLog(role, line),
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

export async function runPairEngine(
  initialState: PairState,
  callbacks: EngineCallbacks,
): Promise<PairState> {
  const loop = createEngineLoop(initialState, callbacks);
  const { update, turnCallbacks, checkStop } = loop;
  const { onLog, onMessage, onError } = callbacks;

  const isResumption = !!loop.state.mentor.sessionId && loop.state.iteration > 0;
  if (!isResumption) loop.state = { ...loop.state, turn: 'mentor' };

  try {
    let latestPlan: string;
    const spec = getTaskSpec(loop.state);

    if (!isResumption) {
      loop.state = prepareRun(loop.state, 'mentor');
      update(loop.state);
      if (checkStop()) return loop.state;

      onLog('mentor', 'Planning…');
      const mentorResult = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, HANDOFF_PROMPTS.initialMentor(spec), turnCallbacks('mentor'));

      if (mentorResult.sessionId) loop.state = { ...loop.state, mentor: { ...loop.state.mentor, sessionId: mentorResult.sessionId, tokenUsage: mentorResult.tokenUsage } };
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
      onLog('mentor', 'Resuming…');
    }

    while (loop.state.status !== 'finished' && loop.state.status !== 'error' && loop.state.status !== 'paused') {
      if (checkStop()) break;

      loop.state = prepareRun(loop.state, 'executor');
      update(loop.state);

      const history = getConversationHistory(loop.state);
      onLog('executor', 'Executing…');
      const executorResult = await runTurn(loop.state.directory, 'executor', loop.state.executor, HANDOFF_PROMPTS.mentorToExecutor(latestPlan, spec), turnCallbacks('executor'));

      if (executorResult.sessionId) loop.state = { ...loop.state, executor: { ...loop.state.executor, sessionId: executorResult.sessionId, tokenUsage: executorResult.tokenUsage } };
      loop.state = addMessage(loop.state, { from: 'executor', to: 'mentor', type: 'result', content: executorResult.output });
      loop.state = updateActivity(loop.state, 'executor', 'idle', 'Execution complete');
      update(loop.state);
      onMessage(loop.state);

      const changes = await getGitChanges(loop.state.directory);
      if (changes.length > 0) { loop.state = { ...loop.state, modifiedFiles: changes }; update(loop.state); }

      // Only fires when a finite cap was set explicitly; the default is
      // Infinity (unlimited), so the loop runs until the mentor finishes.
      if (Number.isFinite(loop.state.maxIterations) && loop.state.iteration >= loop.state.maxIterations) {
        loop.state = setPairStatus(loop.state, 'paused', `Max iterations reached (${loop.state.maxIterations})`);
        update(loop.state);
        break;
      }

      if (checkStop()) break;

      loop.state = prepareRun(loop.state, 'mentor');
      update(loop.state);

      onLog('mentor', 'Reviewing…');
      const reviewResult = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, HANDOFF_PROMPTS.executorToMentor(executorResult.output, spec, history), turnCallbacks('mentor'));

      if (reviewResult.sessionId) loop.state = { ...loop.state, mentor: { ...loop.state.mentor, sessionId: reviewResult.sessionId, tokenUsage: reviewResult.tokenUsage } };

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
      onError(msg);
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
  const { onLog, onMessage, onError } = callbacks;

  if (!loop.state.greetingState) loop.state = { ...loop.state, greetingState: initializeGreetingState() };

  try {
    // Turn 1 — mentor greets.
    loop.state = { ...prepareRun(loop.state, 'mentor'), status: 'greeting' };
    update(loop.state);
    if (checkStop()) return loop.state;

    onLog('mentor', 'Saying hello…');
    const mentorHello = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, GREETING_PROMPTS.mentorHello(), turnCallbacks('mentor'));
    if (mentorHello.sessionId) loop.state = { ...loop.state, mentor: { ...loop.state.mentor, sessionId: mentorHello.sessionId, tokenUsage: mentorHello.tokenUsage } };
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

    onLog('executor', 'Greeting back…');
    const executorHello = await runTurn(loop.state.directory, 'executor', loop.state.executor, GREETING_PROMPTS.executorHello(mentorHello.output), turnCallbacks('executor'));
    if (executorHello.sessionId) loop.state = { ...loop.state, executor: { ...loop.state.executor, sessionId: executorHello.sessionId, tokenUsage: executorHello.tokenUsage } };
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

    onLog('mentor', 'Acknowledging…');
    const mentorAck = await runTurn(loop.state.directory, 'mentor', loop.state.mentor, GREETING_PROMPTS.mentorFinish(executorHello.output), turnCallbacks('mentor'));
    if (mentorAck.sessionId) loop.state = { ...loop.state, mentor: { ...loop.state.mentor, sessionId: mentorAck.sessionId, tokenUsage: mentorAck.tokenUsage } };
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
      onError(msg);
      loop.state = setPairStatus(loop.state, 'error', msg);
    }
    update(loop.state);
  }

  return loop.state;
}
