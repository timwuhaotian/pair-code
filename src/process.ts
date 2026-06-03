import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { PairState } from './types.js';
import { buildCommand } from './providers.js';
import { addMessage, hasFinishSignal, setPairStatus, updateActivity, getConversationHistory, getGitChanges, prepareRun, getTaskSpec } from './state.js';

const EMPTY_OUTPUT = '(No textual output produced)';
const TURN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per turn

function truncateStderr(line: string): string {
  const max = 80;
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

export interface TurnResult {
  output: string;
  sessionId?: string;
  tokenUsage?: { inputTokens?: number; outputTokens: number };
}

function parseJsonEvent(line: string): Record<string, any> | undefined {
  try {
    return JSON.parse(line);
  } catch {
    if (line.startsWith('data:')) {
      try { return JSON.parse(line.slice(5).trim()); } catch { /* ignore */ }
    }
    return undefined;
  }
}

function collectTexts(event: Record<string, any>, out: string[]): void {
  for (const key of ['text', 'content', 'message', 'delta', 'part', 'parts', 'output_text', 'response', 'output']) {
    const val = event[key];
    if (typeof val === 'string' && val.trim()) {
      if (out[out.length - 1] !== val.trim()) out.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'object' && item !== null) collectTexts(item, out);
        else if (typeof item === 'string' && item.trim()) out.push(item.trim());
      }
    } else if (typeof val === 'object' && val !== null) {
      collectTexts(val, out);
    }
  }
}

function extractClaudeFinalOutput(event: Record<string, any>): string | undefined {
  if (event.type === 'result' && typeof event.result === 'string') {
    return event.result.trim() || undefined;
  }
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    return event.message.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim() || undefined;
  }
  return undefined;
}

function collapse(candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.every(c => c === candidates[0])) return candidates[0];
  const joined = candidates.join('\n');
  const longest = candidates.reduce((a, b) => a.length >= b.length ? a : b, '');
  if (longest.length * 2 >= joined.length) return longest;
  return joined;
}

let activeChild: ChildProcess | null = null;

