import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { detectProviders, getDefaultModel, getModelsForProvider, getProviderLabel, discoverModels, type ModelOption } from './providers.js';
import { addMessage, createPairState, initializeGreetingState, addGreetingMessage, setPairStatus } from './state.js';
import { runPairEngine, killActiveChild, type EngineCallbacks } from './process.js';
import type { PairState, ProviderKind } from './types.js';
import { select, searchSelect, input, readLineWithSlashComplete, inputWithSlashComplete, CANCEL, type SlashCommand, type SearchSelectOption } from './prompt.js';
import * as render from './render.js';
import * as ui from './ui.js';

// ─── Slash Commands ──────────────────────────────────────────────────────

interface SlashSpec extends SlashCommand {
  scope: ('setup' | 'session')[];
}

const ALL_COMMANDS: SlashSpec[] = [
  { name: 'task',      label: 'Task',      description: 'Start a new task with current agents',     scope: ['session'] },
  { name: 'resume',    label: 'Resume',    description: 'Continue a paused session',                  scope: ['session'] },
  { name: 'mentor',    label: 'Mentor',    description: 'Re-select mentor provider & model',          scope: ['setup', 'session'] },
  { name: 'runner',    label: 'Runner',    description: 'Re-select executor provider & model',        scope: ['setup', 'session'] },
  { name: 'status',    label: 'Status',    description: 'Show pair status & iteration info',          scope: ['session'] },
  { name: 'model',     label: 'Model',     description: 'Show current model configuration',           scope: ['session'] },
  { name: 'files',     label: 'Files',     description: 'List modified files',                        scope: ['session'] },
  { name: 'diff',      label: 'Diff',      description: 'Show git diff summary',                      scope: ['session'] },
  { name: 'log',       label: 'Log',       description: 'Print full message history',                 scope: ['session'] },
  { name: 'providers', label: 'Providers', description: 'Check installed AI provider CLIs',           scope: ['setup', 'session'] },
  { name: 'clear',     label: 'Clear',     description: 'Clear the terminal',                         scope: ['setup', 'session'] },
  { name: 'help',      label: 'Help',      description: 'Show available commands',                    scope: ['setup', 'session'] },
  { name: 'quit',      label: 'Quit',      description: 'Exit pair-code',                             scope: ['setup', 'session'] },
  { name: 'exit',      label: 'Exit',      description: 'Exit pair-code (alias for /quit)',           scope: ['setup', 'session'], hidden: true },
  { name: 'hello',     label: 'Hello',     description: 'Start a 2-round greeting session',           scope: ['session'] },
];

const setupCommands = (): SlashCommand[] =>
  ALL_COMMANDS.filter(c => c.scope.includes('setup'));

