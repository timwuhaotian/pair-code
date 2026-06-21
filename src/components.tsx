import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import type { PairState, Message, ToolEvent, AgentRuntime, ActivityPhase } from './types.js';
import { colors, icons, heroGradient, rgbHex, spinnerFrames, formatDuration, formatTokens, truncate } from './ui.js';

// ── Spinner ─────────────────────────────────────────────────────────────

export function Spinner({ color }: { color?: string }): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % spinnerFrames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color={color ?? colors.accent}>{spinnerFrames[frame]}</Text>;
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
  const wide = (process.stdout.columns ?? 80) >= 70;
  const logo = wide ? LOGO_FULL : LOGO_COMPACT;
  return (
    <Box flexDirection="column" marginBottom={1}>
      {logo.map((row, i) => {
        const c = heroGradient[Math.floor((i / logo.length) * heroGradient.length)] ?? heroGradient[0];
        return <Text key={i} color={rgbHex(c)}>  {row}</Text>;
      })}
      <Text>
        {'  '}<Text color={rgbHex([217, 70, 239])}>{icons.sparkle}</Text>
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
};

function statusGlyph(status: string): string {
  if (status === 'finished') return icons.check;
  if (status === 'error') return icons.cross;
  if (status === 'paused') return icons.pause;
  return icons.dot;
}

export function StatusBar({ state, elapsedMs }: { state: PairState; elapsedMs: number }): JSX.Element {
  const color = STATUS_COLOR[state.status] ?? colors.accent;
  const tok = (state.mentor.tokenUsage?.outputTokens ?? 0) + (state.executor.tokenUsage?.outputTokens ?? 0);
  return (
    <Box justifyContent="space-between">
      <Text>
        <Text color={color}>{statusGlyph(state.status)} </Text>
        <Text color={color} bold>{state.status.replace(/_/g, ' ').toUpperCase()}</Text>
        <Text dimColor>  iter {state.iteration}/{state.maxIterations}  {formatDuration(elapsedMs)}</Text>
        {tok > 0 ? <Text dimColor>  {formatTokens(tok)} tok</Text> : null}
      </Text>
      <Text>
        <Text color={colors.mentor}>{icons.mentor} </Text>
        <Text dimColor>{truncate(state.mentor.model, 22)}</Text>
        <Text dimColor>   </Text>
        <Text color={colors.executor}>{icons.executor} </Text>
        <Text dimColor>{truncate(state.executor.model, 22)}</Text>
      </Text>
    </Box>
  );
}

const PHASE_LABEL: Record<ActivityPhase, string> = {
  idle: 'idle', thinking: 'thinking', using_tools: 'using tools', responding: 'writing',
  waiting: 'waiting', error: 'error', stalled: 'stalled',
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
  const verb = TOOL_VERB[ev.name] ?? ev.name;
  const glyph = ev.status === 'running' ? icons.chevron : ev.status === 'error' ? icons.cross : icons.check;
  const color = ev.status === 'error' ? colors.error : ev.status === 'done' ? colors.success : colors.warn;
  return (
    <Text>
      <Text color={color}>{glyph} </Text>
      <Text dimColor>{verb}</Text>
      {ev.target ? <Text> {truncate(ev.target, 56)}</Text> : null}
    </Text>
  );
}

// ── Messages ────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  plan: 'PLAN', result: 'RESULT', acceptance: 'REVIEW', handoff: 'HANDOFF', feedback: 'TASK', greeting: 'HELLO', progress: 'NOTE', question: 'ASK',
};

function senderColor(from: string): string {
  return from === 'mentor' ? colors.mentor : from === 'executor' ? colors.executor : colors.human;
}
function senderIcon(from: string): string {
  return from === 'mentor' ? icons.mentor : from === 'executor' ? icons.executor : icons.human;
}

interface Verdict { verdict?: string; risk?: string; confidence?: number; summary?: string }

