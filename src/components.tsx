import { Component, memo, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { PairState, Message, ToolEvent, AgentRuntime, ActivityPhase } from './types.js';
import { colors, icons, heroGradient, rgbHex, spinnerFrames, formatDuration, formatIterations, formatTokens, truncate } from './ui.js';
import { parseVerdict, stripVerdictBlocks } from './verdict.js';
import type { Verdict } from './verdict.js';

// ── Spinner ─────────────────────────────────────────────────────────────

// Shared spinner animation: a single module-level 80ms interval drives every
// mounted Spinner via a ref-counted subscription, so concurrent spinners
// (live turn header + running tool lines) don't each spawn their own timer.
const spinnerSubs = new Set<(f: number) => void>();
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function subscribeSpinner(cb: (f: number) => void): () => void {
  spinnerSubs.add(cb);
  if (spinnerTimer === null) {
    let frame = 0;
    spinnerTimer = setInterval(() => {
      frame = (frame + 1) % spinnerFrames.length;
      for (const sub of spinnerSubs) sub(frame);
    }, 80);
  }
  return () => {
    spinnerSubs.delete(cb);
    if (spinnerSubs.size === 0 && spinnerTimer !== null) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };
}

/** Current spinner frame, updated by the shared interval. */
function useSpinnerFrame(): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => subscribeSpinner(setFrame), []);
  return frame;
}

export function Spinner({ color }: { color?: string }): JSX.Element {
  const frame = useSpinnerFrame();
  return <Text color={color ?? colors.accent}>{spinnerFrames[frame]}</Text>;
}

/**
 * Milliseconds elapsed since the timer was (re)started. Resets whenever
 * `resetKey` changes — the live turn keys it on the active role, so the clock
 * measures the current turn rather than the whole session.
 */
function useElapsed(resetKey: string): number {
  const [ms, setMs] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    startRef.current = Date.now();
    setMs(0);
    const t = setInterval(() => setMs(Date.now() - startRef.current), 500);
    return () => clearInterval(t);
  }, [resetKey]);
  return ms;
}

// ── Banner ──────────────────────────────────────────────────────────────

const LOGO_FULL = [
  '██████╗  █████╗ ██╗██████╗      ██████╗ ██████╗ ██████╗ ███████╗',
  '██╔══██╗██╔══██╗██║██╔══██╗    ██╔════╝██╔═══██╗██╔══██╗██╔════╝',
  '██████╔╝███████║██║██████╔╝    ██║     ██║   ██║██║  ██║█████╗  ',
  '██╔═══╝ ██╔══██║██║██╔══██╗    ██║     ██║   ██║██║  ██║██╔══╝  ',
  '██║     ██║  ██║██║██║  ██║    ╚██████╗╚██████╔╝██████╔╝███████╗',
  '╚═╝     ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝',
];
const LOGO_COMPACT = [
  '┌─┐┌─┐┬┬─┐  ┌─┐┌─┐┌┬┐┌─┐',
  '├─┘├─┤│├┬┘  │  │ │ ││├┤ ',
  '┴  ┴ ┴┴┴└─  └─┘└─┘─┴┘└─┘',
];

export function Banner(): JSX.Element {
  const { stdout } = useStdout();
  const wide = (stdout?.columns ?? 80) >= 70;
  const logo = wide ? LOGO_FULL : LOGO_COMPACT;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {logo.map((row, i) => {
        const c = heroGradient[Math.floor((i / logo.length) * heroGradient.length)] ?? heroGradient[0];
        return <Text key={i} color={rgbHex(c)}>  {row}</Text>;
      })}
      <Text>
        {'  '}<Text color={rgbHex(heroGradient[4])}>{icons.sparkle}</Text>
        {'  '}<Text bold>Dual-agent AI pair programming</Text>
        <Text dimColor> · for the terminal</Text>
      </Text>
      <Text>
        {'     '}<Text dimColor>— </Text>
        <Text color={colors.mentor} bold>Mentor</Text><Text dimColor> plans </Text>
        <Text dimColor>{icons.arrow} </Text>
        <Text color={colors.executor} bold>Executor</Text><Text dimColor> codes </Text>
        <Text dimColor>{icons.arrow} </Text>
        <Text color={colors.mentor} bold>Mentor</Text><Text dimColor> reviews</Text>
      </Text>
    </Box>
  );
}