const sessionCommands = (): SlashCommand[] =>
  ALL_COMMANDS.filter(c => c.scope.includes('session'));

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('pair-code v0.1.0');
    process.exit(0);
  }

  const subcommand = args[0];
  if (subcommand === 'providers') {
    render.printBanner();
    const providers = await detectProviders();
    render.printProviderCheck(providers);
    render.printProviders();
    process.exit(0);
  }

  render.clearScreen();
  render.printBanner();

  const positionalArgs = args.filter(a => !a.startsWith('-'));
  const directory = resolve(positionalArgs[0] || process.cwd());

  render.printHomeHints(directory);

  const detected = await detectProviders();
  render.printProviderCheck(detected);

  if (detected.length === 0) {
    process.exit(1);
  }

  const providerKinds = detected.map(p => p.provider);

  // ── Get task spec ────────────────────────────────────────────────────
  const cliSpec = positionalArgs.slice(1).join(' ').trim();
  let taskSpec = cliSpec;
  while (!taskSpec) {
    const entered = await inputWithSlashComplete(
      'What should the agents work on?',
      setupCommands(),
      (cmd) => dispatchSetupCommand(cmd, providerKinds, directory),
      'Describe the task or type / for commands',
    );
    taskSpec = entered.trim();
  }

  // ── Pick agents ──────────────────────────────────────────────────────
  render.write('');
  render.write('  ' + ui.palette.dim('─── Agent Configuration ───'));
  render.write('');

  const mentorConfig = await pickAgentConfig(providerKinds, 'Mentor', 'planner & reviewer', 0, 'mentor');
  render.write('');
  const executorConfig = await pickAgentConfig(providerKinds, 'Runner', 'coder & implementer', Math.min(1, providerKinds.length - 1), 'executor');
  render.write('');

  // ── Build initial state ──────────────────────────────────────────────
  const initialState = createPairState({
    directory,
    spec: taskSpec,
    mentor: mentorConfig,
    executor: executorConfig,
  });

  let state: PairState = addMessage(initialState, {
    from: 'human',
    to: 'mentor',
    type: 'feedback',
    content: taskSpec,
  });

  // ── Launch dashboard + first task run ────────────────────────────────
  render.clearScreen();
  render.printBanner();
  render.printLaunchDashboard({
    task: taskSpec,
    directory,
    mentorProvider: getProviderLabel(mentorConfig.provider),
    mentorModel: mentorConfig.model,
    executorProvider: getProviderLabel(executorConfig.provider),
    executorModel: executorConfig.model,
    providers: detected.map(p => ({ provider: p.provider, version: p.version })),
    maxIterations: state.maxIterations,
  });

  state = await runTask(state);
  printSessionResult(state);

  await runCommandLoop({ current: state });
}

// ─── Engine runner ──────────────────────────────────────────────────────

const stopFlag = { stopped: false };

async function runTask(state: PairState): Promise<PairState> {
  stopFlag.stopped = false;
  let currentState = state;

  const cbs: EngineCallbacks = {
    onStateUpdate(s) { currentState = s; },
    onLog() { /* suppressed in main UI */ },
    onActivity() { /* state already reflects this */ },
    onMessage(s) {
      const last = s.messages[s.messages.length - 1];
      if (last) render.log(render.renderMessage(last));
    },
    onError(msg) { render.printError(msg); },
    shouldStop() { return stopFlag.stopped; },
  };

  const statusInterval = setInterval(() => {
    render.overwrite(render.renderLiveStatus(currentState));
  }, 120);

  const sigintHandler = (): void => {
    if (stopFlag.stopped) {
      // Second Ctrl+C — force kill the child and abort the loop hard.
      killActiveChild();
      return;
    }
    stopFlag.stopped = true;
    render.log(ui.palette.warn('  ' + ui.icons.warn + ' Stop requested. Finishing current turn…'));
  };
  process.on('SIGINT', sigintHandler);

  try {
    const final = await runPairEngine(currentState, cbs);
    return final;
  } finally {
    clearInterval(statusInterval);
    process.off('SIGINT', sigintHandler);
    render.overwrite('');
    render.resetLogState();
  }
}

function printSessionResult(state: PairState): void {
  if (state.status === 'finished') {
    render.printFinish(state);
  } else if (state.status === 'paused') {
    render.printPaused(state);
  } else if (state.status === 'error') {
    render.printErrorBlock(state);
  }
}

// ─── Agent Config Selection ─────────────────────────────────────────────

const BACK_VALUE = '__back__';

type ModelLoadResult = { models: ModelOption[]; source: 'discovered' | 'fallback' };

