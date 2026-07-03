import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Key } from 'ink';
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

// ── Text input hook ─────────────────────────────────────────────────────

// Result of handleEditKey: 'edit' means the buffer was modified, 'move' means
// only the cursor position changed, false means the key was not recognised.
type EditResult = 'edit' | 'move' | false;

// Encapsulates buffer + cursor state and the common keyboard handlers shared
// by SearchSelect, TextPrompt, and SlashInput: arrow keys, Ctrl+A/E/U/K,
// backspace, delete, and printable character insertion. The `onChange` callback
// fires whenever the buffer is modified so callers can reset dependent state
// (selection index, hint flag, etc.). Buffer and cursor are held in a single
// state object and updated atomically inside functional updaters so the cursor
// always sees the latest buffer — no stale closure values.
function useTextInput(initial: string, onChange?: () => void): {
  buffer: string;
  cursor: number;
  set: (buffer: string, cursor?: number) => void;
  reset: () => void;
  handleEditKey: (input: string, key: Key) => EditResult;
} {
  const [state, setState] = useState<{ buffer: string; cursor: number }>({
    buffer: initial,
    cursor: initial.length,
  });

  const handleEditKey = (input: string, key: Key): EditResult => {
    if (key.leftArrow) {
      setState(s => ({ ...s, cursor: Math.max(0, s.cursor - 1) }));
      return 'move';
    }
    if (key.rightArrow) {
      setState(s => ({ ...s, cursor: Math.min(s.buffer.length, s.cursor + 1) }));
      return 'move';
    }
    if (key.ctrl && input === 'a') {
      setState(s => ({ ...s, cursor: 0 }));
      return 'move';
    }
    if (key.ctrl && input === 'e') {
      setState(s => ({ ...s, cursor: s.buffer.length }));
      return 'move';
    }
    if (key.ctrl && input === 'u') {
      setState(s => ({ buffer: s.buffer.slice(s.cursor), cursor: 0 }));
      onChange?.();
      return 'edit';
    }
    if (key.ctrl && input === 'k') {
      setState(s => ({ buffer: s.buffer.slice(0, s.cursor), cursor: s.cursor }));
      onChange?.();
      return 'edit';
    }
    if (key.backspace) {
      setState(s => {
        const c = Math.max(0, Math.min(s.cursor, s.buffer.length));
        return { buffer: s.buffer.slice(0, Math.max(0, c - 1)) + s.buffer.slice(c), cursor: Math.max(0, c - 1) };
      });
      onChange?.();
      return 'edit';
    }
    if (key.delete) {
      setState(s => {
        const c = Math.max(0, Math.min(s.cursor, s.buffer.length));
        return { buffer: s.buffer.slice(0, c) + s.buffer.slice(c + 1), cursor: c };
      });
      onChange?.();
      return 'edit';
    }
    if (input && !key.ctrl && !key.meta) {
      setState(s => {
        const c = Math.max(0, Math.min(s.cursor, s.buffer.length));
        return { buffer: s.buffer.slice(0, c) + input + s.buffer.slice(c), cursor: c + input.length };
      });
      onChange?.();
      return 'edit';
    }
    return false;
  };

  const set = (buffer: string, cursor?: number) => {
    setState({ buffer, cursor: cursor ?? buffer.length });
  };

  const reset = () => setState({ buffer: '', cursor: 0 });

  const cursor = Math.max(0, Math.min(state.cursor, state.buffer.length));

  return { buffer: state.buffer, cursor, set, reset, handleEditKey };
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
    else if (key.home) setIndex(0);
    else if (key.end) setIndex(Math.max(0, props.items.length - 1));
    else if (key.pageUp) setIndex(i => Math.max(0, i - maxVisible));
    else if (key.pageDown) setIndex(i => Math.min(props.items.length - 1, i + maxVisible));
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
  const [index, setIndex] = useState(0);
  const [hint, setHint] = useState(false);
  const maxVisible = props.maxVisible ?? 8;

  const { buffer: query, cursor: cur, handleEditKey, reset } = useTextInput('', () => {
    setIndex(0);
    setHint(false);
  });

  const matches = useMemo(
    () => props.items
      .map(item => {
        if (!query) return { item, score: 0 };
        const hay = `${item.label} ${item.meta ?? ''} ${item.keywords ?? ''}`;
        const m = fuzzyMatch(query, hay);
        return m.matched ? { item, score: m.score } : null;
      })
      .filter((x): x is { item: SearchItem<T>; score: number } => x !== null)
      .sort((a, b) => b.score - a.score),
    [props.items, query],
  );

  const clampedIndex = Math.min(index, Math.max(0, matches.length - 1));
  const scroll = Math.max(0, Math.min(clampedIndex - Math.floor(maxVisible / 2), Math.max(0, matches.length - maxVisible)));
  const windowed = matches.slice(scroll, scroll + maxVisible);

  useInput((input, key) => {
    if (key.upArrow) { setIndex(i => Math.max(0, i - 1)); setHint(false); return; }
    if (key.downArrow) { setIndex(i => Math.min(matches.length - 1, i + 1)); setHint(false); return; }
    if (key.return) { if (matches[clampedIndex]) props.onSubmit(matches[clampedIndex].item.value); else setHint(true); return; }
    if (key.escape) { if (query) { reset(); setIndex(0); setHint(false); } else props.onCancel?.(); return; }
    handleEditKey(input, key);
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
  const [hint, setHint] = useState(false);
  const { buffer: value, cursor: cur, handleEditKey } = useTextInput(props.initialValue ?? '', () => {
    setHint(false);
  });

  useInput((input, key) => {
    if (key.return) { if (value.trim()) props.onSubmit(value.trim()); else setHint(true); return; }
    if (key.escape && props.onCancel) { props.onCancel(); return; }
    handleEditKey(input, key);
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
  const [popIndex, setPopIndex] = useState(0);
  const [hint, setHint] = useState(false);
  const maxVisible = props.maxVisible ?? 8;

  const { buffer, cursor: cur, set: setBuffer, reset, handleEditKey } = useTextInput('', () => {
    setPopIndex(0);
    setHint(false);
  });

  const isSlash = buffer.startsWith('/');
  const q = isSlash ? buffer.slice(1) : '';
  const items = useMemo(
    () => isSlash
      ? props.commands
          .map(c => ({ c, m: fuzzyMatch(q, c.name) }))
          .filter(x => x.m.matched)
          .sort((a, b) => b.m.score - a.m.score)
          .map(x => x.c)
      : [],
    [props.commands, isSlash, q],
  );

  // Command mode only while the buffer still looks like a command: it currently
  // matches something, or no space has been typed yet. A '/'-prefixed line that
  // stops matching once args are added falls back to being a plain task.
  const slashActive = isSlash && (items.length > 0 || !q.includes(' '));
  const clampedPop = Math.min(popIndex, Math.max(0, items.length - 1));
  const scroll = Math.max(0, Math.min(clampedPop - Math.floor(maxVisible / 2), Math.max(0, items.length - maxVisible)));
  const windowed = items.slice(scroll, scroll + maxVisible);

  useInput((input, key) => {
    if (slashActive && items.length > 0 && key.upArrow) { setPopIndex(i => Math.max(0, i - 1)); setHint(false); return; }
    if (slashActive && items.length > 0 && key.downArrow) { setPopIndex(i => Math.min(items.length - 1, i + 1)); setHint(false); return; }
    if (key.return) {
      if (slashActive && items.length > 0) { props.onSubmit(`/${items[clampedPop].name}`); reset(); setPopIndex(0); setHint(false); }
      else if (slashActive && buffer.trim()) { setHint(true); }
      else if (buffer.trim()) { props.onSubmit(buffer.trim()); reset(); setPopIndex(0); setHint(false); }
      else { setHint(true); }
      return;
    }
    if (slashActive && items.length > 0 && key.tab) {
      const completed = `/${items[clampedPop].name} `;
      setBuffer(completed, completed.length); setPopIndex(0); setHint(false);
      return;
    }
    if (key.escape) { reset(); setPopIndex(0); setHint(false); return; }
    handleEditKey(input, key);
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
      {hint && slashActive ? <Text dimColor>  command not found — type a task to continue</Text> : null}
    </Box>
  );
}