export function killActiveChild(): void {
  if (activeChild && !activeChild.killed) {
    try { activeChild.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

export function spawnTurn(
  state: PairState,
  role: 'mentor' | 'executor',
  message: string,
  onLog: (line: string) => void,
  onActivity: (phase: 'thinking' | 'using_tools' | 'responding' | 'idle', label: string) => void,
): Promise<TurnResult> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child && !child.killed) child.kill('SIGTERM');
      const stderrTail = stderrLines.slice(-3).join(' | ');
      const hint = stderrTail
        ? ` (last stderr: ${truncateStderr(stderrTail)})`
        : ' — the CLI produced no output. Check authentication and network.';
      reject(new Error(`${role} turn timed out after ${TURN_TIMEOUT_MS / 1000}s${hint}`));
    }, TURN_TIMEOUT_MS);

    const provider = role === 'mentor' ? state.mentor : state.executor;
    const cmd = buildCommand({
      provider: provider.provider,
      model: provider.model,
      sessionId: provider.sessionId,
      role,
      message,
      reasoningEffort: provider.reasoningEffort,
    });

    onLog(`spawning: ${cmd.executable} ${cmd.args.length} args`);

    // `stdio[0] = 'ignore'` is CRITICAL. OpenCode, Codex, and Gemini all read
    // stdin until EOF when invoked with a prompt argument; leaving stdin as an
    // open pipe makes them block indefinitely (this caused the executor turn
    // to time out after 10 minutes).
    const child = spawn(cmd.executable, cmd.args, {
      cwd: state.directory,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    activeChild = child;

    let accumulated = '';
    const jsonCandidates: string[] = [];
    let firstOutput = true;
    let sessionId: string | undefined;
    let tokenUsage: { inputTokens?: number; outputTokens: number } | undefined;
    let cliErrorMessage: string | undefined;
    const stderrLines: string[] = [];
    const claudeFinalCandidates: string[] = [];
    const isClaude = provider.provider === 'claude';

    const extractErrorMessage = (event: Record<string, any>): string | undefined => {
      const err = event.error;
      if (typeof err === 'string') return err;
      if (err && typeof err === 'object') {
        return err.data?.message ?? err.message ?? err.error?.message ?? JSON.stringify(err);
      }
      if (typeof event.message === 'string' && event.is_error) return event.message;
      return undefined;
    };

    const stdout = createInterface({ input: child.stdout! });
    const stderr = createInterface({ input: child.stderr! });

    stderr.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      stderrLines.push(trimmed);
      if (stderrLines.length > 20) stderrLines.shift();
      onLog(`[stderr] ${trimmed}`);
      // Surface known retry/throttle/auth signals as activity so the user
      // sees why a turn is taking a long time instead of guessing.
      const lower = trimmed.toLowerCase();
      if (/(rate ?limit|exhausted|retry|429|throttl)/.test(lower)) {
        onActivity('thinking', `Throttled: ${truncateStderr(trimmed)}`);
      } else if (/(auth|unauthor|sign in|login|credential|api key)/.test(lower)) {
        onActivity('thinking', `Auth issue: ${truncateStderr(trimmed)}`);
      }
    });

    stdout.on('line', (line: string) => {
      const event = parseJsonEvent(line);
      if (event) {
        const sid = event.sessionID ?? event.session_id ?? event.part?.sessionID ?? event.part?.session_id;
        if (sid) sessionId = sid;

        // Detect error events from any provider's JSON stream so we surface
        // the real message instead of "(No textual output produced)".
        const eventTypeLower = (event.type ?? '').toString().toLowerCase();
        if (eventTypeLower === 'error' || event.error || event.is_error) {
          const msg = extractErrorMessage(event);
          if (msg && !cliErrorMessage) cliErrorMessage = msg;
        }

        const usage = event.usage ?? event.usageMetadata;
        if (usage) {
          const out = usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens ?? usage.candidatesTokenCount ?? usage.output;
          const inp = usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens ?? usage.promptTokenCount ?? usage.input;
          if (typeof out === 'number') {
            tokenUsage = { outputTokens: out, inputTokens: typeof inp === 'number' ? inp : undefined };
          }
        }

        if (isClaude) {
          const final = extractClaudeFinalOutput(event);
          if (final) claudeFinalCandidates.push(final);
        } else {
          collectTexts(event, jsonCandidates);
        }

        const eventType = (event.type ?? '').toLowerCase();
        const toolName = event.name ?? event.tool_name ?? event.tool;
        if (firstOutput) {
          if (eventType.includes('tool') || eventType.includes('function_call')) {
            onActivity('using_tools', `Calling ${toolName ?? 'tool'}`);
          } else if (eventType.includes('content') || eventType.includes('stream') || eventType.includes('message') || eventType.includes('text')) {
            onActivity('responding', 'Streaming response');
          } else {
            onActivity('thinking', 'Analyzing task');
          }
          firstOutput = false;
        } else if (eventType.includes('tool') || eventType.includes('function_call')) {
          onActivity('using_tools', `Calling ${toolName ?? 'tool'}`);
        } else if (eventType.includes('text') || eventType.includes('content')) {
          onActivity('responding', 'Streaming response');
        }

        onLog(`[json:${event.type ?? 'unknown'}]`);
      } else {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('data:')) {
          accumulated += (accumulated ? '\n' : '') + trimmed;
          if (firstOutput) {
            onActivity('responding', 'Streaming response');
            firstOutput = false;
          }
        }
        onLog(trimmed || line);
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      if (timedOut) return;
      onLog(`process exited code=${code} signal=${signal}`);

      if (signal === 'SIGTERM' || signal === 'SIGKILL' || signal === 'SIGINT') {
        reject(new Error(`${role} CLI was terminated (${signal})`));
        return;
      }

      if (cliErrorMessage) {
        reject(new Error(`${provider.provider} (${role}) → ${cliErrorMessage}`));
        return;
      }

      const finalOutput =
        claudeFinalCandidates.length > 0
          ? collapse(claudeFinalCandidates) ?? EMPTY_OUTPUT
          : collapse(jsonCandidates) ?? (accumulated.trim() || EMPTY_OUTPUT);

      if (code !== 0 && code !== null && finalOutput === EMPTY_OUTPUT) {
        const stderrTail = stderrLines.slice(-4).join(' | ');
        const detail = stderrTail ? ` — ${stderrTail}` : '';
        reject(new Error(`${role} CLI (${provider.provider}) exited with code ${code} and no output${detail}`));
        return;
      }

      resolve({
        output: finalOutput,
        sessionId,
        tokenUsage,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      if (timedOut) return;
      reject(err);
    });
  });
}

