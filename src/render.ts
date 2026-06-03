import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import type { PairState, Message } from './types.js';
import { getProviderLabel } from './providers.js';
import * as ui from './ui.js';
import logUpdate from 'log-update';

let lastFrame = '';
let liveActive = false;
let spinnerTick = 0;

export function clear(): void {
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
}

export function write(text: string): void {
  process.stdout.write(text + '\n');
}

export function overwrite(text: string): void {
  lastFrame = text;
  liveActive = true;
  logUpdate(text);
}

export function log(text: string): void {
  if (liveActive) {
    logUpdate.clear();
  }
  process.stdout.write(text + '\n');
  if (liveActive && lastFrame) {
    logUpdate(lastFrame);
  }
}

export function resetLogState(): void {
  logUpdate.clear();
  lastFrame = '';
  liveActive = false;
}

export function tickSpinner(): void {
  spinnerTick++;
}

// ── Hero Banner ─────────────────────────────────────────────────────────

const HERO_LOGO_FULL = [
  '██████╗   █████╗  ██╗ ██████╗      ██████╗  ██████╗  ██████╗  ███████╗',
  '██╔══██╗ ██╔══██╗ ██║ ██╔══██╗    ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝',
  '██████╔╝ ███████║ ██║ ██████╔╝    ██║      ██║   ██║ ██║  ██║ █████╗  ',
  '██╔═══╝  ██╔══██║ ██║ ██╔══██╗    ██║      ██║   ██║ ██║  ██║ ██╔══╝  ',
  '██║      ██║  ██║ ██║ ██║  ██║    ╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗',
  '╚═╝      ╚═╝  ╚═╝ ╚═╝ ╚═╝  ╚═╝     ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝',
];

const HERO_LOGO_COMPACT = [
  '┌─┐┌─┐┬┬─┐  ┌─┐┌─┐┌┬┐┌─┐',
  '├─┘├─┤│├┬┘  │  │ │ ││├┤ ',
  '┴  ┴ ┴┴┴└─  └─┘└─┘─┴┘└─┘',
];

const HERO_ROW_COLORS: Array<[number, number, number]> = [
  [129, 140, 248],
  [148, 130, 250],
  [167, 139, 250],
  [192, 132, 252],
  [217, 70, 239],
  [236, 72, 153],
];

const COMPACT_ROW_COLORS: Array<[number, number, number]> = [
  [129, 140, 248],
  [167, 139, 250],
  [217, 70, 239],
];

export function printBanner(): void {
  const width = ui.getColumns();
  const useFull = width >= 76;
  const logo = useFull ? HERO_LOGO_FULL : HERO_LOGO_COMPACT;
  const colors = useFull ? HERO_ROW_COLORS : COMPACT_ROW_COLORS;

  write('');
  for (let i = 0; i < logo.length; i++) {
    const [r, g, b] = colors[i] ?? colors[colors.length - 1];
    write('  ' + chalk.rgb(r, g, b)(logo[i]));
  }
  write('');

  const sparkle = chalk.rgb(217, 70, 239)(ui.icons.sparkle);
  const title = chalk.bold.white('Dual-agent AI pair programming');
  const tagline = chalk.dim('  for the terminal');
  write('  ' + sparkle + '  ' + title + tagline);

  const arrow = chalk.dim(ui.icons.arrow);
  const mentor = ui.palette.mentor.bold('Mentor');
  const executor = ui.palette.executor.bold('Executor');
  write('     ' + chalk.dim('—  ') + mentor + chalk.dim(' plans  ') + arrow + chalk.dim('  ') + executor + chalk.dim(' codes  ') + arrow + chalk.dim('  ') + mentor + chalk.dim(' reviews'));
  write('');
}

export function printHomeHints(directory: string): void {
  const slash = chalk.bold.hex('#a78bfa')('/');
  const help = chalk.bold.hex('#a78bfa')('/help');
  const quit = chalk.bold.hex('#a78bfa')('/quit');

  write('  ' + chalk.dim('cwd  ') + chalk.cyan(ui.truncate(directory, ui.getColumns() - 10)));
  write('  ' + chalk.dim('hint ') + chalk.dim('type ') + slash + chalk.dim(' for commands · ') + help + chalk.dim(' · ') + quit);
  write('');
}

