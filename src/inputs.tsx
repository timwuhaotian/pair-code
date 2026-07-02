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

// ── Cursor editing ──────────────────────────────────────────────────────

// Renders `text` with a block cursor at `cursor` (0..text.length). The glyph
// sits over the character it precedes; at end-of-text it trails the value.
function withCursor(text: string, cursor: number, color: string): JSX.Element {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const under = text.slice(at, at + 1);
  const after = text.slice(at + 1);
  return (
    <>
      {before ? <Text>{before}</Text> : null}
      {under
        ? <Text color={color} inverse>{under}</Text>
        : <Text color={color}>{icons.caret}</Text>}
      {after ? <Text>{after}</Text> : null}
    </>
  );
}

// ── Select ──────────────────────────────────────────────────────────────

export interface SelectItem<T> { label: string; value: T; hint?: string }

export function Select<T>(props: {
  message: string;
  items: SelectItem<T>[];
  initialIndex?: number;
  maxVisible?: number;
  onSubmit: (value: T) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [index, setIndex] = useState(Math.min(props.initialIndex ?? 0, Math.max(0, props.items.length - 1)));
  const maxVisible = props.maxVisible ?? 8;

  const clampedIndex = Math.min(index, Math.max(0, props.items.length - 1));
  const scroll = Math.max(0, Math.min(clampedIndex - Math.floor(maxVisible / 2), Math.max(0, props.items.length - maxVisible)));
  const windowed = props.items.slice(scroll, scroll + maxVisible);

  useInput((_input, key) => {
    if (key.upArrow) setIndex(i => Math.max(0, i - 1));
    else if (key.downArrow) setIndex(i => Math.min(props.items.length - 1, i + 1));
    else if (key.return) { const item = props.items[clampedIndex]; if (item) props.onSubmit(item.value); }
    else if (key.escape && props.onCancel) props.onCancel();
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>? </Text>
        <Text>{props.message}</Text>
      </Text>
      {windowed.map((item, i) => {
        const absIdx = scroll + i;
        const sel = absIdx === clampedIndex;
        return (
          <Text key={absIdx}>
            <Text color={colors.mentor}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
            <Text color={sel ? colors.mentor : undefined} bold={sel} dimColor={!sel}>{item.label}</Text>
            {item.hint ? <Text dimColor>  {item.hint}</Text> : null}
          </Text>
        );
      })}
      {props.items.length > windowed.length ? (
        <Text dimColor>   +{props.items.length - windowed.length} more</Text>
      ) : null}
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
  const [cursor, setCursor] = useState(0);
  const [index, setIndex] = useState(0);
  const [hint, setHint] = useState(false);
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
  const cur = Math.max(0, Math.min(cursor, query.length));

  useInput((input, key) => {
    if (key.upArrow) { setIndex(i => Math.max(0, i - 1)); setHint(false); }
    else if (key.downArrow) { setIndex(i => Math.min(matches.length - 1, i + 1)); setHint(false); }
    else if (key.leftArrow) setCursor(c => Math.max(0, Math.min(c, query.length) - 1));
    else if (key.rightArrow) setCursor(c => Math.min(query.length, c + 1));
    else if (key.ctrl && input === 'a') setCursor(0);
    else if (key.ctrl && input === 'e') setCursor(query.length);
    else if (key.return) { if (matches[clampedIndex]) props.onSubmit(matches[clampedIndex].item.value); else setHint(true); }
    else if (key.escape) { if (query) { setQuery(''); setCursor(0); setIndex(0); setHint(false); } else props.onCancel?.(); }
    else if (key.backspace) { setQuery(q => { const c = Math.min(cur, q.length); return q.slice(0, Math.max(0, c - 1)) + q.slice(c); }); setCursor(c => Math.max(0, Math.min(c, query.length) - 1)); setIndex(0); setHint(false); }
    else if (key.delete) { setQuery(q => { const c = Math.min(cur, q.length); return q.slice(0, c) + q.slice(c + 1); }); setIndex(0); setHint(false); }
    else if (input && !key.ctrl && !key.meta) { setQuery(q => { const c = Math.min(cur, q.length); return q.slice(0, c) + input + q.slice(c); }); setCursor(c => Math.min(query.length, c) + input.length); setIndex(0); setHint(false); }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>? </Text>
        <Text>{props.message}</Text>
      </Text>
      <Text>
        <Text dimColor>{icons.chevron} </Text>
        {query
          ? <Text color={colors.mentor} bold>{withCursor(query, cur, colors.mentor)}</Text>
          : <><Text dimColor>{props.placeholder ?? 'type to filter'}</Text><Text color={colors.mentor}>{icons.caret}</Text></>}
      </Text>
      <Text dimColor>── {matches.length} {matches.length === 1 ? 'match' : 'matches'} ──</Text>
      {windowed.map(({ item }, i) => {
        const absIdx = scroll + i;
        const sel = absIdx === clampedIndex;
        return (
          <Text key={absIdx}>
            <Text color={colors.mentor}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
            <Text color={sel ? colors.mentor : undefined} bold={sel} dimColor={!sel}>{item.label}</Text>
            {item.meta ? <Text dimColor>   {item.meta}</Text> : null}
          </Text>
        );
      })}
      {matches.length > windowed.length ? (
        <Text dimColor>   +{matches.length - windowed.length} more</Text>
      ) : null}
      {hint ? <Text dimColor>   {query ? 'no matching option' : 'type to filter'}</Text> : null}
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
  const [cursor, setCursor] = useState((props.initialValue ?? '').length);
  const [hint, setHint] = useState(false);
  const cur = Math.max(0, Math.min(cursor, value.length));

  useInput((input, key) => {
    if (key.return) { if (value.trim()) props.onSubmit(value.trim()); else setHint(true); }
    else if (key.escape && props.onCancel) props.onCancel();
    else if (key.leftArrow) setCursor(c => Math.max(0, Math.min(c, value.length) - 1));
    else if (key.rightArrow) setCursor(c => Math.min(value.length, c + 1));
    else if (key.ctrl && input === 'a') setCursor(0);
    else if (key.ctrl && input === 'e') setCursor(value.length);
    else if (key.backspace) { setValue(v => { const c = Math.min(cur, v.length); return v.slice(0, Math.max(0, c - 1)) + v.slice(c); }); setCursor(c => Math.max(0, Math.min(c, value.length) - 1)); setHint(false); }
    else if (key.delete) { setValue(v => { const c = Math.min(cur, v.length); return v.slice(0, c) + v.slice(c + 1); }); setHint(false); }
    else if (input && !key.ctrl && !key.meta) { setValue(v => { const c = Math.min(cur, v.length); return v.slice(0, c) + input + v.slice(c); }); setCursor(c => Math.min(value.length, c) + input.length); setHint(false); }
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
        {withCursor(shown, cur, colors.mentor)}
      </Text>
      {hint ? <Text dimColor>  enter a value to continue</Text> : null}
    </Box>
  );
}

// ── Slash-command input ─────────────────────────────────────────────────

export interface SlashCommand { name: string; description: string }

export function SlashInput(props: {
  commands: SlashCommand[];
  placeholder?: string;
  maxVisible?: number;
  onSubmit: (line: string) => void;
}): JSX.Element {
  const [buffer, setBuffer] = useState('');
  const [cursor, setCursor] = useState(0);
  const [popIndex, setPopIndex] = useState(0);
  const [hint, setHint] = useState(false);
  const maxVisible = props.maxVisible ?? 8;

  const isSlash = buffer.startsWith('/');
  const q = isSlash ? buffer.slice(1) : '';
  const items = isSlash
    ? props.commands
        .map(c => ({ c, m: fuzzyMatch(q, c.name) }))
        .filter(x => x.m.matched)
        .sort((a, b) => b.m.score - a.m.score)
        .map(x => x.c)
    : [];
  // Command mode only while the buffer still looks like a command: it currently
  // matches something, or no space has been typed yet. A '/'-prefixed line that
  // stops matching once args are added falls back to being a plain task.
  const slashActive = isSlash && (items.length > 0 || !q.includes(' '));
  const clampedPop = Math.min(popIndex, Math.max(0, items.length - 1));
  const scroll = Math.max(0, Math.min(clampedPop - Math.floor(maxVisible / 2), Math.max(0, items.length - maxVisible)));
  const windowed = items.slice(scroll, scroll + maxVisible);
  const cur = Math.max(0, Math.min(cursor, buffer.length));

  useInput((input, key) => {
    if (slashActive && items.length > 0 && key.upArrow) { setPopIndex(i => Math.max(0, i - 1)); setHint(false); return; }
    if (slashActive && items.length > 0 && key.downArrow) { setPopIndex(i => Math.min(items.length - 1, i + 1)); setHint(false); return; }
    if (key.leftArrow) { setCursor(c => Math.max(0, Math.min(c, buffer.length) - 1)); return; }
    if (key.rightArrow) { setCursor(c => Math.min(buffer.length, c + 1)); return; }
    if (key.ctrl && input === 'a') { setCursor(0); return; }
    if (key.ctrl && input === 'e') { setCursor(buffer.length); return; }
    if (key.return) {
      if (slashActive && items.length > 0) { props.onSubmit(`/${items[clampedPop].name}`); setBuffer(''); setCursor(0); setPopIndex(0); setHint(false); }
      else if (slashActive && buffer.trim()) { setHint(true); }
      else if (buffer.trim()) { props.onSubmit(buffer.trim()); setBuffer(''); setCursor(0); setPopIndex(0); setHint(false); }
      else { setHint(true); }
      return;
    }
    if (slashActive && items.length > 0 && key.tab) {
      const completed = `/${items[clampedPop].name}`;
      setBuffer(completed); setCursor(completed.length); setPopIndex(0); setHint(false);
      return;
    }
    if (key.escape) { setBuffer(''); setCursor(0); setPopIndex(0); setHint(false); return; }
    if (key.backspace) { setBuffer(b => { const c = Math.min(cur, b.length); return b.slice(0, Math.max(0, c - 1)) + b.slice(c); }); setCursor(c => Math.max(0, Math.min(c, buffer.length) - 1)); setPopIndex(0); setHint(false); return; }
    if (key.delete) { setBuffer(b => { const c = Math.min(cur, b.length); return b.slice(0, c) + b.slice(c + 1); }); setPopIndex(0); setHint(false); return; }
    if (input && !key.ctrl && !key.meta) { setBuffer(b => { const c = Math.min(cur, b.length); return b.slice(0, c) + input + b.slice(c); }); setCursor(c => Math.min(buffer.length, c) + input.length); setPopIndex(0); setHint(false); }
  });

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={colors.accent} bold>{icons.chevron} </Text>
        {buffer
          ? <Text color={slashActive ? colors.accent : undefined}>{withCursor(buffer, cur, colors.mentor)}</Text>
          : <><Text dimColor>{props.placeholder ?? 'type a task, or / for commands'}</Text><Text color={colors.mentor}>{icons.caret}</Text></>}
      </Text>
      {slashActive ? (
        <Box flexDirection="column" marginTop={0}>
          <Text dimColor>── {items.length ? `${items.length} commands` : 'no matching command'} ──</Text>
          {windowed.map((c, i) => {
            const absIdx = scroll + i;
            const sel = absIdx === clampedPop;
            return (
              <Text key={absIdx}>
                <Text color={colors.accent}>{sel ? ` ${icons.pointer} ` : '   '}</Text>
                <Text color={sel ? colors.accent : undefined} bold={sel} dimColor={!sel}>/{c.name}</Text>
                <Text dimColor>{' '.repeat(Math.max(2, 14 - c.name.length))}{c.description}</Text>
              </Text>
            );
          })}
          {items.length > windowed.length ? (
            <Text dimColor>   +{items.length - windowed.length} more</Text>
          ) : null}
        </Box>
      ) : null}
      {hint && !slashActive ? <Text dimColor>  enter a task to continue</Text> : null}
    </Box>
  );
}
