export type AgentRole = 'mentor' | 'executor';
export type MessageSender = 'mentor' | 'executor' | 'human';
export type MessageType = 'plan' | 'feedback' | 'progress' | 'result' | 'question' | 'acceptance' | 'handoff' | 'greeting';
export type PairStatus = 'idle' | 'mentoring' | 'executing' | 'reviewing' | 'paused' | 'awaiting_human_review' | 'error' | 'finished' | 'greeting';
export type ActivityPhase = 'idle' | 'thinking' | 'using_tools' | 'responding' | 'waiting' | 'error' | 'stalled';

/**
 * An Anthropic-compatible endpoint a role binds to. It carries the base URL +
 * API key; the key is resolved on demand from one of three sources — env, the
 * in-memory session store, or the opt-in saved config (see config.ts) — so a
 * key only ever reaches disk when the user explicitly chose to remember it.
 * `name === 'anthropic'` with an empty `baseUrl` means the official Anthropic API.
 */
export interface Profile {
  /** Stable identifier, e.g. "glm", "deepseek", "anthropic". */
  name: string;
  /** Human label for display. */
  label: string;
  /** ANTHROPIC_BASE_URL for this endpoint; empty → official Anthropic API. */
  baseUrl: string;
  /** Optional default model id suggested for this endpoint. */
  defaultModel?: string;
}

/** A profile paired with the secret resolved from the environment. */
export interface ResolvedProfile extends Profile {
  apiKey: string;
}

export interface AgentConfig {
  role: AgentRole;
  /** Which env-declared profile this role binds to. */
  profileName: string;
  /** Display copy of the endpoint URL (no secret). */
  baseUrl: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface Message {
  id: string;
  timestamp: number;
  from: MessageSender;
  to: string;
  type: MessageType;
  content: string;
  iteration: number;
}

export interface AgentActivity {
  phase: ActivityPhase;
  label: string;
  detail?: string;
  startedAt: number;
  updatedAt: number;
}

export interface TokenUsage {
  outputTokens: number;
  inputTokens?: number;
  costUsd?: number;
}

/** A tool invocation surfaced from the agent stream, for the live timeline. */
export interface ToolEvent {
  id: string;
  name: string;
  /** Best-effort target (file path / command), parsed from tool input. */
  target?: string;
  status: 'running' | 'done' | 'error';
}

export interface AgentRuntime {
  /** Env profile name the role is bound to. */
  profileName: string;
  /** Endpoint URL copy for display (no secret). */
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  sessionId?: string;
  activity: AgentActivity;
  tokenUsage?: TokenUsage;
}

export interface PairState {
  pairId: string;
  directory: string;
  status: PairStatus;
  iteration: number;
  maxIterations: number;
  turn: AgentRole;
  mentor: AgentRuntime;
  executor: AgentRuntime;
  messages: Message[];
  modifiedFiles: ModifiedFile[];
  finishedAt?: number;
  createdAt: number;
  /** Last error message captured when status transitioned to 'error'. */
  lastError?: string;
  /** Greeting state for the hello session mode. */
  greetingState?: GreetingState;
}

export interface ModifiedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | '??';
}

export interface CreatePairInput {
  directory: string;
  spec: string;
  mentor: AgentConfig;
  executor: AgentConfig;
  maxIterations?: number;
}

export interface GreetingState {
  currentRound: number;
  maxRounds: number;
  isComplete: boolean;
  history: GreetingMessage[];
}

export interface GreetingMessage {
  round: number;
  from: 'mentor' | 'executor';
  content: string;
  timestamp: number;
}