// ── Launch Dashboard ────────────────────────────────────────────────────

interface LaunchInfo {
  task: string;
  directory: string;
  mentorProvider: string;
  mentorModel: string;
  executorProvider: string;
  executorModel: string;
  providers: { provider: string; version: string }[];
  maxIterations: number;
}

export function printLaunchDashboard(info: LaunchInfo): void {
  const termW = ui.getColumns();
  const w = Math.min(termW - 4, 72);
  const innerW = w - 4;
  const border = chalk.hex('#7c3aed');
  const dim = ui.palette.dim;

  const top = border('╭' + '─'.repeat(innerW + 2) + '╮');
  const bot = border('╰' + '─'.repeat(innerW + 2) + '╯');
  const sep = border('├' + '─'.repeat(innerW + 2) + '┤');

  const contentLine = (text: string) => {
    const tw = stringWidth(stripAnsi(text));
    const pad = Math.max(0, innerW - tw);
    return '  ' + border('│') + ' ' + text + ' '.repeat(pad) + ' ' + border('│');
  };

  const taskLines = ui.wrap(info.task, 0, innerW - 8).split('\n');

  const providerDot = (name: string) => {
    const found = info.providers.some(p => p.provider === name);
    return found ? ui.palette.success(ui.icons.check) : ui.palette.dim(ui.icons.cross);
  };

  const lines: string[] = [];
  lines.push('  ' + top);
  lines.push(contentLine(`${chalk.rgb(217, 70, 239)(ui.icons.sparkle)}  ${chalk.bold.white('Session Ready')}`));
  lines.push('  ' + sep);

  lines.push(contentLine(`${dim('task')}    ${chalk.white(taskLines[0] ?? '')}`));
  for (let i = 1; i < taskLines.length; i++) {
    lines.push(contentLine(`         ${chalk.white(taskLines[i])}`));
  }
  lines.push(contentLine(`${dim('dir')}     ${ui.palette.info(ui.truncate(info.directory, innerW - 10))}`));
  lines.push('  ' + sep);

  const mProvider = info.mentorProvider.padEnd(14);
  const eProvider = info.executorProvider.padEnd(14);
  const mModel = ui.truncate(info.mentorModel, innerW - 22);
  const eModel = ui.truncate(info.executorModel, innerW - 22);

  lines.push(contentLine(`${ui.palette.mentor(ui.icons.mentor)} ${ui.palette.mentor.bold('M')}  ${ui.palette.mentor(mProvider)} ${dim(mModel)}`));
  lines.push(contentLine(`${ui.palette.executor(ui.icons.executor)} ${ui.palette.executor.bold('E')}  ${ui.palette.executor(eProvider)} ${dim(eModel)}`));
  lines.push(contentLine(`${dim('iter')}    ${chalk.white(String(info.maxIterations))} ${dim('max iterations · 10 min/turn cap')}`));
  lines.push('  ' + sep);

  const provNames = ['claude', 'opencode', 'codex', 'gemini'] as const;
  const provLine = provNames.map(p => `${providerDot(p)} ${dim(p)}`).join('   ');
  lines.push(contentLine(`${dim('cli ')}    ${provLine}`));
  lines.push('  ' + bot);

  write(lines.join('\n'));
  write('');
}

export function printProviderCheck(providers: { provider: string; version: string }[]): void {
  if (providers.length === 0) {
    write(ui.palette.error('  No AI provider CLIs found. Install one of:'));
    write(ui.palette.dim('    ' + ui.icons.bullet + ' claude   — npm install -g @anthropic-ai/claude-code'));
    write(ui.palette.dim('    ' + ui.icons.bullet + ' opencode — go install github.com/opencode-ai/opencode@latest'));
    write(ui.palette.dim('    ' + ui.icons.bullet + ' codex    — npm install -g @openai/codex'));
    write(ui.palette.dim('    ' + ui.icons.bullet + ' gemini   — npm install -g @google/gemini-cli'));
    write('');
    return;
  }

  const parts: string[] = [];
  for (const p of providers) {
    parts.push(ui.palette.success(ui.icons.check) + ' ' + chalk.bold.white(p.provider) + ui.palette.dim(' ' + p.version.split(' ')[0]));
  }
  write('  ' + ui.palette.dim('providers ') + parts.join(ui.palette.dim('   ')));
  write('');
}


