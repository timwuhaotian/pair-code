import { useEffect, useRef, useState, type ReactNode, type JSX } from 'react';
import { execSync } from 'node:child_process';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import type { PairState, Message, Profile } from './types.js';
import { loadProfiles, suggestModels, profileLabel, registerSessionProfile } from './providers.js';
import { createPairState, addMessage } from './state.js';
import { useEngine } from './useEngine.js';
import { Select, SearchSelect, TextPrompt, SlashInput, type SlashCommand, type SearchItem } from './inputs.js';
import { Banner, StatusBar, AgentBar, LiveTurn, MessageView, ResultPanel, ConnectorLine, liveSubtitle } from './components.js';
import { colors, icons, truncate } from './ui.js';

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'task', description: 'Start a new task with the current agents' },
  { name: 'resume', description: 'Continue a paused session' },
  { name: 'mentor', description: 'Re-select mentor profile & model' },
  { name: 'runner', description: 'Re-select executor profile & model' },
  { name: 'model', description: 'Show current model configuration' },
  { name: 'status', description: 'Show pair status & iteration info' },
  { name: 'files', description: 'List modified files' },
  { name: 'diff', description: 'Show git diff summary' },
  { name: 'profiles', description: 'List configured endpoint profiles' },
  { name: 'clear', description: 'Clear the screen' },
  { name: 'help', description: 'Show available commands' },
  { name: 'quit', description: 'Exit pair-code' },
];

interface RolePick { profileName: string; baseUrl: string; model: string }

const ADD_ENDPOINT = '__add_endpoint__';

// ── Endpoint entry (base URL + key, held in memory only) ─────────────────