// ── Status bar ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  finished: colors.success, error: colors.error, paused: colors.warn,
  mentoring: colors.mentor, executing: colors.executor, reviewing: colors.info,
  greeting: colors.accent,
};

function statusGlyph(status: string): string {
  if (status === 'finished') return icons.check;
  if (status === 'error') return icons.cross;
  if (status === 'paused') return icons.pause;
  return icons.dot;
}

/** Format an accumulated USD cost compactly, e.g. 0.0123 → "$0.0123". */
function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export const StatusBar = memo(function StatusBar({ state, elapsedMs }: { state: PairState; elapsedMs: number }): JSX.Element {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const color = STATUS_COLOR[state.status] ?? colors.accent;
  const tok = (state.mentor.tokenUsage?.outputTokens ?? 0) + (state.executor.tokenUsage?.outputTokens ?? 0);
  const cost = state.totalCostUsd ?? 0;
  // On narrow terminals hide the right-side model summary; below 100 cols
  // shorten model truncation so the bar fits within 80 columns.
  const hideModels = cols < 80;
  const modelMax = cols < 100 ? 12 : 22;
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text color={color}>{statusGlyph(state.status)} </Text>
        <Text color={color} bold>{state.status.replace(/_/g, ' ').toUpperCase()}</Text>
        <Text dimColor>  iter {formatIterations(state.iteration, state.maxIterations)}  {formatDuration(elapsedMs)}</Text>
        {tok > 0 ? <Text dimColor>  {formatTokens(tok)} tok</Text> : null}
        {cost > 0 ? <Text dimColor>  {formatUsd(cost)}</Text> : null}
      </Text>
      {hideModels ? null : (
        <Text>
          <Text color={colors.mentor}>{icons.mentor} </Text>
          <Text dimColor>{truncate(state.mentor.model, modelMax)}</Text>
          <Text dimColor>   </Text>
          <Text color={colors.executor}>{icons.executor} </Text>
          <Text dimColor>{truncate(state.executor.model, modelMax)}</Text>
        </Text>
      )}
    </Box>
  );
});

const PHASE_LABEL: Record<ActivityPhase, string> = {
  idle: 'idle', thinking: 'thinking', using_tools: 'using tools', responding: 'writing',
  waiting: 'waiting', error: 'error',
};

function AgentCell({ runtime, role, active }: { runtime: AgentRuntime; role: 'mentor' | 'executor'; active: boolean }): JSX.Element {
  const color = role === 'mentor' ? colors.mentor : colors.executor;
  const icon = role === 'mentor' ? icons.mentor : icons.executor;
  const phase = runtime.activity.phase;
  const spinning = active && (phase === 'thinking' || phase === 'responding' || phase === 'using_tools');
  return (
    <Box>
      <Text color={color}>{active ? icons.chevron : ' '} {icon} </Text>
      <Text color={color} bold>{role === 'mentor' ? 'MENTOR' : 'EXECUTOR'}</Text>
      <Text> </Text>
      {spinning ? <><Spinner color={color} /><Text> </Text></> : null}
      <Text dimColor>{runtime.activity.label || PHASE_LABEL[phase]}</Text>
    </Box>
  );
}

export function AgentBar({ state }: { state: PairState }): JSX.Element {
  const live = state.status !== 'paused' && state.status !== 'finished' && state.status !== 'error';
  return (
    <Box justifyContent="space-between">
      <AgentCell runtime={state.mentor} role="mentor" active={live && state.turn === 'mentor'} />
      <AgentCell runtime={state.executor} role="executor" active={live && state.turn === 'executor'} />
    </Box>
  );
}

// ── Tool line ───────────────────────────────────────────────────────────

const TOOL_VERB: Record<string, string> = {
  Read: 'Read', Grep: 'Search', Glob: 'Find', Edit: 'Edit', MultiEdit: 'Edit',
  Write: 'Write', Bash: 'Run', NotebookEdit: 'Edit', WebFetch: 'Fetch', WebSearch: 'Search', TodoWrite: 'Plan',
};

export function ToolLine({ ev }: { ev: ToolEvent }): JSX.Element {
  const { stdout } = useStdout();
  const verb = TOOL_VERB[ev.name] ?? ev.name;
  const running = ev.status === 'running';
  const color = ev.status === 'error' ? colors.error : ev.status === 'done' ? colors.success : colors.warn;
  const targetMax = Math.min(56, Math.floor((stdout?.columns ?? 80) * 0.5));
  return (
    <Text>
      {running
        ? <><Spinner color={color} /><Text> </Text></>
        : <Text color={color}>{ev.status === 'error' ? icons.cross : icons.check} </Text>}
      <Text dimColor={!running} color={running ? color : undefined}>{verb}</Text>
      {ev.target ? <Text dimColor> {truncate(ev.target, targetMax)}</Text> : null}
    </Text>
  );
}

