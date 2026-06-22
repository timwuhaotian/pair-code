import { useState } from 'react';
import type { JSX } from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons } from './ui.js';

// ── Fuzzy match ─────────────────────────────────────────────────────────

export interface FuzzyResult { matched: boolean; score: number }

export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      if (ti === prev + 1) score += 5;
      if (ti === 0) score += 10;
      score += 1;
      prev = ti;
      qi++;
    }
  }
  return { matched: qi === q.length, score };
}

// ── Select ──────────────────────────────────────────────────────────────

export interface SelectItem<T> { label: string; value: T; hint?: string }

export function Select<T>(props: {
  message: string;
  items: SelectItem<T>[];
  initialIndex?: number;
  onSubmit: (value: T) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [index, setIndex] = useState(Math.min(props.initialIndex ?? 0, Math.max(0, props.items.length - 1)));

  useInput((_input, key) => {
    if (key.upArrow) setIndex(i => Math.max(0, i - 1));
    else if (key.downArrow) setIndex(i => Math.min(props.items.length - 1, i + 1));
    else if (key.return) { const item = props.items[index]; if (item) props.onSubmit(item.value); }
    else if (key.escape && props.onCancel) props.onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>? </Text>
        <Text>{props.message}</Text>
      </Text>
      {props.items.map((item, i) => {
        const sel = i === index;
        return (
          <Text key={i}>
            <Text color={colors.mentor}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
            <Text color={sel ? colors.mentor : undefined} bold={sel} dimColor={!sel}>{item.label}</Text>
            {item.hint ? <Text dimColor>  {item.hint}</Text> : null}
          </Text>
        );
      })}
      <Text dimColor>   ↑↓ navigate · ⏎ select{props.onCancel ? ' · esc back' : ''}</Text>
    </Box>
  );
}

// ── SearchSelect ────────────────────────────────────────────────────────

export interface SearchItem<T> { label: string; value: T; meta?: string; keywords?: string }

export function SearchSelect<T>(props: {
  message: string;
  items: SearchItem<T>[];
  placeholder?: string;
  maxVisible?: number;
  onSubmit: (value: T) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const maxVisible = props.maxVisible ?? 8;

  const matches = props.items
    .map(item => {
      if (!query) return { item, score: 0 };
      const hay = `${item.label} ${item.meta ?? ''} ${item.keywords ?? ''}`;
      const m = fuzzyMatch(query, hay);
      return m.matched ? { item, score: m.score } : null;
    })
    .filter((x): x is { item: SearchItem<T>; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  const clampedIndex = Math.min(index, Math.max(0, matches.length - 1));
  const scroll = Math.max(0, Math.min(clampedIndex - Math.floor(maxVisible / 2), Math.max(0, matches.length - maxVisible)));
  const windowed = matches.slice(scroll, scroll + maxVisible);

  useInput((input, key) => {
    if (key.upArrow) setIndex(i => Math.max(0, i - 1));
    else if (key.downArrow) setIndex(i => Math.min(matches.length - 1, i + 1));
    else if (key.return) { if (matches[clampedIndex]) props.onSubmit(matches[clampedIndex].item.value); }
    else if (key.escape) { if (query) { setQuery(''); setIndex(0); } else props.onCancel?.(); }
    else if (key.backspace || key.delete) { setQuery(q => q.slice(0, -1)); setIndex(0); }
    else if (input && !key.ctrl && !key.meta) { setQuery(q => q + input); setIndex(0); }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>? </Text>
        <Text>{props.message}</Text>
      </Text>
      <Text>
        <Text dimColor>{icons.chevron} </Text>
        {query ? <Text color={colors.mentor} bold>{query}</Text> : <Text dimColor>{props.placeholder ?? 'type to filter'}</Text>}
        <Text color={colors.mentor}>▌</Text>
      </Text>
      <Text dimColor>── {matches.length} {matches.length === 1 ? 'match' : 'matches'} ──</Text>
      {windowed.map(({ item }, i) => {
        const absIdx = scroll + i;
        const sel = absIdx === clampedIndex;
        return (
          <Text key={i}>
            <Text color={colors.mentor}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
            <Text color={sel ? colors.mentor : undefined} bold={sel} dimColor={!sel}>{item.label}</Text>
            {item.meta ? <Text dimColor>   {item.meta}</Text> : null}
          </Text>
        );
      })}
      <Text dimColor>   ↑↓ navigate · ⏎ select{query ? ' · ⌫ delete' : ''}{props.onCancel ? ' · esc back' : ''}</Text>
    </Box>
  );
}

// ── Text prompt ─────────────────────────────────────────────────────────

export function TextPrompt(props: {
  message: string;
  placeholder?: string;
  initialValue?: string;
  mask?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [value, setValue] = useState(props.initialValue ?? '');

  useInput((input, key) => {
    if (key.return) { if (value.trim()) props.onSubmit(value.trim()); }
    else if (key.escape && props.onCancel) props.onCancel();
    else if (key.backspace || key.delete) setValue(v => v.slice(0, -1));
    else if (input && !key.ctrl && !key.meta) setValue(v => v + input);
  });

  const shown = props.mask ? '•'.repeat(value.length) : value;
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>{icons.chevron} </Text>
        <Text>{props.message}</Text>
        {props.placeholder && !value ? <Text dimColor>  ({props.placeholder})</Text> : null}
      </Text>
      <Text>
        <Text dimColor>  </Text>
        <Text>{shown}</Text>
        <Text color={colors.mentor}>▌</Text>
      </Text>
    </Box>
  );
}

// ── Slash-command input ─────────────────────────────────────────────────

export interface SlashCommand { name: string; description: string }

export function SlashInput(props: {
  commands: SlashCommand[];
  placeholder?: string;
  onSubmit: (line: string) => void;
}): JSX.Element {
  const [buffer, setBuffer] = useState('');
  const [popIndex, setPopIndex] = useState(0);

  const slashActive = buffer.startsWith('/');
  const q = slashActive ? buffer.slice(1) : '';
  const items = slashActive
    ? props.commands
        .map(c => ({ c, m: fuzzyMatch(q, c.name) }))
        .filter(x => x.m.matched)
        .sort((a, b) => b.m.score - a.m.score)
        .map(x => x.c)
    : [];
  const clampedPop = Math.min(popIndex, Math.max(0, items.length - 1));

  useInput((input, key) => {
    if (slashActive && items.length > 0 && key.upArrow) { setPopIndex(i => Math.max(0, i - 1)); return; }
    if (slashActive && items.length > 0 && key.downArrow) { setPopIndex(i => Math.min(items.length - 1, i + 1)); return; }
    if (key.return) {
      if (slashActive && items.length > 0) { props.onSubmit(`/${items[clampedPop].name}`); setBuffer(''); setPopIndex(0); }
      else if (buffer.trim()) { props.onSubmit(buffer.trim()); setBuffer(''); setPopIndex(0); }
      return;
    }
    if (key.escape) { setBuffer(''); setPopIndex(0); return; }
    if (key.backspace || key.delete) { setBuffer(b => b.slice(0, -1)); setPopIndex(0); return; }
    if (input && !key.ctrl && !key.meta) { setBuffer(b => b + input); setPopIndex(0); }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>{icons.chevron} </Text>
        {buffer
          ? <Text color={slashActive ? colors.accent : undefined}>{buffer}</Text>
          : <Text dimColor>{props.placeholder ?? 'type a task, or / for commands'}</Text>}
        <Text color={colors.mentor}>▌</Text>
      </Text>
      {slashActive ? (
        <Box flexDirection="column" marginTop={0}>
          <Text dimColor>── {items.length ? `${items.length} commands` : 'no match'} ──</Text>
          {items.slice(0, 8).map((c, i) => {
            const sel = i === clampedPop;
            return (
              <Text key={c.name}>
                <Text color={colors.accent}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
                <Text color={sel ? colors.accent : undefined} bold={sel} dimColor={!sel}>/{c.name}</Text>
                <Text dimColor>{' '.repeat(Math.max(2, 14 - c.name.length))}{c.description}</Text>
              </Text>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
