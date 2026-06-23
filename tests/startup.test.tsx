import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from 'ink-testing-library';
import { App } from '../src/app.js';

const waitForRender = () => new Promise(resolve => setTimeout(resolve, 25));

async function withIsolatedConfig<T>(fn: () => Promise<T> | T): Promise<T> {
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const dir = mkdtempSync(join(tmpdir(), 'pair-code-test-'));
  process.env.XDG_CONFIG_HOME = dir;
  try {
    return await fn();
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('help presents the short pair command as primary usage', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts', '--help'],
    { cwd: process.cwd(), encoding: 'utf-8' },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /pair v\d+\.\d+\.\d+/);
  assert.match(result.stdout, /Usage:\n\s+pair \[directory\] \[task description\]/);
  assert.doesNotMatch(result.stdout, /pair-code \[directory\]/);
});

test('startup accepts slash commands before endpoints are configured', async () => {
  await withIsolatedConfig(async () => {
    const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    let instance: ReturnType<typeof render> | null = null;
    try {
      instance = render(createElement(App, { directory: process.cwd(), initialSpec: '' }));

      instance.stdin.write('/');
      await waitForRender();

      const frame = instance.lastFrame() ?? '';
      assert.match(frame, /\/mentor/);
      assert.match(frame, /\/executor/);
      assert.match(frame, /commands/);
    } finally {
      if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
      instance?.unmount();
    }
  });
});

test('startup slash executor command can change an already configured endpoint', async () => {
  await withIsolatedConfig(async () => {
    process.env.PAIR_PROFILE_TEST_BASE_URL = 'https://api.example.com/anthropic';
    process.env.PAIR_PROFILE_TEST_KEY = 'test-key';
    process.env.PAIR_PROFILE_TEST_MODEL = 'test-model';
    let instance: ReturnType<typeof render> | null = null;
    try {
      instance = render(createElement(App, { directory: process.cwd(), initialSpec: '' }));

      instance.stdin.write('/executor');
      await waitForRender();
      instance.stdin.write('\r');
      await waitForRender();

      const frame = instance.lastFrame() ?? '';
      assert.match(frame, /Executor .*pick endpoint/);
      assert.match(frame, /Test/);
      assert.match(frame, /\+ Add an endpoint/);
    } finally {
      delete process.env.PAIR_PROFILE_TEST_BASE_URL;
      delete process.env.PAIR_PROFILE_TEST_KEY;
      delete process.env.PAIR_PROFILE_TEST_MODEL;
      instance?.unmount();
    }
  });
});