// ── Messages ────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  plan: 'PLAN', result: 'RESULT', acceptance: 'REVIEW', handoff: 'HANDOFF', feedback: 'TASK', greeting: 'HELLO',
};

function senderColor(from: string): string {
  return from === 'mentor' ? colors.mentor : from === 'executor' ? colors.executor : colors.human;
}
function senderIcon(from: string): string {
  return from === 'mentor' ? icons.mentor : from === 'executor' ? icons.executor : icons.human;
}

function VerdictChip({ v }: { v: Verdict }): JSX.Element {
  const pass = (v.verdict ?? '').toLowerCase() === 'pass';
  const chipColor = pass ? colors.success : colors.error;
  const risk = (v.risk ?? '').toLowerCase();
  const riskColor = risk === 'high' ? colors.error : risk === 'medium' ? colors.warn : colors.success;
  // Confidence may arrive as 0..1 or as an already-scaled 0..100 percentage.
  const confPct = typeof v.confidence === 'number'
    ? Math.round(Math.max(0, Math.min(100, v.confidence > 1 ? v.confidence : v.confidence * 100)))
    : null;
  return (
    <Text>
      <Text backgroundColor={chipColor} color="black" bold> {pass ? icons.check : icons.cross} {(v.verdict ?? '?').toUpperCase()} </Text>
      {v.risk ? <Text> <Text dimColor>risk</Text> <Text color={riskColor}>{v.risk}</Text></Text> : null}
      {confPct !== null ? <Text dimColor> · {confPct}% conf</Text> : null}
    </Text>
  );
}

export function MessageView({ msg, maxLines = 120 }: { msg: Message; maxLines?: number }): JSX.Element {
  const color = senderColor(msg.from);
  const { verdict, bodyText } = useMemo(() => {
    const v = msg.type === 'acceptance' ? parseVerdict(msg.content) : null;
    const body = (v ? stripVerdictBlocks(msg.content) : msg.content) || (v?.summary ?? '');
    return { verdict: v, bodyText: body };
  }, [msg.content, msg.type]);
  const lines = bodyText.split('\n');
  const shown = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const clipped = lines.length - shown.length;
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={color}>{senderIcon(msg.from)} </Text>
        <Text color={color} bold>{msg.from.toUpperCase()}</Text>
        <Text> </Text>
        <Text backgroundColor={color} color="black" bold> {TYPE_LABEL[msg.type] ?? msg.type.toUpperCase()} </Text>
        <Text dimColor>  iter {msg.iteration}</Text>
      </Text>
      <Box flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={color} borderTop={false} borderRight={false} borderBottom={false}>
        {verdict ? <VerdictChip v={verdict} /> : null}
        {shown.map((l, i) => <Text key={i}>{l || ' '}</Text>)}
        {clipped > 0 ? <Text dimColor>{icons.ellipsis} {clipped} more lines</Text> : null}
      </Box>
    </Box>
  );
}

export function ConnectorLine({ label }: { label: string }): JSX.Element {
  return (
    <Box marginBottom={1}>
      <Text dimColor>   {icons.corner}{icons.arrowDown} {label}</Text>
    </Box>
  );
}

// ── Live streaming turn ─────────────────────────────────────────────────

export function LiveTurn({ role, subtitle, text, tools }: { role: 'mentor' | 'executor'; subtitle: string; text: string; tools: ToolEvent[] }): JSX.Element {
  const color = role === 'mentor' ? colors.mentor : colors.executor;
  // Reset the clock each time the turn changes hands (role flips per turn).
  const elapsed = useElapsed(role);
  const tail = useMemo(() => text.split('\n').slice(-14), [text]);
  const recentTools = tools.slice(-6);
  const runningCount = tools.filter(t => t.status === 'running').length;
  return (
    <Box flexDirection="column">
      <Text>
        <Spinner color={color} />
        <Text color={color}> {senderIcon(role)} </Text>
        <Text color={color} bold>{role.toUpperCase()}</Text>
        <Text dimColor>  {subtitle}{icons.ellipsis}</Text>
        <Text dimColor>  {formatDuration(elapsed)}</Text>
        {tools.length > 0 ? <Text dimColor>  {icons.gear} {tools.length} {tools.length === 1 ? 'call' : 'calls'}{runningCount ? '…' : ''}</Text> : null}
      </Text>
      <Box flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={color} borderTop={false} borderRight={false} borderBottom={false}>
        {recentTools.map(t => <ToolLine key={t.id} ev={t} />)}
        {text
          ? tail.map((l, i) => (
              <Text key={i}>
                {l || ' '}
                {i === tail.length - 1 ? <Text color={color}>{icons.caret}</Text> : null}
              </Text>
            ))
          : (recentTools.length === 0 ? <Text dimColor><Spinner color={colors.dim} /> thinking{icons.ellipsis}</Text> : null)}
      </Box>
    </Box>
  );
}