function EndpointForm(props: {
  onDone: (input: { baseUrl: string; apiKey: string }) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [baseUrl, setBaseUrl] = useState<string | null>(null);

  if (baseUrl === null) {
    return (
      <TextPrompt
        message="Endpoint base URL"
        placeholder="https://open.bigmodel.cn/api/anthropic"
        onSubmit={(v) => setBaseUrl(v)}
        onCancel={props.onCancel}
      />
    );
  }
  return (
    <Box flexDirection="column">
      <Text dimColor>  {icons.check} {baseUrl}</Text>
      <TextPrompt
        message="API key"
        placeholder="kept in memory, never written to disk"
        mask
        onSubmit={(apiKey) => props.onDone({ baseUrl, apiKey })}
        onCancel={() => setBaseUrl(null)}
      />
    </Box>
  );
}

// ── Role picker (endpoint → model), reused by setup and /mentor /runner ──

function RolePicker(props: {
  roleLabel: string;
  roleSubtitle: string;
  profiles: Profile[];
  defaultProfileIndex: number;
  onDone: (pick: RolePick) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [chosen, setChosen] = useState<Profile | null>(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState(false);

  if (adding) {
    return (
      <Box flexDirection="column">
        <Text dimColor>  Add an Anthropic-compatible endpoint (this session only)</Text>
        <EndpointForm
          onCancel={() => setAdding(false)}
          onDone={({ baseUrl, apiKey }) => { const r = registerSessionProfile({ baseUrl, apiKey }); setAdding(false); setChosen(r); }}
        />
      </Box>
    );
  }

  if (!chosen) {
    return (
      <Select
        message={`${props.roleLabel} (${props.roleSubtitle}) — pick endpoint`}
        initialIndex={props.defaultProfileIndex}
        items={[
          ...props.profiles.map(p => ({ label: p.label, value: p.name, hint: p.baseUrl || 'official api' })),
          { label: '+ Add an endpoint…', value: ADD_ENDPOINT, hint: 'base URL + key' },
        ]}
        onSubmit={(name) => name === ADD_ENDPOINT ? setAdding(true) : setChosen(props.profiles.find(p => p.name === name)!)}
        onCancel={props.onCancel}
      />
    );
  }

  const profile = chosen;
  const finish = (model: string) => props.onDone({ profileName: profile.name, baseUrl: profile.baseUrl, model });
  const models = suggestModels(profile.name, profile.defaultModel);

  // A freshly-added custom endpoint has no curated suggestions — go straight to
  // typing the model id rather than showing a one-item list.
  if (custom || models.length === 0) {
    return (
      <TextPrompt
        message={`${props.roleLabel} / ${profile.label} — enter model id`}
        placeholder={profile.defaultModel ?? 'e.g. glm-4.6, deepseek-chat'}
        onSubmit={finish}
        onCancel={() => (custom ? setCustom(false) : setChosen(null))}
      />
    );
  }

  const items: SearchItem<string>[] = [
    ...models.map(m => ({ label: m.label, value: m.model, meta: m.tier, keywords: m.model })),
    { label: 'Custom model…', value: '__custom__', meta: 'type an id', keywords: 'custom other manual' },
  ];

  return (
    <SearchSelect
      message={`${props.roleLabel} / ${profile.label} — pick model`}
      items={items}
      placeholder="type to filter, or pick Custom"
      onSubmit={(v) => v === '__custom__' ? setCustom(true) : finish(v)}
      onCancel={() => setChosen(null)}
    />
  );
}

// ── Setup wizard ─────────────────────────────────────────────────────────

function SetupWizard(props: {
  directory: string;
  initialSpec: string;
  onDone: (state: PairState) => void;
}): JSX.Element {
  const [spec, setSpec] = useState(props.initialSpec);
  const [step, setStep] = useState<'spec' | 'mentor' | 'executor'>(props.initialSpec ? 'mentor' : 'spec');
  const mentorRef = useRef<RolePick | null>(null);
  // Read fresh each render so an endpoint added via "+ Add" during one role's
  // pick is immediately available to the other role.
  const profiles = loadProfiles();

  if (step === 'spec') {
    return (
      <Box flexDirection="column">
        <Text dimColor>  cwd {props.directory}</Text>
        <TextPrompt
          message="What should the agents work on?"
          placeholder="describe the task"
          onSubmit={(s) => { setSpec(s); setStep('mentor'); }}
        />
      </Box>
    );
  }

  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Text><Text color={colors.accent} dimColor>─── Agent Configuration ───</Text></Text>
      <Text><Text color={colors.human}>{icons.human} task   </Text><Text dimColor>{truncate(spec, 60)}</Text></Text>
      {mentorRef.current
        ? <Text><Text color={colors.mentor}>{icons.mentor} mentor </Text><Text dimColor>{profileLabel(mentorRef.current.profileName)} / {mentorRef.current.model}</Text></Text>
        : <Text><Text color={colors.mentor}>{icons.mentor} mentor </Text><Text dimColor>choosing…</Text></Text>}
    </Box>
  );

  if (step === 'mentor') {
    return (
      <Box flexDirection="column">
        {header}
        <RolePicker
          roleLabel="Mentor" roleSubtitle="planner & reviewer"
          profiles={profiles} defaultProfileIndex={0}
          onDone={(pick) => { mentorRef.current = pick; setStep('executor'); }}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {header}
      <RolePicker
        roleLabel="Executor" roleSubtitle="coder & implementer"
        profiles={profiles} defaultProfileIndex={Math.min(1, profiles.length - 1)}
        onCancel={() => { mentorRef.current = null; setStep('mentor'); }}
        onDone={(pick) => {
          const mentor = mentorRef.current!;
          let s = createPairState({
            directory: props.directory,
            spec,
            mentor: { role: 'mentor', profileName: mentor.profileName, baseUrl: mentor.baseUrl, model: mentor.model },
            executor: { role: 'executor', profileName: pick.profileName, baseUrl: pick.baseUrl, model: pick.model },
          });
          s = addMessage(s, { from: 'human', to: 'mentor', type: 'feedback', content: spec });
          props.onDone(s);
        }}
      />
    </Box>
  );
}

// ── Session ──────────────────────────────────────────────────────────────

function freshTask(prev: PairState, spec: string): PairState {
  let s = createPairState({
    directory: prev.directory,
    spec,
    mentor: { role: 'mentor', profileName: prev.mentor.profileName, baseUrl: prev.mentor.baseUrl, model: prev.mentor.model },
    executor: { role: 'executor', profileName: prev.executor.profileName, baseUrl: prev.executor.baseUrl, model: prev.executor.model },
    maxIterations: prev.maxIterations,
  });
  s = addMessage(s, { from: 'human', to: 'mentor', type: 'feedback', content: spec });
  return s;
}

function Session(props: { initialState: PairState }): JSX.Element {
  const { exit } = useApp();
  const { write } = useStdout();
  const engine = useEngine(props.initialState);
  const state = engine.state ?? props.initialState;
  // Recomputed each render so endpoints added mid-session (via an overlay's
  // "+ Add endpoint") appear immediately; loadProfiles() is a cheap env scan.
  const profiles = loadProfiles();

  const [overlay, setOverlay] = useState<null | 'mentor' | 'runner'>(null);
  const [notice, setNotice] = useState<ReactNode | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const seen = useRef(new Set<string>());
  const started = useRef(false);

  // Auto-run the first task once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void engine.runTask(props.initialState);
  }, [engine, props.initialState]);

  // Append new messages into the monotonic transcript (survives task resets).
  useEffect(() => {
    const fresh = state.messages.filter(m => !seen.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach(m => seen.current.add(m.id));
    setTranscript(prev => [...prev, ...fresh]);
  }, [state.messages]);

  // Elapsed ticker while running.
  useEffect(() => {
    if (!engine.running) return;
    const t = setInterval(() => setElapsed(Date.now() - state.createdAt), 250);
    return () => clearInterval(t);
  }, [engine.running, state.createdAt]);

  // Esc to stop a running turn.
  useInput((_i, key) => { if (key.escape) engine.requestStop(); }, { isActive: engine.running && !overlay });

  const runReplace = async (next: PairState) => { engine.setState(next); await engine.runTask(next); };

  const handleLine = (line: string) => {
    setNotice(null);
    if (!line.startsWith('/')) { void runReplace(freshTask(state, line)); return; }
    const [cmd, ...rest] = line.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'quit': case 'exit': exit(); break;
      case 'mentor': setOverlay('mentor'); break;
      case 'runner': setOverlay('runner'); break;
      case 'task': if (arg) void runReplace(freshTask(state, arg)); else setNotice(<Text dimColor>Usage: /task &lt;spec&gt;</Text>); break;
      case 'resume':
        if (state.status === 'paused') void engine.runTask({ ...state, status: 'mentoring' });
        else setNotice(<Text dimColor>Nothing to resume — session is {state.status}.</Text>);
        break;
      case 'model': setNotice(
        <Box flexDirection="column">
          <Text><Text color={colors.mentor}>{icons.mentor} Mentor   </Text>{profileLabel(state.mentor.profileName)} <Text dimColor>/</Text> {state.mentor.model}</Text>
          <Text><Text color={colors.executor}>{icons.executor} Executor </Text>{profileLabel(state.executor.profileName)} <Text dimColor>/</Text> {state.executor.model}</Text>
        </Box>); break;
      case 'status': setNotice(<Text dimColor>{state.status} · iter {state.iteration}/{state.maxIterations} · {state.messages.length} messages · {state.modifiedFiles.length} files</Text>); break;
      case 'files': setNotice(
        state.modifiedFiles.length === 0 ? <Text dimColor>No files modified yet.</Text> :
        <Box flexDirection="column">{state.modifiedFiles.map((f, i) => <Text key={i}><Text color={colors.success}>{f.status}</Text>  {f.path}</Text>)}</Box>); break;
      case 'diff': {
        let out = '';
        try { out = execSync('git diff HEAD --stat', { cwd: state.directory, encoding: 'utf-8' }).trim(); } catch { /* ignore */ }
        setNotice(<Text dimColor>{out || 'No git diff available.'}</Text>); break;
      }
      case 'profiles': setNotice(<Text dimColor>{profiles.map(p => p.label).join(' · ') || 'No profiles configured.'}</Text>); break;
      case 'help': setNotice(
        <Box flexDirection="column">{SLASH_COMMANDS.map(c => <Text key={c.name}><Text color={colors.accent}>/{c.name}</Text><Text dimColor>{' '.repeat(Math.max(1, 10 - c.name.length))}{c.description}</Text></Text>)}</Box>); break;
      case 'clear': write('\x1B[2J\x1B[3J\x1B[H'); setTranscript([]); break;
      default: setNotice(<Text color={colors.error}>Unknown command: /{cmd}</Text>);
    }
  };

  if (overlay) {
    const role = overlay === 'mentor' ? 'mentor' : 'executor';
    return (
      <Box flexDirection="column" marginY={1}>
        <RolePicker
          roleLabel={overlay === 'mentor' ? 'Mentor' : 'Executor'}
          roleSubtitle={overlay === 'mentor' ? 'planner & reviewer' : 'coder & implementer'}
          profiles={profiles}
          defaultProfileIndex={Math.max(0, profiles.findIndex(p => p.name === state[role].profileName))}
          onCancel={() => setOverlay(null)}
          onDone={(pick) => {
            const next = { ...state, [role]: { ...state[role], profileName: pick.profileName, baseUrl: pick.baseUrl, model: pick.model, sessionId: undefined } };
            engine.setState(next as PairState);
            setOverlay(null);
            setNotice(<Text color={role === 'mentor' ? colors.mentor : colors.executor}>{icons.check} {overlay} → {profileLabel(pick.profileName)} / {pick.model}</Text>);
          }}
        />
      </Box>
    );
  }

  const terminal = state.status === 'finished' || state.status === 'paused' || state.status === 'error';

  return (
    <Box flexDirection="column">
      <Static items={[{ id: '__banner__' } as { id: string }, ...transcript]}>
        {(item) => {
          if (item.id === '__banner__') return <Banner key="banner" />;
          const m = item as Message;
          if (m.type === 'handoff') return <ConnectorLine key={m.id} label={`handed to ${m.to}`} />;
          return <MessageView key={m.id} msg={m} />;
        }}
      </Static>

      {engine.running ? (
        <Box flexDirection="column" marginTop={1}>
          <LiveTurn role={state.turn} subtitle={liveSubtitle(state.status)} text={engine.liveText} tools={engine.liveTools} />
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colors.accentDim} paddingX={1}>
        <StatusBar state={state} elapsedMs={engine.running ? elapsed : (state.finishedAt ?? state.createdAt) - state.createdAt} />
        {/* During a live turn the LiveTurn header already shows the active agent in
            detail, so the AgentBar would just duplicate it — show it only at rest. */}
        {!engine.running ? <AgentBar state={state} /> : null}
      </Box>

      {notice ? <Box marginTop={1}>{notice}</Box> : null}

      {!engine.running && terminal ? <Box marginTop={1}><ResultPanel state={state} /></Box> : null}

      {!engine.running ? (
        <Box marginTop={1}>
          <SlashInput commands={SLASH_COMMANDS} onSubmit={handleLine} placeholder="type a new task, or / for commands" />
        </Box>
      ) : (
        <Box marginTop={1}><Text dimColor>  esc to stop the current turn</Text></Box>
      )}
    </Box>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

export function App(props: { directory: string; initialSpec: string }): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [state, setState] = useState<PairState | null>(null);

  // First run with nothing configured: connect an endpoint interactively rather
  // than dead-ending on env-var instructions. The key is held in memory only.
  if (profiles.length === 0) {
    return (
      <Box flexDirection="column">
        <Banner />
        <Box flexDirection="column" marginBottom={1}>
          <Text><Text color={colors.accent}>{icons.sparkle} Let's connect an endpoint to get started.</Text></Text>
          <Text dimColor>  Any Anthropic-compatible endpoint works — GLM, DeepSeek, Kimi, Qwen, a gateway, or the official API.</Text>
          <Text dimColor>  Nothing is written to disk; the key stays in memory for this session.</Text>
          <Text dimColor>  Tip: export PAIR_PROFILE_&lt;NAME&gt;_BASE_URL + _KEY to skip this next time.</Text>
        </Box>
        <EndpointForm onDone={({ baseUrl, apiKey }) => { registerSessionProfile({ baseUrl, apiKey }); setProfiles(loadProfiles()); }} />
      </Box>
    );
  }

  if (!state) {
    return (
      <Box flexDirection="column">
        <Banner />
        <SetupWizard directory={props.directory} initialSpec={props.initialSpec} onDone={setState} />
      </Box>
    );
  }

  return <Session initialState={state} />;
}