async function loadModels(provider: import('./types.js').ProviderKind): Promise<ModelLoadResult> {
  const spinnerFrames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let tick = 0;
  let active = true;
  const label = `Discovering models from ${getProviderLabel(provider)}…`;

  const draw = (frame: string) => {
    process.stdout.write(`\r  ${ui.palette.accent(frame)} ${ui.palette.dim(label)}`);
  };
  draw(spinnerFrames[0]);
  const interval = setInterval(() => {
    if (!active) return;
    tick = (tick + 1) % spinnerFrames.length;
    draw(spinnerFrames[tick]);
  }, 80);

  const clearLine = () => {
    process.stdout.write('\r\x1B[2K');
  };

  try {
    const models = await discoverModels(provider);
    active = false;
    clearInterval(interval);
    clearLine();
    return { models, source: 'discovered' };
  } catch {
    active = false;
    clearInterval(interval);
    clearLine();
    return { models: getModelsForProvider(provider), source: 'fallback' };
  }
}

async function pickAgentConfig(
  available: ProviderKind[],
  roleLabel: string,
  roleSubtitle: string,
  defaultProviderIdx: number,
  role: 'mentor' | 'executor',
): Promise<{ role: 'mentor' | 'executor'; provider: ProviderKind; model: string }> {
  let providerIdx = defaultProviderIdx;

  // Loop so the model picker can "go back" to the provider picker.
  for (;;) {
    const providerResult = await select<ProviderKind>(
      `${roleLabel} ${ui.palette.dim('(' + roleSubtitle + ')')} — pick provider`,
      available.map((p) => ({
        label: getProviderLabel(p),
        value: p,
        hint: p,
      })),
      { defaultIndex: providerIdx },
    );

    // Provider step doesn't allow cancel (allowCancel omitted), but TS still
    // sees `CANCEL` in the union — narrow it out.
    if (providerResult === CANCEL) continue;
    const provider = providerResult;
    providerIdx = available.indexOf(provider);

    const { models, source } = await loadModels(provider);
    const showSubProvider = models.some(m => !!m.subProvider);

    if (source === 'discovered') {
      render.write('  ' + ui.palette.success(ui.icons.check) + ui.palette.dim(`  loaded ${models.length} models from ${getProviderLabel(provider)}`));
    } else if (source === 'fallback') {
      render.write('  ' + ui.palette.warn(ui.icons.warn) + ui.palette.dim(`  using built-in model list (couldn't query ${getProviderLabel(provider)})`));
    }

    const modelOptions: SearchSelectOption<string>[] = [
      {
        label: '← Back',
        value: BACK_VALUE,
        meta: ['change provider'],
        searchExtra: 'back return previous',
      },
      ...models.map(m => {
        const meta: string[] = [];
        if (showSubProvider) meta.push(m.subProvider ?? '—');
        if (m.tier) meta.push(m.tier);
        return {
          label: m.label,
          value: m.model,
          meta,
          // Fuzzy-match against the raw model id too so users can search
          // by partial id (e.g. "sonnet-4" or "openrouter/anthropic").
          searchExtra: m.model + ' ' + (m.subProvider ?? '') + ' ' + (m.tier ?? ''),
        };
      }),
      {
        label: 'Custom model…',
        value: '__custom__',
        meta: ['type a model id'],
        searchExtra: 'custom other manual id',
      },
    ];

    const modelResult = await searchSelect<string>(
      `${roleLabel} ${ui.palette.dim('/ ' + getProviderLabel(provider))} — pick model`,
      modelOptions,
      {
        allowCancel: true,
        defaultIndex: 1,
        placeholder: showSubProvider ? 'type to filter (e.g. "sonnet anthropic")' : 'type to filter',
        maxVisible: 9,
      },
    );

    if (modelResult === CANCEL || modelResult === BACK_VALUE) {
      // Go back to provider selection while remembering the last provider.
      continue;
    }

    if (modelResult === '__custom__') {
      const custom = await input('Enter model ID');
      return { role, provider, model: custom || getDefaultModel(provider) };
    }

    return { role, provider, model: modelResult };
  }
}

// ─── Setup-Phase Command Handler ────────────────────────────────────────