export function renderStatusLine(state: PairState): string {
  const statusStr = state.status.replace(/_/g, ' ').toUpperCase();
  const statusColor = state.status === 'finished' ? ui.palette.success
    : state.status === 'error' ? ui.palette.error
    : state.status === 'paused' ? ui.palette.warn
    : ui.palette.accent;

  const elapsed = state.createdAt ? ui.formatDuration(Date.now() - state.createdAt) : '0s';
  const iter = `iter ${state.iteration}/${state.maxIterations}`;
  const mentorModel = getProviderLabel(state.mentor.provider);
  const execModel = getProviderLabel(state.executor.provider);

  const left = ` ${ui.statusIcon(state.status)}  ${statusColor.bold(statusStr)}  ${ui.palette.dim(iter)}  ${ui.palette.dim(elapsed)}`;
  const right = `${ui.palette.mentor(ui.icons.mentor)} ${ui.palette.dim(mentorModel)}  ${ui.palette.executor(ui.icons.executor)} ${ui.palette.dim(execModel)} `;

  const width = ui.getColumns();
  const leftW = ui.visibleWidth(left);
  const rightW = ui.visibleWidth(right);
  const pad = Math.max(1, width - leftW - rightW);

  return left + ' '.repeat(pad) + right;
}

export function renderAgentBar(state: PairState): string {
  const mentorPhase = state.mentor.activity.phase;
  const execPhase = state.executor.activity.phase;
  const mentorLabel = state.mentor.activity.label;
  const execLabel = state.executor.activity.label;

  const active = state.turn;

  const mentorIcon = active === 'mentor' && state.status !== 'paused' && state.status !== 'finished'
    ? ui.palette.mentor(ui.icons.chevron) : ' ';
  const execIcon = active === 'executor' && state.status !== 'paused' && state.status !== 'finished'
    ? ui.palette.executor(ui.icons.chevron) : ' ';

  const mSpinner = ui.phaseSpinner(mentorPhase, spinnerTick);
  const eSpinner = ui.phaseSpinner(execPhase, spinnerTick);

  const width = ui.getColumns();
  const half = Math.floor(width / 2) - 1;

  const mentorStr = ` ${mentorIcon} ${mSpinner} ${ui.palette.mentor.bold('MENTOR')}   ${ui.palette.dim(ui.truncate(mentorLabel, Math.max(8, half - 16)))}`;
  const execStr = ` ${execIcon} ${eSpinner} ${ui.palette.executor.bold('EXECUTOR')} ${ui.palette.dim(ui.truncate(execLabel, Math.max(8, half - 18)))}`;

  const divider = ui.palette.dim('│');

  const mLen = ui.visibleWidth(mentorStr);
  const eLen = ui.visibleWidth(execStr);
  const mPad = Math.max(0, half - mLen);
  const ePad = Math.max(0, half - eLen);

  return mentorStr + ' '.repeat(mPad) + divider + execStr + ' '.repeat(ePad);
}