const HANDOFF_PROMPTS = {
  mentorToExecutor: (plan: string, spec: string) =>
    `You are the EXECUTOR agent in a pair programming session.\n\n## Task\n${spec}\n\n## Mentor's Plan\n${plan}\n\nExecute the plan above. Make all necessary code changes. When done, describe what you changed. Do NOT use the signal TASK_COMPLETE — only the Mentor can finish the session.`,

  executorToMentor: (executorResult: string, spec: string, history: string) =>
    `You are the MENTOR agent in a pair programming session.\n\n## Task\n${spec}\n\n## Full Conversation History\n${history}\n\n## Executor's Latest Work\n${executorResult}\n\nReview the executor's work. Check for:\n1. Completeness — does it fulfill the task spec?\n2. Correctness — are there bugs or logic errors?\n3. Quality — is the code clean and well-structured?\n\nIf the work is satisfactory and complete, respond with TASK_COMPLETE on its own line.\nIf issues remain, explain what needs to be fixed and pass back to the executor.\n\nYou MUST include a structured review in this format:\n\`\`\`json\n{"verdict":"pass|fail","risk":"low|medium|high","confidence":0.0-1.0,"issues":[],"evidence":[],"reasoning":"...","summary":"...","nextStep":{"action":"continue|finish","instructions":[]}}\n\`\`\``,

  initialMentor: (spec: string) =>
    `You are the MENTOR agent in a pair programming session. Your job is to plan and review.\n\n## Task\n${spec}\n\nCreate a detailed plan for the executor to follow. Include:\n1. Analysis of the task\n2. Step-by-step implementation plan\n3. Files to modify/create\n4. Key considerations\n\nBe specific and actionable. The executor will follow your plan exactly. Do NOT use the signal TASK_COMPLETE in this planning turn.`,
};

export interface EngineCallbacks {
  onStateUpdate: (state: PairState) => void;
  onLog: (role: string, line: string) => void;
  onActivity: (role: string, phase: 'thinking' | 'using_tools' | 'responding' | 'idle', label: string) => void;
  onMessage: (state: PairState) => void;
  onError: (error: string) => void;
  shouldStop: () => boolean;
}