async function dispatchSetupCommand(cmd: string, _availableProviders: ProviderKind[], directory: string): Promise<void> {
  const name = cmd.replace(/^\//, '').split(/\s+/)[0].toLowerCase();

  switch (name) {
    case 'help':
      render.printHelp();
      break;

    case 'quit':
    case 'exit':
      render.write(ui.palette.dim('  Goodbye!'));
      render.write('');
      process.exit(0);
      break;

    case 'clear':
      render.clearScreen();
      render.printBanner();
      render.printHomeHints(directory);
      break;

    case 'providers': {
      const detected = await detectProviders();
      render.printProviderCheck(detected);
      render.printProviders();
      break;
    }

    case 'mentor':
    case 'runner':
      render.write('');
      render.write(ui.palette.dim(`  ${ui.icons.info}  ${name === 'mentor' ? 'Mentor' : 'Runner'} configuration happens after you describe the task.`));
      render.write('');
      break;

    default:
      render.write('');
      render.write(ui.palette.dim(`  ${ui.icons.info}  ${cmd} is available once a session has started.`));
      render.write('');
      break;
  }
}

// ─── Session Command Loop ───────────────────────────────────────────────

interface StateRef { current: PairState }

async function runCommandLoop(stateRef: StateRef): Promise<void> {
  const commands = sessionCommands();

  while (true) {
    const line = await readSlashLine(commands);
    if (line === null) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Plain text without leading slash → treat as new task spec.
    if (!trimmed.startsWith('/')) {
      await handleNewTask(stateRef, trimmed);
      continue;
    }

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const rest = parts.slice(1).join(' ').trim();

    const exit = await dispatchSessionCommand(stateRef, cmd, rest);
    if (exit) return;
  }
}

function readSlashLine(commands: SlashCommand[]): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const handle = readLineWithSlashComplete(commands, (line) => {
      if (resolved) return;
      resolved = true;
      resolve(line);
    });
    void handle;
  });
}