export function renderMessage(msg: Message): string {
  const roleIcon = msg.from === 'mentor' ? ui.icons.mentor
    : msg.from === 'executor' ? ui.icons.executor
    : ui.icons.human;

  const roleColor = msg.from === 'mentor' ? ui.palette.mentor
    : msg.from === 'executor' ? ui.palette.executor
    : ui.palette.human;

  const typeLabel = msg.type === 'plan' ? 'PLAN'
    : msg.type === 'result' ? 'RESULT'
    : msg.type === 'acceptance' ? 'REVIEW'
    : msg.type === 'handoff' ? 'HANDOFF'
    : msg.type === 'feedback' ? 'TASK'
    : 'PROGRESS';

  const badgeColor = msg.from === 'mentor' ? ui.palette.mentorBg
    : msg.from === 'executor' ? ui.palette.executorBg
    : chalk.bgGreen.black;
  const badge = badgeColor.bold(` ${typeLabel} `);
  const roleName = roleColor.bold(msg.from.toUpperCase());
  const header = ` ${roleColor(roleIcon)} ${roleName}  ${badge}  ${ui.palette.dim('iter ' + msg.iteration)}`;

  const maxContentLines = 24;
  const contentLines = msg.content.split('\n');
  const truncated = contentLines.length > maxContentLines
    ? [...contentLines.slice(0, maxContentLines), ui.palette.dim(`  ${ui.icons.ellipsis} ${contentLines.length - maxContentLines} more lines (use /log to see full)`)]
    : contentLines;

  const content = truncated
    .map(l => '    ' + ui.wrap(l, 4))
    .join('\n');

  return header + '\n' + ui.palette.dim('  ' + ui.icons.divider.repeat(Math.min(ui.getColumns() - 4, 60))) + '\n' + content;
}

export function renderLiveStatus(state: PairState): string {
  tickSpinner();
  const lines: string[] = [];
  lines.push('');
  lines.push(ui.divider(ui.icons.divider, ui.palette.accentDim));
  lines.push(renderStatusLine(state));
  lines.push(renderAgentBar(state));
  lines.push(ui.divider(ui.icons.divider, ui.palette.accentDim));
  return lines.join('\n');
}

export function printFinish(state: PairState): void {
  write('');
  write(ui.divider('═', ui.palette.success));
  write(ui.center(ui.palette.success.bold(`${ui.icons.check} Task Complete`)));
  write(ui.divider('═', ui.palette.success));
  write('');

  if (state.finishedAt && state.createdAt) {
    const duration = state.finishedAt - state.createdAt;
    write(`  ${ui.palette.dim('Duration:  ')} ${ui.palette.bold(ui.formatDuration(duration))}`);
  }
  write(`  ${ui.palette.dim('Iterations:')} ${ui.palette.bold(String(state.iteration))}`);
  write(`  ${ui.palette.dim('Messages:  ')} ${ui.palette.bold(String(state.messages.length))}`);

  if (state.modifiedFiles.length > 0) {
    write(`  ${ui.palette.dim('Files:     ')} ${ui.palette.bold(String(state.modifiedFiles.length))} changed`);
    for (const f of state.modifiedFiles.slice(0, 10)) {
      const statusIcon = f.status === 'M' ? ui.palette.warn('M')
        : f.status === 'A' ? ui.palette.success('A')
        : f.status === 'D' ? ui.palette.error('D')
        : f.status === '??' ? ui.palette.success('+')
        : ui.palette.dim('?');
      write(`    ${statusIcon}  ${f.path}`);
    }
    if (state.modifiedFiles.length > 10) {
      write(`    ${ui.palette.dim(`${ui.icons.ellipsis} and ${state.modifiedFiles.length - 10} more`)}`);
    }
  }
  write('');
  write(ui.palette.dim('  Type ') + ui.palette.accent.bold('/task <new task>') + ui.palette.dim(' to start another, or ') + ui.palette.accent.bold('/quit') + ui.palette.dim(' to exit.'));
  write('');
}

export function printError(msg: string): void {
  // Use `log` so the message survives the live-status overlay during a run.
  log('');
  log(ui.palette.error(`  ${ui.icons.cross}  Error: ${msg}`));
  log('');
}