export async function runPairEngine(
  initialState: PairState,
  callbacks: EngineCallbacks,
): Promise<PairState> {
  let state = initialState;
  const { onStateUpdate, onLog, onActivity, onMessage, onError, shouldStop } = callbacks;

  const update = (s: PairState) => {
    state = s;
    onStateUpdate(s);
  };

  const checkStop = (): boolean => {
    if (shouldStop()) {
      killActiveChild();
      state = setPairStatus(state, 'paused', 'Stopped by user');
      update(state);
      return true;
    }
    return false;
  };

  // Resume vs. fresh start: if the state already has a mentor session id, treat
  // this run as a resumption and skip the initial planning turn.
  const isResumption = !!state.mentor.sessionId && state.iteration > 0;
  if (!isResumption) state = { ...state, turn: 'mentor' };

  try {
    let latestPlan: string;
    const spec = getTaskSpec(state);

    if (!isResumption) {
      state = prepareRun(state, 'mentor');
      update(state);

      if (checkStop()) return state;

      const mentorPrompt = HANDOFF_PROMPTS.initialMentor(spec);
      onLog('mentor', 'Starting planning turn...');

      const mentorResult = await spawnTurn(
        state, 'mentor', mentorPrompt,
        (line) => onLog('mentor', line),
        (phase, label) => onActivity('mentor', phase, label),
      );

      if (mentorResult.sessionId) {
        state = { ...state, mentor: { ...state.mentor, sessionId: mentorResult.sessionId } };
      }

      state = addMessage(state, { from: 'mentor', to: 'executor', type: 'plan', content: mentorResult.output });
      state = updateActivity(state, 'mentor', 'idle', 'Planning complete');
      update(state);
      onMessage(state);

      latestPlan = mentorResult.output;
    } else {
      // Find the latest mentor message to use as the plan.
      const lastMentorMsg = [...state.messages].reverse().find(m => m.from === 'mentor');
      latestPlan = lastMentorMsg?.content ?? `Continue the task: ${spec}`;
      onLog('mentor', 'Resuming session...');
    }

    while (state.status !== 'finished' && state.status !== 'error' && state.status !== 'paused') {
      if (checkStop()) break;

      state = prepareRun(state, 'executor');
      update(state);

      const history = getConversationHistory(state);
      const executorPrompt = HANDOFF_PROMPTS.mentorToExecutor(latestPlan, spec);
      onLog('executor', 'Starting execution turn...');

      const executorResult = await spawnTurn(
        state, 'executor', executorPrompt,
        (line) => onLog('executor', line),
        (phase, label) => onActivity('executor', phase, label),
      );

      if (executorResult.sessionId) {
        state = { ...state, executor: { ...state.executor, sessionId: executorResult.sessionId } };
      }

      state = addMessage(state, { from: 'executor', to: 'mentor', type: 'result', content: executorResult.output });
      state = updateActivity(state, 'executor', 'idle', 'Execution complete');
      update(state);
      onMessage(state);

      const changes = await getGitChanges(state.directory);
      if (changes.length > 0) {
        state = { ...state, modifiedFiles: changes };
        update(state);
      }

      if (state.iteration >= state.maxIterations) {
        state = setPairStatus(state, 'paused', `Max iterations reached (${state.maxIterations})`);
        update(state);
        break;
      }

      if (checkStop()) break;

      state = prepareRun(state, 'mentor');
      update(state);

      const reviewPrompt = HANDOFF_PROMPTS.executorToMentor(executorResult.output, spec, history);
      onLog('mentor', 'Starting review turn...');

      const reviewResult = await spawnTurn(
        state, 'mentor', reviewPrompt,
        (line) => onLog('mentor', line),
        (phase, label) => onActivity('mentor', phase, label),
      );

      if (reviewResult.sessionId) {
        state = { ...state, mentor: { ...state.mentor, sessionId: reviewResult.sessionId } };
      }

      const mentorWantsFinish = hasFinishSignal(reviewResult.output);

      state = addMessage(state, { from: 'mentor', to: 'executor', type: 'acceptance', content: reviewResult.output });
      state = updateActivity(state, 'mentor', 'idle', 'Review complete');
      update(state);
      onMessage(state);

      if (mentorWantsFinish) {
        state = setPairStatus(state, 'finished', 'Mentor signaled task complete');
        update(state);
        break;
      }

      latestPlan = reviewResult.output;

      if (state.status !== 'finished' && state.status !== 'paused' && state.status !== 'error') {
        state = addMessage(state, { from: 'mentor', to: 'executor', type: 'handoff', content: 'Passing back to executor with feedback' });
        update(state);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Differentiate a user-initiated stop (second Ctrl+C kills the child mid-turn,
    // which causes spawnTurn to reject) from a real failure. shouldStop() is the
    // single source of truth — if the user asked to stop, treat it as pause.
    if (shouldStop()) {
      state = setPairStatus(state, 'paused', 'Stopped by user during turn');
    } else {
      onError(msg);
      state = setPairStatus(state, 'error', msg);
    }
    update(state);
  }

  return state;
}
