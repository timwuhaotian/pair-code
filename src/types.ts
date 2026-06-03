export type AgentRole = 'mentor' | 'executor';
export type MessageSender = 'mentor' | 'executor' | 'human';
export type MessageType = 'plan' | 'feedback' | 'progress' | 'result' | 'question' | 'acceptance' | 'handoff' | 'greeting';
export type PairStatus = 'idle' | 'mentoring' | 'executing' | 'reviewing' | 'paused' | 'awaiting_human_review' | 'error' | 'finished' | 'greeting';
export type ActivityPhase = 'idle' | 'thinking' | 'using_tools' | 'responding' | 'waiting' | 'error' | 'stalled';
export type ProviderKind = 'claude' | 'opencode' | 'codex' | 'gemini';

export interface AgentConfig {
  role: AgentRole;
  provider: ProviderKind;
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
  provider?: string;
}

export interface PairState {
  pairId: string;
  directory: string;
  status: PairStatus;
  iteration: number;
  maxIterations: number;
  turn: AgentRole;
  mentor: {
    provider: ProviderKind;
    model: string;
    reasoningEffort?: string;
    sessionId?: string;
    activity: AgentActivity;
    tokenUsage?: TokenUsage;
  };
  executor: {
    provider: ProviderKind;
    model: string;
    reasoningEffort?: string;
    sessionId?: string;
    activity: AgentActivity;
    tokenUsage?: TokenUsage;
  };
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
  status: 'A' | 'M' | 'D' | 'R' | '??';
}

export interface CreatePairInput {
  directory: string;
  spec: string;
  mentor: AgentConfig;
  executor: AgentConfig;
  maxIterations?: number;
}

export interface ProviderCommand {
  executable: string;
  args: string[];
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