/** Map engine status → a human subtitle for the live turn header. */
export function liveSubtitle(status: string): string {
  switch (status) {
    case 'mentoring': return 'planning';
    case 'reviewing': return 'reviewing';
    case 'executing': return 'implementing';
    case 'greeting': return 'saying hello';
    default: return 'working';
  }
}

// ── Result panels ───────────────────────────────────────────────────────

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Why change tracking is disabled, or null when git is healthy. */
function gitDisabledReason(gitStatus: PairState['gitStatus']): string | null {
  if (gitStatus === 'no-repo') return 'change tracking disabled: not a git repo';
  if (gitStatus === 'no-git') return 'change tracking disabled: git not found';
  return null;
}

/** Truncate a long, potentially multi-line error message for display. */
function truncateError(msg: string, maxLines = 5, maxChars = 500): string {
  const lines = msg.split('\n');
  let out = lines.length > maxLines ? lines.slice(0, maxLines).join('\n') : msg;
  const clipped = out.length > maxChars;
  if (clipped) out = out.slice(0, maxChars);
  return (lines.length > maxLines || clipped) ? `${out}${icons.ellipsis}` : out;
}

export const ResultPanel = memo(function ResultPanel({ state }: { state: PairState }): JSX.Element {
  if (state.status === 'finished') {
    const dur = state.finishedAt && state.createdAt ? formatDuration(state.finishedAt - state.createdAt) : '—';
    const totalTokens = (state.mentor.tokenUsage?.outputTokens ?? 0) + (state.executor.tokenUsage?.outputTokens ?? 0);
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={colors.success} paddingX={1}>
        <Text color={colors.success} bold>{icons.check} Task Complete</Text>
        <Text dimColor>Duration {dur} · {plural(state.iteration, 'iteration')} · {plural(state.messages.length, 'message')}{totalTokens > 0 ? ` · ${formatTokens(totalTokens)} out-tokens` : ''}</Text>
        {state.modifiedFiles.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>{plural(state.modifiedFiles.length, 'file')} changed</Text>
            {state.modifiedFiles.slice(0, 10).map(f => (
              <Text key={f.path}><Text color={colors.success}>{f.status}</Text>  {f.path}</Text>
            ))}
          </Box>
        ) : gitDisabledReason(state.gitStatus) ? (
          <Text dimColor>{gitDisabledReason(state.gitStatus)}</Text>
        ) : null}
        <Text dimColor>Type a new task, or /quit to exit.</Text>
      </Box>
    );
  }
  if (state.status === 'paused') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={colors.warn} paddingX={1}>
        <Text color={colors.warn} bold>{icons.pause} Paused</Text>
        <Text dimColor>iter {formatIterations(state.iteration, state.maxIterations)} · /resume to continue, or a new task.</Text>
      </Box>
    );
  }
  if (state.status === 'error') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={colors.error} paddingX={1}>
        <Text color={colors.error} bold>{icons.cross} Session Failed</Text>
        {state.lastError ? <Text>{truncateError(state.lastError)}</Text> : null}
        <Text dimColor>Check /model, fix the cause, then retry with a new task.</Text>
      </Box>
    );
  }
  return <Text> </Text>;
});

// ── Error boundary ──────────────────────────────────────────────────────
// Catches render-time errors inside the Ink tree so a broken component shows
// a readable message instead of an opaque raw-mode / React stack crash.

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(): void {
    // Give Ink a tick to paint the fallback UI, then exit non-zero.
    setTimeout(() => process.exit(1), 100);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Box flexDirection="column">
          <Text color="red">Something went wrong: {this.state.error.message}</Text>
          <Text dimColor>Please restart the app.</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