function parseVerdict(content: string): Verdict | null {
  const m = content.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    if (!o.verdict && !o.risk) return null;
    return { verdict: o.verdict as string, risk: o.risk as string, confidence: o.confidence as number, summary: o.summary as string };
  } catch { return null; }
}

function VerdictChip({ v }: { v: Verdict }): JSX.Element {
  const pass = (v.verdict ?? '').toLowerCase() === 'pass';
  const chipColor = pass ? colors.success : colors.error;
  const riskColor = v.risk === 'high' ? colors.error : v.risk === 'medium' ? colors.warn : colors.success;
  return (
    <Text>
      <Text backgroundColor={chipColor} color="black" bold> {pass ? icons.check : icons.cross} {(v.verdict ?? '?').toUpperCase()} </Text>
      {v.risk ? <Text> <Text dimColor>risk</Text> <Text color={riskColor}>{v.risk}</Text></Text> : null}
      {typeof v.confidence === 'number' ? <Text dimColor> · {Math.round(v.confidence * 100)}% conf</Text> : null}
    </Text>
  );
}

export function MessageView({ msg, maxLines = 120 }: { msg: Message; maxLines?: number }): JSX.Element {
  const color = senderColor(msg.from);
  const verdict = msg.type === 'acceptance' ? parseVerdict(msg.content) : null;
  const bodyText = (verdict ? msg.content.replace(/```json[\s\S]*?```/g, '').trim() : msg.content) || (verdict?.summary ?? '');
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
  return <Text dimColor>   {icons.chevron}{icons.chevron} {label}</Text>;
}

// ── Live streaming turn ─────────────────────────────────────────────────

export function LiveTurn({ role, subtitle, text, tools }: { role: 'mentor' | 'executor'; subtitle: string; text: string; tools: ToolEvent[] }): JSX.Element {
  const color = role === 'mentor' ? colors.mentor : colors.executor;
  const tail = text.split('\n').slice(-14);
  const recentTools = tools.slice(-6);
  const runningCount = tools.filter(t => t.status === 'running').length;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={color}>{senderIcon(role)} </Text>
        <Text color={color} bold>{role.toUpperCase()}</Text>
        <Text dimColor>  {subtitle}</Text>
        {tools.length > 0 ? <Text dimColor>  {icons.gear} {tools.length} {tools.length === 1 ? 'call' : 'calls'}{runningCount ? '…' : ''}</Text> : null}
      </Text>
      <Box flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={color} borderTop={false} borderRight={false} borderBottom={false}>
        {recentTools.map(t => <ToolLine key={t.id} ev={t} />)}
        {text ? tail.map((l, i) => <Text key={i}>{l || ' '}</Text>) : (recentTools.length === 0 ? <Text dimColor>{icons.ellipsis} thinking</Text> : null)}
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
    default: return 'working';
  }
}

// ── Result panels ───────────────────────────────────────────────────────

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function ResultPanel({ state }: { state: PairState }): JSX.Element {
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
            {state.modifiedFiles.slice(0, 10).map((f, i) => (
              <Text key={i}><Text color={colors.success}>{f.status}</Text>  {f.path}</Text>
            ))}
          </Box>
        ) : null}
        <Text dimColor>Type a new task, or /quit to exit.</Text>
      </Box>
    );
  }
  if (state.status === 'paused') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={colors.warn} paddingX={1}>
        <Text color={colors.warn} bold>{icons.pause} Paused</Text>
        <Text dimColor>iter {state.iteration}/{state.maxIterations} · /resume to continue, or a new task.</Text>
      </Box>
    );
  }
  if (state.status === 'error') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={colors.error} paddingX={1}>
        <Text color={colors.error} bold>{icons.cross} Session Failed</Text>
        {state.lastError ? <Text>{state.lastError}</Text> : null}
        <Text dimColor>Check /model, fix the cause, then retry with a new task.</Text>
      </Box>
    );
  }
  return <Text> </Text>;
}
