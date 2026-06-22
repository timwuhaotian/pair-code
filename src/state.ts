import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import type { PairState, AgentActivity, CreatePairInput, Message, AgentRole, PairStatus, ModifiedFile, GreetingState, GreetingMessage } from './types.js';

const MENTOR_FINISH_SIGNAL = 'TASK_COMPLETE';
// Same regex must be applied to BOTH the candidate line and the sentinel so
// the comparison isn't asymmetric — otherwise the underscore in TASK_COMPLETE
// gets stripped from the input but kept in the constant and the signal never
// fires.
const NORMALIZE_RE = /[`"'>_*\-:.,!?\[\](){}]/g;
const FINISH_NORMALIZED = MENTOR_FINISH_SIGNAL.replace(NORMALIZE_RE, '');

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_CHARS = 4000;

function nowMs(): number {
  return Date.now();
}

function idleActivity(label: string): AgentActivity {
  const now = nowMs();
  return { phase: 'idle', label, startedAt: now, updatedAt: now };
}

export function createPairState(input: CreatePairInput): PairState {
  const pairId = randomUUID();
  return {
    pairId,
    directory: input.directory,
    status: 'idle',
    iteration: 0,
    // Unlimited by default — the loop runs until the mentor emits TASK_COMPLETE
    // or the user stops it (Esc). A finite cap can still be passed explicitly.
    maxIterations: input.maxIterations ?? Infinity,
    turn: 'mentor',
    mentor: {
      profileName: input.mentor.profileName,
      baseUrl: input.mentor.baseUrl,
      model: input.mentor.model,
      activity: idleActivity('idle'),
    },
    executor: {
      profileName: input.executor.profileName,
      baseUrl: input.executor.baseUrl,
      model: input.executor.model,
      activity: idleActivity('idle'),
    },
    messages: [],
    modifiedFiles: [],
    createdAt: nowMs(),
  };
}

export function addMessage(state: PairState, msg: Omit<Message, 'id' | 'timestamp' | 'iteration'>): PairState {
  const message: Message = {
    ...msg,
    id: randomUUID(),
    timestamp: nowMs(),
    iteration: state.iteration,
  };

  const messages = [...state.messages, message];

  let turn = state.turn;
  // Handoff is a marker for the UI — the iteration counter is bumped by
  // prepareRun() at the start of each mentor turn, not here. Bumping in both
  // places previously caused iter to advance by 2 per round-trip.
  if (msg.type === 'handoff') {
    turn = turn === 'mentor' ? 'executor' : 'mentor';
  }

  return { ...state, messages, turn };
}

export function prepareRun(state: PairState, role: AgentRole): PairState {
  const s = { ...state };
  const isPlanningTurn = s.iteration === 0 || s.status === 'idle' || s.status === 'finished' || s.status === 'error';

  if (role === 'mentor') {
    if (isPlanningTurn) {
      s.iteration = 1;
      s.status = 'mentoring';
      s.mentor = { ...s.mentor, activity: { phase: 'thinking', label: 'analyzing task', detail: 'Preparing first instruction', startedAt: nowMs(), updatedAt: nowMs() } };
      s.executor = { ...s.executor, activity: { phase: 'waiting', label: 'standing by', startedAt: nowMs(), updatedAt: nowMs() } };
    } else {
      s.iteration = s.iteration + 1;
      s.status = 'reviewing';
      s.mentor = { ...s.mentor, activity: { phase: 'thinking', label: 'reviewing changes', detail: 'Checking the work', startedAt: nowMs(), updatedAt: nowMs() } };
      s.executor = { ...s.executor, activity: { phase: 'waiting', label: 'awaiting review', detail: 'Paused for review', startedAt: nowMs(), updatedAt: nowMs() } };
    }
  } else {
    s.status = 'executing';
    s.mentor = { ...s.mentor, activity: { phase: 'waiting', label: 'observing', startedAt: nowMs(), updatedAt: nowMs() } };
    s.executor = { ...s.executor, activity: { phase: 'thinking', label: 'executing plan', detail: 'Processing instructions', startedAt: nowMs(), updatedAt: nowMs() } };
  }

  s.turn = role;
  return s;
}

export function setPairStatus(state: PairState, status: PairStatus, detail?: string): PairState {
  const s = { ...state, status };
  if (status === 'finished') {
    s.finishedAt = nowMs();
    s.mentor = { ...s.mentor, activity: idleActivity('Mission finished') };
    s.executor = { ...s.executor, activity: idleActivity('idle') };
  } else if (status === 'paused') {
    s.mentor = { ...s.mentor, activity: idleActivity('Paused') };
    s.executor = { ...s.executor, activity: idleActivity('Paused') };
  } else if (status === 'error') {
    s.lastError = detail ?? s.lastError ?? 'Unknown error';
    s.mentor = { ...s.mentor, activity: { phase: 'error', label: 'Error', detail, startedAt: nowMs(), updatedAt: nowMs() } };
    s.executor = { ...s.executor, activity: { phase: 'error', label: 'Error', detail, startedAt: nowMs(), updatedAt: nowMs() } };
  }
  return s;
}

export function updateActivity(state: PairState, role: AgentRole, phase: AgentActivity['phase'], label: string, detail?: string): PairState {
  const activity: AgentActivity = { phase, label, detail, startedAt: nowMs(), updatedAt: nowMs() };
  if (role === 'mentor') {
    return { ...state, mentor: { ...state.mentor, activity } };
  }
  return { ...state, executor: { ...state.executor, activity } };
}

export function hasFinishSignal(content: string): boolean {
  return content.split('\n').some(line => {
    const normalized = line.trim().replace(NORMALIZE_RE, '').toUpperCase();
    return normalized === FINISH_NORMALIZED;
  });
}

export function getTaskSpec(state: PairState): string {
  const humanMsg = state.messages.find(m => m.from === 'human' && m.to === 'mentor');
  return humanMsg?.content ?? '';
}

export function getConversationHistory(state: PairState): string {
  const relevant = state.messages.filter(
    m => m.type === 'plan' || m.type === 'result' || m.type === 'acceptance',
  );
  // Cap window so the review prompt doesn't grow unbounded over long sessions.
  const recent = relevant.slice(-MAX_HISTORY_MESSAGES);
  return recent
    .map(m => {
      const body = m.content.length > MAX_HISTORY_MESSAGE_CHARS
        ? m.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)
          + `\n…[truncated ${m.content.length - MAX_HISTORY_MESSAGE_CHARS} chars]`
        : m.content;
      return `[${m.from.toUpperCase()}] (iter ${m.iteration}): ${body}`;
    })
    .join('\n\n');
}

export async function getGitChanges(directory: string): Promise<ModifiedFile[]> {
  try {
    const tracked = execSync('git diff --name-status HEAD', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    const files: ModifiedFile[] = tracked.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('\t');
      // git diff --name-status emits e.g. "R100\told\tnew" for renames and
      // "C75\tsrc\tdst" for copies. The status letter is the first char; the
      // destination path is the last segment for renames/copies, otherwise [1].
      const status = parts[0].charAt(0) as ModifiedFile['status'];
      const path = parts.length > 2 ? parts[parts.length - 1] : parts[1];
      return { path, status };
    });

    for (const path of untracked.trim().split('\n').filter(Boolean)) {
      files.push({ path, status: '??' });
    }

    return files;
  } catch {
    return [];
  }
}

export function initializeGreetingState(): GreetingState {
  return {
    currentRound: 0,
    maxRounds: 2,
    isComplete: false,
    history: [],
  };
}

export function addGreetingMessage(state: PairState, from: 'mentor' | 'executor', content: string): PairState {
  const greetingState = state.greetingState;
  if (!greetingState) return state;

  const newRound = greetingState.currentRound + 1;
  const greetingMsg: GreetingMessage = {
    round: newRound,
    from,
    content,
    timestamp: nowMs(),
  };

  const updatedHistory = [...greetingState.history, greetingMsg];
  const isComplete = newRound >= greetingState.maxRounds;

  return {
    ...state,
    greetingState: {
      ...greetingState,
      currentRound: newRound,
      history: updatedHistory,
      isComplete,
    },
  };
}

export function isGreetingComplete(state: PairState): boolean {
  return state.greetingState?.isComplete ?? false;
}
