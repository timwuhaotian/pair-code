/* Visual harness: render the conversation UX with sample data (no TTY, no
 * network) so the design can be iterated frame-by-frame.
 *   npx tsx scripts/preview.tsx
 */
import React from 'react';
import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import { createPairState, addMessage, prepareRun, initializeGreetingState, addGreetingMessage } from '../src/state.js';
import type { PairState, ToolEvent } from '../src/types.js';
import { Banner, StatusBar, AgentBar, LiveTurn, MessageView, ResultPanel, ConnectorLine } from '../src/components.js';
import { SlashInput, Select, SearchSelect } from '../src/inputs.js';
import { colors } from '../src/ui.js';

function base(): PairState {
  let s = createPairState({
    directory: '/Users/dev/project',
    spec: 'Add rate limiting middleware to the API and cover it with tests',
    mentor: { role: 'mentor', profileName: 'glm', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-4.6' },
    executor: { role: 'executor', profileName: 'deepseek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
  });
  s = addMessage(s, { from: 'human', to: 'mentor', type: 'feedback', content: 'Add rate limiting middleware to the API and cover it with tests' });
  return s;
}

function section(title: string, node: React.ReactElement): void {
  const { lastFrame } = render(node);
  process.stdout.write(`\n\x1b[7m  ${title}  \x1b[0m\n\n`);
  process.stdout.write((lastFrame() ?? '') + '\n');
}

// 1 — Setup
section('SETUP — banner + spec', <Box flexDirection="column"><Banner /><Text dimColor>  cwd /Users/dev/project</Text></Box>);

// 1b — Real wizard: pick mentor, land on executor step (header shows task + mentor)
{
  process.env.PAIR_PROFILE_GLM_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
  process.env.PAIR_PROFILE_GLM_KEY = 'sk-x';
  process.env.PAIR_PROFILE_GLM_MODEL = 'glm-4.6';
  process.env.PAIR_PROFILE_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';
  process.env.PAIR_PROFILE_DEEPSEEK_KEY = 'sk-y';
  const { App } = await import('../src/app.js');
  const w = render(<App directory="/Users/dev/project" initialSpec="Add rate limiting middleware and tests" />);
  w.stdin.write('\r');                 // mentor: pick first endpoint
  await new Promise(r => setTimeout(r, 40));
  w.stdin.write('\r');                 // mentor: pick first model → advance to executor
  await new Promise(r => setTimeout(r, 40));
  process.stdout.write('\n\x1b[7m  WIZARD — executor step (mentor chosen)  \x1b[0m\n\n' + (w.lastFrame() ?? '') + '\n');
  w.unmount();
}

// 2 — Mentor planning (running), streaming + tools
{
  let s = prepareRun(base(), 'mentor');
  s = { ...s, mentor: { ...s.mentor, activity: { phase: 'using_tools', label: 'Read auth.ts', startedAt: 0, updatedAt: 0 } } };
  const tools: ToolEvent[] = [
    { id: '1', name: 'Read', target: 'src/server/app.ts', status: 'done' },
    { id: '2', name: 'Grep', target: 'rateLimit', status: 'done' },
    { id: '3', name: 'Glob', target: 'src/**/*.test.ts', status: 'running' },
  ];
  const text = 'Plan:\n1. Add a token-bucket limiter in src/middleware/rateLimit.ts\n2. Wire it into the app factory before the router\n3. Add unit tests for allow/deny + reset window';
  section('RUNNING — mentor planning', (
    <Box flexDirection="column">
      <LiveTurn role="mentor" subtitle="planning" text={text} tools={tools} />
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor={colors.accentDim} paddingX={1}>
        <StatusBar state={s} elapsedMs={8200} />
      </Box>
      <Box marginTop={1}><Text dimColor>  esc to stop the current turn</Text></Box>
    </Box>
  ));

  // At-rest status box (between turns / terminal) keeps the AgentBar.
  section('AT REST — status + agent bar', (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accentDim} paddingX={1}>
      <StatusBar state={s} elapsedMs={8200} />
      <AgentBar state={s} />
    </Box>
  ));
}

// 3 — Completed messages transcript
{
  let s = base();
  s = addMessage(prepareRun(s, 'mentor'), { from: 'mentor', to: 'executor', type: 'plan', content: 'Plan:\n1. token-bucket limiter\n2. wire into app factory\n3. tests for allow/deny' });
  s = addMessage(prepareRun(s, 'executor'), { from: 'executor', to: 'mentor', type: 'result', content: 'Added src/middleware/rateLimit.ts and wired it in.\nRan `npm test` → 14 passing.\nRan `tsc --noEmit` → clean.' });
  s = addMessage(prepareRun(s, 'mentor'), { from: 'mentor', to: 'executor', type: 'acceptance', content: 'The limiter is correct but the reset window is off by one — the final request in a window is wrongly rejected.\n```json\n{"verdict":"fail","risk":"medium","confidence":0.78,"summary":"Reset window off-by-one","nextStep":{"action":"continue"}}\n```' });
  s = addMessage(s, { from: 'mentor', to: 'executor', type: 'handoff', content: 'Passing back to executor with feedback' });
  section('TRANSCRIPT — dialogue with verdict + handoff', (
    <Box flexDirection="column">{s.messages.map(m => m.type === 'handoff'
      ? <ConnectorLine key={m.id} label={`handed to ${m.to}`} />
      : <MessageView key={m.id} msg={m} />)}</Box>
  ));
}

// 3b — Greeting smoke-test transcript (HELLO chips from both roles)
{
  let s = { ...base(), status: 'greeting' as const, greetingState: initializeGreetingState() };
  s = addGreetingMessage(s, 'mentor', 'Hello executor — this is a greeting smoke-test. Are you ready?');
  s = addMessage(s, { from: 'mentor', to: 'executor', type: 'greeting', content: 'Hello executor — this is a greeting smoke-test. Are you ready?' });
  s = addGreetingMessage(s, 'executor', 'Hi mentor — ready when you are. No task today, just a hello.');
  s = addMessage(s, { from: 'executor', to: 'mentor', type: 'greeting', content: 'Hi mentor — ready when you are. No task today, just a hello.' });
  section('GREETING — hello exchange', (
    <Box flexDirection="column">{s.messages.map(m => <MessageView key={m.id} msg={m} />)}</Box>
  ));
}

// 4 — Result panels
{
  let s = base();
  s = { ...s, status: 'finished', iteration: 3, finishedAt: s.createdAt + 92_000, modifiedFiles: [{ path: 'src/middleware/rateLimit.ts', status: 'A' }, { path: 'src/server/app.ts', status: 'M' }, { path: 'test/rateLimit.test.ts', status: 'A' }], executor: { ...s.executor, tokenUsage: { outputTokens: 8400 } }, mentor: { ...s.mentor, tokenUsage: { outputTokens: 3100 } } };
  section('RESULT — finished', <ResultPanel state={s} />);
}

// 5 — Setup pickers
section('PICKER — endpoint profile', (
  <Select
    message="Mentor (planner & reviewer) — pick endpoint"
    items={[
      { label: 'GLM', value: 'glm', hint: 'open.bigmodel.cn/api/anthropic' },
      { label: 'DeepSeek', value: 'deepseek', hint: 'api.deepseek.com/anthropic' },
      { label: 'Anthropic', value: 'anthropic', hint: 'official api' },
    ]}
    onSubmit={() => {}}
  />
));

// 5b — Executor endpoint picker with the "Same as Mentor" shortcut
section('PICKER — executor endpoint (Same as Mentor)', (
  <Select
    message="Executor (coder & implementer) — pick endpoint"
    items={[
      { label: 'Same as Mentor', value: 'same', hint: 'GLM / glm-4.6' },
      { label: 'GLM', value: 'glm', hint: 'open.bigmodel.cn/api/anthropic' },
      { label: 'DeepSeek', value: 'deepseek', hint: 'api.deepseek.com/anthropic' },
      { label: 'Anthropic', value: 'anthropic', hint: 'official api' },
      { label: '+ Add an endpoint…', value: 'add', hint: 'base URL + key' },
    ]}
    onSubmit={() => {}}
  />
));

section('PICKER — model (searchable)', (
  <SearchSelect
    message="Mentor / GLM — pick model"
    items={[
      { label: 'GLM 4.6', value: 'glm-4.6', meta: 'flagship' },
      { label: 'GLM 4.5 Air', value: 'glm-4.5-air', meta: 'fast' },
      { label: 'Custom model…', value: '__custom__', meta: 'type an id' },
    ]}
    placeholder="type to filter, or pick Custom"
    onSubmit={() => {}}
  />
));

// 6 — Slash popover (needs a simulated keystroke)
const slashCommands = [
  { name: 'task', description: 'New task' },
  { name: 'mentor', description: 'Re-pick mentor' },
  { name: 'runner', description: 'Re-pick runner' },
  { name: 'model', description: 'Show models' },
];
const slash = render(<SlashInput commands={slashCommands} onSubmit={() => {}} />);
slash.stdin.write('/m');
await new Promise(r => setTimeout(r, 60));
process.stdout.write('\n\x1b[7m  INPUT — slash popover (typed "/m")  \x1b[0m\n\n' + (slash.lastFrame() ?? '') + '\n');

process.stdout.write('\n');