async function dispatchSessionCommand(
  stateRef: StateRef,
  cmd: string,
  rest: string,
): Promise<boolean> {
  const name = cmd.replace(/^\//, '');
  const state = stateRef.current;

  switch (name) {
    case 'help':
      render.printHelp();
      return false;

    case 'quit':
    case 'exit':
      render.write(ui.palette.dim('  Goodbye!'));
      render.write('');
      process.exit(0);
      return true;

    case 'clear':
      render.clearScreen();
      render.printBanner();
      return false;

    case 'status': {
      render.write('');
      render.write(render.renderStatusLine(state));
      render.write(render.renderAgentBar(state));
      render.write('');
      return false;
    }

    case 'model':
      render.write('');
      render.write(`  ${ui.palette.mentor(ui.icons.mentor)} ${ui.palette.mentor.bold('Mentor   ')}  ${getProviderLabel(state.mentor.provider)} ${ui.palette.dim('/')} ${ui.palette.bold(state.mentor.model)}`);
      render.write(`  ${ui.palette.executor(ui.icons.executor)} ${ui.palette.executor.bold('Executor ')}  ${getProviderLabel(state.executor.provider)} ${ui.palette.dim('/')} ${ui.palette.bold(state.executor.model)}`);
      render.write('');
      return false;

    case 'files':
      render.write('');
      if (state.modifiedFiles.length === 0) {
        render.write(ui.palette.dim('  No files modified yet.'));
      } else {
        render.write(ui.palette.bold('  Modified Files'));
        for (const f of state.modifiedFiles) {
          const s = f.status === 'M' ? ui.palette.warn('M')
            : f.status === 'A' ? ui.palette.success('A')
            : f.status === 'D' ? ui.palette.error('D')
            : f.status === '??' ? ui.palette.success('+')
            : ui.palette.dim('?');
          render.write(`    ${s}  ${f.path}`);
        }
      }
      render.write('');
      return false;

    case 'diff': {
      try {
        const diff = execSync('git diff HEAD --stat', { cwd: state.directory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const out = diff.trim() || '(no tracked changes)';
        render.write('');
        render.write(ui.palette.bold('  Git Diff Summary'));
        render.write('');
        render.write(out.split('\n').map(l => '    ' + l).join('\n'));
        render.write('');
      } catch {
        render.write('');
        render.write(ui.palette.dim('  No git diff available (not a git repo or no changes).'));
        render.write('');
      }
      return false;
    }

    case 'log':
      render.write('');
      render.write(ui.palette.bold(`  Full Message Log (${state.messages.length})`));
      render.write('');
      for (const msg of state.messages) {
        render.write(render.renderMessage(msg));
        render.write('');
      }
      return false;

    case 'providers': {
      const detected = await detectProviders();
      render.printProviderCheck(detected);
      return false;
    }

    case 'mentor': {
      const available = (await detectProviders()).map(p => p.provider);
      render.write('');
      render.write('  ' + ui.palette.mentor.bold(ui.icons.mentor + ' Re-select Mentor Agent'));
      render.write('');
      const cfg = await pickAgentConfig(available, 'Mentor', 'planner & reviewer', 0, 'mentor');
      stateRef.current = {
        ...state,
        mentor: { ...state.mentor, provider: cfg.provider, model: cfg.model, sessionId: undefined },
      };
      render.write('');
      render.write('  ' + ui.palette.mentor(`${ui.icons.check} Mentor → ${getProviderLabel(cfg.provider)} / ${cfg.model}`));
      render.write('');
      return false;
    }

    case 'runner': {
      const available = (await detectProviders()).map(p => p.provider);
      render.write('');
      render.write('  ' + ui.palette.executor.bold(ui.icons.executor + ' Re-select Runner Agent'));
      render.write('');
      const cfg = await pickAgentConfig(available, 'Runner', 'coder & implementer', Math.min(1, available.length - 1), 'executor');
      stateRef.current = {
        ...state,
        executor: { ...state.executor, provider: cfg.provider, model: cfg.model, sessionId: undefined },
      };
      render.write('');
      render.write('  ' + ui.palette.executor(`${ui.icons.check} Runner → ${getProviderLabel(cfg.provider)} / ${cfg.model}`));
      render.write('');
      return false;
    }

    case 'task': {
      const spec = rest || (await input('Describe the new task'));
      if (!spec.trim()) {
        render.write(ui.palette.dim('  No task entered. Cancelled.'));
        render.write('');
        return false;
      }
      await handleNewTask(stateRef, spec.trim());
      return false;
    }

    case 'resume': {
      if (state.status !== 'paused') {
        render.write('');
        render.write(ui.palette.dim('  ' + ui.icons.info + ' Nothing to resume — the session is ' + state.status + '.'));
        render.write('');
        return false;
      }
      render.write('');
      render.write(ui.palette.success('  ' + ui.icons.play + ' Resuming paused session…'));
      render.write('');
      const resumed = await runTask({ ...state, status: 'mentoring' });
      stateRef.current = resumed;
      printSessionResult(resumed);
      return false;
    }

    case 'hello': {
      render.write('');
      render.write(ui.palette.accent('  ' + ui.icons.sparkle + ' Starting greeting session…'));
      render.write('');
      const greetingState = await runGreetingSession(stateRef);
      stateRef.current = greetingState;
      return false;
    }

    default:
      render.write('');
      render.write(ui.palette.error(`  ${ui.icons.cross} Unknown command: /${name}`));
      render.write(ui.palette.dim('  Type /help to see available commands.'));
      render.write('');
      return false;
  }
}

async function runGreetingSession(stateRef: StateRef): Promise<PairState> {
  const current = stateRef.current;
  let state: PairState = {
    ...current,
    greetingState: initializeGreetingState(),
    status: 'greeting',
  };
  stateRef.current = state;

  const greetings = [
    { from: 'mentor' as const, message: 'Hello Executor! Ready to code today?' },
    { from: 'executor' as const, message: 'Hello Mentor! Yes, let\'s build something great together!' },
  ];

  for (const greeting of greetings) {
    state = addGreetingMessage(state, greeting.from, greeting.message);
    stateRef.current = state;

    const roleLabel = greeting.from === 'mentor' ? 'Mentor' : 'Executor';
    const roleColor = greeting.from === 'mentor' ? ui.palette.mentor : ui.palette.executor;

    render.write('');
    render.write(`  ${roleColor(ui.icons.sparkle)} ${roleColor.bold(roleLabel)}: ${greeting.message}`);
    render.write('');

    state = addMessage(state, {
      from: greeting.from,
      to: greeting.from === 'mentor' ? 'executor' : 'mentor',
      type: 'greeting',
      content: greeting.message,
    });
    stateRef.current = state;

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  state = setPairStatus(state, 'finished', 'Greeting session complete');
  stateRef.current = state;

  render.write('');
  render.write(ui.palette.success('  ' + ui.icons.check + ' Greeting session completed successfully!'));
  render.write('');

  return state;
}

async function handleNewTask(stateRef: StateRef, spec: string): Promise<void> {
  const current = stateRef.current;
  const fresh = createPairState({
    directory: current.directory,
    spec,
    mentor: {
      role: 'mentor',
      provider: current.mentor.provider,
      model: current.mentor.model,
      reasoningEffort: current.mentor.reasoningEffort as 'low' | 'medium' | 'high' | undefined,
    },
    executor: {
      role: 'executor',
      provider: current.executor.provider,
      model: current.executor.model,
      reasoningEffort: current.executor.reasoningEffort as 'low' | 'medium' | 'high' | undefined,
    },
    maxIterations: current.maxIterations,
  });

  const withSpec = addMessage(fresh, {
    from: 'human', to: 'mentor', type: 'feedback', content: spec,
  });

  render.write('');
  render.write('  ' + ui.palette.success(ui.icons.sparkle + ' New task started'));
  render.write('  ' + ui.palette.dim('    ' + ui.truncate(spec, ui.getColumns() - 8)));
  render.write('');

  const finalState = await runTask(withSpec);
  stateRef.current = finalState;
  printSessionResult(finalState);
}

// ─── Usage ──────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
${ui.palette.bold('pair-code')} ${ui.palette.dim('v0.1.0')}
${ui.palette.dim('Dual-agent AI coding harness for the terminal')}

${ui.palette.bold('Usage:')}
  pair-code [directory] [task description]
  pair-code providers       ${ui.palette.dim('Check installed AI providers')}

${ui.palette.bold('Options:')}
  -h, --help      ${ui.palette.dim('Show this help')}
  -v, --version   ${ui.palette.dim('Show version')}

${ui.palette.bold('Examples:')}
  pair-code . "Fix the login bug in auth.ts"
  pair-code ~/projects/api "Add rate limiting middleware"
  cd my-project && pair-code . "Refactor the database layer"

${ui.palette.bold('Slash Commands (inside the session):')}
  /task <spec>     ${ui.palette.dim('Start a new task with the current agents')}
  /resume          ${ui.palette.dim('Continue a paused session')}
  /mentor          ${ui.palette.dim('Re-select mentor provider & model')}
  /runner          ${ui.palette.dim('Re-select runner provider & model')}
  /status          ${ui.palette.dim('Show pair status & iteration info')}
  /files           ${ui.palette.dim('List modified files')}
  /diff            ${ui.palette.dim('Show git diff summary')}
  /log             ${ui.palette.dim('Print full message history')}
  /model           ${ui.palette.dim('Show current model configuration')}
  /providers       ${ui.palette.dim('Check installed AI provider CLIs')}
  /clear           ${ui.palette.dim('Clear the terminal')}
  /help            ${ui.palette.dim('Show available commands')}
  /quit            ${ui.palette.dim('Exit pair-code')}
`);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Fatal:', msg);
  process.exit(1);
});