export function printErrorBlock(state: PairState): void {
  write('');
  write(ui.divider('═', ui.palette.error));
  write(ui.center(ui.palette.error.bold(`${ui.icons.cross} Session Failed`)));
  write(ui.divider('═', ui.palette.error));
  write('');
  if (state.lastError) {
    const wrapped = ui.wrap(state.lastError, 4, ui.getColumns() - 4)
      .split('\n')
      .map(l => '    ' + l)
      .join('\n');
    write('  ' + ui.palette.error.bold('What went wrong'));
    write('');
    write(wrapped);
    write('');
  }
  write('  ' + ui.palette.dim('Things to check:'));
  write('  ' + ui.palette.dim('  • Run ') + ui.palette.accent('/providers') + ui.palette.dim(' to confirm the CLI is detected'));
  write('  ' + ui.palette.dim('  • Re-pick the model with ') + ui.palette.accent('/mentor') + ui.palette.dim(' or ') + ui.palette.accent('/runner'));
  write('  ' + ui.palette.dim('  • Try ') + ui.palette.accent('/task <spec>') + ui.palette.dim(' to retry with a fresh session'));
  write('');
}

export function printPaused(state: PairState): void {
  write('');
  write(ui.divider(ui.icons.divider, ui.palette.warn));
  write(ui.center(ui.palette.warn.bold(`${ui.icons.pause} Paused`)));
  write('');
  write(`  ${ui.palette.dim('Iteration:')} ${state.iteration}/${state.maxIterations}`);
  write(`  ${ui.palette.dim('Status:   ')} ${state.status}`);
  write('');
  write(ui.palette.dim('  Type ') + ui.palette.accent.bold('/resume') + ui.palette.dim(' to continue, ') + ui.palette.accent.bold('/task <spec>') + ui.palette.dim(' for a new task, or ') + ui.palette.accent.bold('/quit') + ui.palette.dim(' to exit.'));
  write('');
  write(ui.divider(ui.icons.divider, ui.palette.warn));
  write('');
}

export function printHelp(): void {
  write('');
  write(`  ${ui.palette.bold.white('Slash Commands')}`);
  write('');

  const groups: Array<{ name: string; commands: Array<{ name: string; desc: string }> }> = [
    {
      name: 'Session',
      commands: [
        { name: 'task <spec>', desc: 'Start a new task with the current agents' },
        { name: 'resume', desc: 'Continue a paused session' },
        { name: 'mentor', desc: 'Re-select mentor provider & model' },
        { name: 'runner', desc: 'Re-select executor provider & model' },
      ],
    },
    {
      name: 'Inspect',
      commands: [
        { name: 'status', desc: 'Show pair status & iteration info' },
        { name: 'model', desc: 'Show current model configuration' },
        { name: 'files', desc: 'List modified files' },
        { name: 'diff', desc: 'Show git diff summary' },
        { name: 'log', desc: 'Print full message history' },
        { name: 'providers', desc: 'Check installed AI provider CLIs' },
      ],
    },
    {
      name: 'Control',
      commands: [
        { name: 'clear', desc: 'Clear the terminal' },
        { name: 'help', desc: 'Show this help' },
        { name: 'quit', desc: 'Exit pair-code' },
      ],
    },
  ];

  for (const g of groups) {
    write(`  ${ui.palette.accentDim(g.name)}`);
    for (const c of g.commands) {
      const cmd = ui.palette.accent.bold('/' + c.name);
      const pad = ' '.repeat(Math.max(2, 18 - c.name.length));
      write(`    ${cmd}${pad}${ui.palette.dim(c.desc)}`);
    }
    write('');
  }
}

export function printProviders(): void {
  write('');
  write(ui.palette.bold('  Supported Providers'));
  write('');
  write(`  ${ui.palette.mentor.bold('claude   ')} ${ui.palette.dim('Claude Code CLI (Anthropic)')}`);
  write(`  ${ui.palette.executor.bold('opencode ')} ${ui.palette.dim('OpenCode CLI (multi-provider)')}`);
  write(`  ${ui.palette.info.bold('codex    ')} ${ui.palette.dim('OpenAI Codex CLI')}`);
  write(`  ${ui.palette.human.bold('gemini   ')} ${ui.palette.dim('Google Gemini CLI')}`);
  write('');
}

export function clearScreen(): void {
  logUpdate.clear();
  process.stdout.write('\x1B[2J\x1B[H');
  resetLogState();
}
