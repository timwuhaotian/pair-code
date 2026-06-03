import chalk from 'chalk';
import { createInterface } from 'node:readline';

const ESC = '\x1B';
const CSI = '\x1B[';

const keys = {
  up: `${CSI}A`,
  down: `${CSI}B`,
  enter: '\r',
  escape: ESC,
  ctrlC: '\x03',
  backspace: '\x7F',
};

// ── Fuzzy match ──────────────────────────────────────────────────────────

interface FuzzyResult {
  matched: boolean;
  score: number;
  indices: Set<number>;
}

function fuzzyMatch(query: string, target: string): FuzzyResult {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices = new Set<number>();
  let qi = 0;
  let score = 0;
  let prevMatchIdx = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.add(ti);
      // Consecutive match bonus
      if (ti === prevMatchIdx + 1) score += 5;
      // Start-of-string bonus
      if (ti === 0) score += 10;
      score += 1;
      prevMatchIdx = ti;
      qi++;
    }
  }

  return { matched: qi === q.length, score, indices };
}

function fuzzyFilter(commands: SlashCommand[], query: string): (SlashCommand & { matchIndices: Set<number> })[] {
  const q = query.toLowerCase();
  if (!q) return commands.map(c => ({ ...c, matchIndices: new Set<number>() }));

  const results: (SlashCommand & { matchIndices: Set<number>; _score: number })[] = [];
  for (const cmd of commands) {
    const r = fuzzyMatch(q, cmd.name);
    if (r.matched) {
      results.push({ ...cmd, matchIndices: r.indices, _score: r.score });
    }
  }
  results.sort((a, b) => b._score - a._score);
  return results;
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
  hint?: string;
}

// Sentinel returned by select() when the user cancels (Esc) and
// `allowCancel` is true. Callers should check identity with === CANCEL.
export const CANCEL: unique symbol = Symbol('select.cancel');

export interface SelectOptions {
  defaultIndex?: number;
  /** When true, Esc resolves with CANCEL instead of exiting the process. */
  allowCancel?: boolean;
}

export async function select<T = string>(
  message: string,
  options: SelectOption<T>[],
  opts?: SelectOptions,
): Promise<T | typeof CANCEL> {
  const defaultIdx = opts?.defaultIndex ?? 0;
  const allowCancel = !!opts?.allowCancel;
  let selected = defaultIdx;
  let active = true;

  const rawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const write = (s: string) => process.stdout.write(s);
  const hideCursor = () => write(`${CSI}?25l`);
  const showCursor = () => write(`${CSI}?25h`);
  const moveUp = (n: number) => write(`${CSI}${n}A`);
  const clearDown = (n: number) => write(`${CSI}${n}J`);

  // Total lines rendered = 1 header + N options + 1 hint = N + 2.
  const totalRows = options.length + 2;

  const renderFrame = () => {
    write(`  ${chalk.bold('?')} ${chalk.white(message)}\n`);
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === selected;
      const icon = isSelected ? chalk.cyan('❯') : ' ';
      const label = isSelected ? chalk.cyan.bold(opt.label) : chalk.dim(opt.label);
      const hint = opt.hint ? ` ${chalk.dim(opt.hint)}` : '';
      write(`  ${icon} ${label}${hint}\n`);
    }
    const navHint = `${chalk.dim('↑↓')} navigate  ${chalk.dim('⏎')} select`;
    const cancelHint = allowCancel ? `  ${chalk.dim('esc')} back` : '';
    write(`  ${chalk.dim(navHint + cancelHint)}\n`);
  };

  const eraseFrame = () => {
    moveUp(totalRows);
    clearDown(0);
  };

  hideCursor();
  renderFrame();

  return new Promise<T | typeof CANCEL>((resolve, _reject) => {
    const onData = (data: string) => {
      if (!active) return;

      if (data === keys.ctrlC) {
        active = false;
        process.stdin.off('data', onData);
        process.stdin.setRawMode(rawMode ?? false);
        showCursor();
        write('\n');
        process.exit(130);
        return;
      }

      if (data === keys.escape) {
        if (!allowCancel) {
          // Without allowCancel, swallow Esc as a no-op rather than exit.
          return;
        }
        active = false;
        process.stdin.off('data', onData);
        process.stdin.setRawMode(rawMode ?? false);
        showCursor();
        eraseFrame();
        write(`  ${chalk.dim('← back')}\n`);
        resolve(CANCEL);
        return;
      }

      if (data === keys.up || data === 'k') {
        if (selected > 0) {
          selected--;
          eraseFrame();
          renderFrame();
        }
        return;
      }

      if (data === keys.down || data === 'j') {
        if (selected < options.length - 1) {
          selected++;
          eraseFrame();
          renderFrame();
        }
        return;
      }

      if (data === keys.enter) {
        active = false;
        process.stdin.off('data', onData);
        process.stdin.setRawMode(rawMode ?? false);

        const chosen = options[selected];
        eraseFrame();
        write(`  ${chalk.green('✔')} ${chalk.white(message)} ${chalk.cyan(chosen.label)}\n`);
        showCursor();
        resolve(chosen.value);
        return;
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function confirm(message: string, defaultValue: boolean = true): Promise<boolean> {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  return new Promise<boolean>((resolve) => {
    const rl = readline();
    process.stdout.write(`  ${chalk.bold('?')} ${chalk.white(message)} ${chalk.dim(`[${hint}]`)} `);

    const onLine = (line: string) => {
      rl.off('line', onLine);
      rl.close();
      const answer = line.trim().toLowerCase();
      if (answer === '') resolve(defaultValue);
      else if (answer === 'y' || answer === 'yes') resolve(true);
      else resolve(false);
    };
    rl.on('line', onLine);
  });
}

export async function input(message: string, placeholder?: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const rl = readline();
    const ph = placeholder ? ` ${chalk.dim(`(${placeholder})`)}` : '';
    process.stdout.write(`  ${chalk.bold('>')} ${chalk.white(message)}${ph}\n  `);

    const onLine = (line: string) => {
      rl.off('line', onLine);
      rl.close();
      resolve(line.trim());
    };
    rl.on('line', onLine);
  });
}

// ── Search-filter select ────────────────────────────────────────────────

export interface SearchSelectOption<T = string> {
  /** Primary display text. Fuzzy-matched with character highlights. */
  label: string;
  /** Value returned on selection. */
  value: T;
  /** Right-aligned secondary columns (e.g. `['anthropic', 'standard']`). */
  meta?: string[];
  /** Additional text included in fuzzy search (not displayed). */
  searchExtra?: string;
}

export interface SearchSelectOpts {
  defaultIndex?: number;
  allowCancel?: boolean;
  maxVisible?: number;
  placeholder?: string;
}

interface MatchedOption<T> extends SearchSelectOption<T> {
  _score: number;
  _indices: Set<number>;
}

function matchSearchOption<T>(opt: SearchSelectOption<T>, q: string): { score: number; indices: Set<number> } | null {
  if (!q) return { score: 0, indices: new Set<number>() };
  const labelMatch = fuzzyMatch(q, opt.label);
  if (labelMatch.matched) {
    return { score: labelMatch.score + 1000, indices: labelMatch.indices };
  }
  const haystack = [opt.label, ...(opt.meta ?? []), opt.searchExtra ?? ''].join(' ');
  const fallback = fuzzyMatch(q, haystack);
  if (fallback.matched) {
    return { score: fallback.score, indices: new Set<number>() };
  }
  return null;
}

export async function searchSelect<T>(
  message: string,
  options: SearchSelectOption<T>[],
  opts?: SearchSelectOpts,
): Promise<T | typeof CANCEL> {
  const allowCancel = !!opts?.allowCancel;
  const maxVisible = Math.max(3, opts?.maxVisible ?? 8);
  const placeholder = opts?.placeholder ?? 'type to filter';

  let query = '';
  let selected = Math.min(opts?.defaultIndex ?? 0, Math.max(0, options.length - 1));
  let scroll = 0;
  let active = true;
  let lastFrameLines = 0;

  const rawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const write = (s: string) => process.stdout.write(s);
  const hideCursor = () => write(`${CSI}?25l`);
  const showCursor = () => write(`${CSI}?25h`);
  const moveUp = (n: number) => { if (n > 0) write(`${CSI}${n}A`); };

  const filter = (): MatchedOption<T>[] => {
    const results: MatchedOption<T>[] = [];
    for (const o of options) {
      const m = matchSearchOption(o, query);
      if (m) results.push({ ...o, _score: m.score, _indices: m.indices });
    }
    if (query) results.sort((a, b) => b._score - a._score);
    return results;
  };

  // Compute column widths so right-aligned meta lines up across rows.
  const metaColumnWidth = (visible: MatchedOption<T>[], colIdx: number): number => {
    let max = 0;
    for (const v of visible) {
      const cell = v.meta?.[colIdx];
      if (cell) max = Math.max(max, cell.length);
    }
    return max;
  };

  const renderFrame = (): number => {
    const visible = filter();
    selected = Math.min(selected, Math.max(0, visible.length - 1));
    if (visible.length === 0) selected = 0;

    if (selected < scroll) scroll = selected;
    if (selected >= scroll + maxVisible) scroll = selected - maxVisible + 1;
    scroll = Math.max(0, Math.min(scroll, Math.max(0, visible.length - maxVisible)));

    let lines = 0;

    write(`  ${chalk.bold('?')} ${chalk.white(message)}\n`);
    lines++;

    const cursorMark = chalk.cyan('▌');
    const queryDisplay = query
      ? chalk.cyan.bold(query) + cursorMark
      : chalk.dim(placeholder) + ' ' + cursorMark;
    write(`  ${chalk.dim('▸')} ${queryDisplay}\n`);
    lines++;

    let summary: string;
    if (query) {
      summary = visible.length === 0
        ? chalk.dim(`── no matches for "${query}" ──`)
        : visible.length === 1
          ? chalk.dim('── 1 match ──')
          : chalk.dim(`── ${visible.length} matches ──`);
    } else {
      summary = chalk.dim(`── ${options.length} options ──`);
    }
    write(`  ${summary}\n`);
    lines++;

    const windowed = visible.slice(scroll, scroll + maxVisible);
    const numMetaCols = Math.max(0, ...windowed.map(v => v.meta?.length ?? 0));
    const metaWidths = Array.from({ length: numMetaCols }, (_, i) => metaColumnWidth(windowed, i));
    const labelWidth = Math.min(40, Math.max(0, ...windowed.map(v => v.label.length)));

    for (let i = 0; i < windowed.length; i++) {
      const opt = windowed[i];
      const absIdx = scroll + i;
      const isSel = absIdx === selected;
      const icon = isSel ? chalk.cyan('❯') : ' ';

      let label = '';
      for (let ci = 0; ci < opt.label.length; ci++) {
        const ch = opt.label[ci];
        const isMatched = opt._indices.has(ci);
        if (isMatched) {
          label += isSel ? chalk.cyan.bold.underline(ch) : chalk.cyan(ch);
        } else {
          label += isSel ? chalk.white.bold(ch) : chalk.dim(ch);
        }
      }
      const labelPad = ' '.repeat(Math.max(0, labelWidth - opt.label.length));

      const metaParts = (opt.meta ?? []).map((cell, ci) => {
        const padded = cell.padEnd(metaWidths[ci] ?? cell.length);
        return isSel ? chalk.white(padded) : chalk.dim(padded);
      });
      const metaStr = metaParts.length > 0 ? '   ' + metaParts.join('  ') : '';

      write(`  ${icon} ${label}${labelPad}${metaStr}\n`);
      lines++;
    }

    // Filler so the frame height is stable across re-renders.
    for (let i = windowed.length; i < Math.min(maxVisible, Math.max(1, options.length)); i++) {
      write('\n');
      lines++;
    }

    if (visible.length > maxVisible) {
      const start = scroll + 1;
      const end = Math.min(scroll + maxVisible, visible.length);
      const upArrow = scroll > 0 ? chalk.cyan('↑') : chalk.dim('·');
      const downArrow = end < visible.length ? chalk.cyan('↓') : chalk.dim('·');
      write(`    ${upArrow} ${downArrow}  ${chalk.dim(`${start}–${end} of ${visible.length}`)}\n`);
      lines++;
    }

    const hints = [`${chalk.dim('↑↓')} navigate`, `${chalk.dim('⏎')} select`];
    if (query) hints.push(`${chalk.dim('⌫')} delete`);
    if (allowCancel) hints.push(`${chalk.dim('esc')} back`);
    write(`  ${chalk.dim(hints.join('  '))}\n`);
    lines++;

    return lines;
  };

  const eraseFrame = () => {
    if (lastFrameLines > 0) {
      moveUp(lastFrameLines);
      write(`${CSI}0J`);
      lastFrameLines = 0;
    }
  };

  const redraw = () => {
    eraseFrame();
    lastFrameLines = renderFrame();
  };

  hideCursor();
  lastFrameLines = renderFrame();

  return new Promise<T | typeof CANCEL>((resolve) => {
    const cleanup = () => {
      active = false;
      process.stdin.off('data', onData);
      process.stdin.setRawMode(rawMode ?? false);
      showCursor();
    };

    const onData = (data: string) => {
      if (!active) return;
      const visible = filter();

      if (data === keys.ctrlC) {
        cleanup();
        write('\n');
        process.exit(130);
        return;
      }

      if (data === keys.escape) {
        if (!allowCancel) {
          if (query) {
            query = '';
            selected = 0;
            scroll = 0;
            redraw();
          }
          return;
        }
        cleanup();
        eraseFrame();
        write(`  ${chalk.dim('← back')}\n`);
        resolve(CANCEL);
        return;
      }

      if (data === keys.up) {
        if (selected > 0) {
          selected--;
          redraw();
        }
        return;
      }

      if (data === keys.down) {
        if (selected < visible.length - 1) {
          selected++;
          redraw();
        }
        return;
      }

      if (data === keys.enter) {
        if (visible.length === 0) return;
        const chosen = visible[selected];
        cleanup();
        eraseFrame();
        write(`  ${chalk.green('✔')} ${chalk.white(message)} ${chalk.cyan(chosen.label)}\n`);
        resolve(chosen.value);
        return;
      }

      if (data === keys.backspace || data === '\b') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          selected = 0;
          scroll = 0;
          redraw();
        }
        return;
      }

      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        query += data;
        selected = 0;
        scroll = 0;
        redraw();
        return;
      }
    };

    process.stdin.on('data', onData);
  });
}

export interface SlashCommand {
  name: string;
  label: string;
  description: string;
  hidden?: boolean;
}

export function readLineWithSlashComplete(
  commands: SlashCommand[],
  onSubmit: (line: string) => void,
): { destroy: () => void } {
  const rawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  let buffer = '';
  let slashActive = false;
  let slashIdx = 0;
  let destroyed = false;
  let popoverLines = 0;

  const write = (s: string) => process.stdout.write(s);
  const hideCursor = () => write(`${CSI}?25l`);
  const showCursor = () => write(`${CSI}?25h`);
  const moveUp = (n: number) => { if (n > 0) write(`${CSI}${n}A`); };

  const visibleCommands = commands.filter(c => !c.hidden);

  const filtered = (): (SlashCommand & { matchIndices: Set<number> })[] => {
    const q = buffer.startsWith('/') ? buffer.slice(1) : '';
    return fuzzyFilter(visibleCommands, q);
  };

  const writePrompt = () => {
    const display = slashActive ? chalk.cyan(buffer) : buffer;
    write(`  ${chalk.bold('>')} ${display}`);
  };

  const renderPopover = () => {
    const items = filtered();
    let lines = 0;
    const q = buffer.startsWith('/') ? buffer.slice(1) : '';

    write('\n');
    lines++;

    // Dynamic header
    if (q) {
      const count = items.length;
      const label = count === 0 ? chalk.dim(`── No matches for "${q}" ──`)
        : count === 1 ? chalk.dim(`── 1 match ──`)
        : chalk.dim(`── ${count} matches ──`);
      write(`  ${label}\n`);
    } else {
      write(`  ${chalk.dim('── Commands ──')}\n`);
    }
    lines++;

    // Command list
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const sel = i === slashIdx;
      const icon = sel ? chalk.cyan('❯') : ' ';

      // Highlight matched characters
      let nameStr: string;
      if (q && item.matchIndices.size > 0) {
        nameStr = '/';
        for (let ci = 0; ci < item.name.length; ci++) {
          const ch = item.name[ci];
          if (item.matchIndices.has(ci)) {
            nameStr += sel ? chalk.cyan.bold.underline(ch) : chalk.cyan(ch);
          } else {
            nameStr += sel ? chalk.bold(ch) : chalk.dim(ch);
          }
        }
      } else {
        nameStr = sel ? chalk.cyan.bold(`/${item.name}`) : chalk.dim(`/${item.name}`);
      }

      const desc = sel ? chalk.white(item.description) : chalk.dim(item.description);
      const pad = ' '.repeat(Math.max(1, 18 - item.name.length));
      write(`  ${icon} ${nameStr}${pad}${desc}\n`);
      lines++;
    }

    // Keyboard hints
    if (items.length > 0) {
      write(`  ${chalk.dim('↑↓')} navigate  ${chalk.dim('⏎')} select  ${chalk.dim('⎵')} accept  ${chalk.dim('esc')} cancel\n`);
      lines++;
    } else {
      write(`  ${chalk.dim('esc')} cancel\n`);
      lines++;
    }

    return lines;
  };

  const erasePopover = () => {
    if (popoverLines > 0) {
      moveUp(popoverLines);
      write(`${CSI}0J`);
      popoverLines = 0;
    }
  };

  const redrawPrompt = () => {
    write('\r');
    write(`${CSI}2K`);
    writePrompt();
  };

  const redrawPopover = () => {
    erasePopover();
    redrawPrompt();
    slashIdx = Math.min(slashIdx, Math.max(0, filtered().length - 1));
    popoverLines = renderPopover();
  };

  const exitSlash = () => {
    slashActive = false;
    erasePopover();
    redrawPrompt();
    showCursor();
  };

  const cleanup = () => {
    destroyed = true;
    process.stdin.off('data', onData);
    process.stdin.setRawMode(rawMode ?? false);
    showCursor();
  };

  const confirm = (cmd: SlashCommand) => {
    erasePopover();
    write('\r');
    write(`${CSI}2K`);
    write(`  ${chalk.green('✔')} ${chalk.cyan(`/${cmd.name}`)}\n`);
    cleanup();
    buffer = '';
    onSubmit(`/${cmd.name}`);
  };

  const submitLine = (line: string) => {
    cleanup();
    write('\n');
    buffer = '';
    onSubmit(line);
  };

  const onData = (data: string) => {
    if (destroyed) return;

    if (data === '\x03') {
      cleanup();
      write('\n');
      process.exit(130);
      return;
    }

    if (slashActive) {
      const items = filtered();
      if (data === `${CSI}A` || data === 'k') {
        if (slashIdx > 0) slashIdx--;
        redrawPopover();
        return;
      }
      if (data === `${CSI}B` || data === 'j') {
        if (slashIdx < items.length - 1) slashIdx++;
        redrawPopover();
        return;
      }
      if (data === '\r' || data === '\n') {
        if (items.length > 0 && slashIdx < items.length) {
          confirm(items[slashIdx]);
        }
        return;
      }
      if (data === ESC) {
        exitSlash();
        return;
      }
      if (data === '\x7F' || data === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          const newItems = filtered();
          slashIdx = Math.min(slashIdx, Math.max(0, newItems.length - 1));
          if (!buffer.startsWith('/')) {
            exitSlash();
          } else {
            redrawPopover();
          }
        }
        return;
      }
      if (data === ' ') {
        if (items.length > 0 && slashIdx < items.length) {
          buffer = `/${items[slashIdx].name}`;
        }
        redrawPopover();
        return;
      }
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        buffer += data;
        const newItems = filtered();
        slashIdx = Math.min(slashIdx, Math.max(0, newItems.length - 1));
        redrawPopover();
        return;
      }
      return;
    }

    // Normal mode
    if (data === '/' && buffer.length === 0) {
      buffer = '/';
      slashActive = true;
      slashIdx = 0;
      hideCursor();
      redrawPrompt();
      popoverLines = renderPopover();
      return;
    }

    if (data === '\r' || data === '\n') {
      const line = buffer;
      submitLine(line);
      return;
    }

    if (data === '\x7F' || data === '\b') {
      if (buffer.length > 0) {
        buffer = buffer.slice(0, -1);
        redrawPrompt();
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      buffer += data;
      redrawPrompt();
    }
  };

  process.stdin.on('data', onData);
  write(`  ${chalk.bold('>')} `);
  showCursor();

  return {
    destroy: cleanup,
  };
}

export function inputWithSlashComplete(
  message: string,
  commands: SlashCommand[],
  onCommand: (cmd: string) => void | Promise<void>,
  placeholder?: string,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const rawMode = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    let buffer = '';
    let slashActive = false;
    let slashIdx = 0;
    let destroyed = false;
    let popoverLines = 0;

    const write = (s: string) => process.stdout.write(s);
    const hideCursor = () => write(`${CSI}?25l`);
    const showCursor = () => write(`${CSI}?25h`);
    const moveUp = (n: number) => { if (n > 0) write(`${CSI}${n}A`); };

    const visibleCommands = commands.filter(c => !c.hidden);

    const filtered = (): (SlashCommand & { matchIndices: Set<number> })[] => {
      const q = buffer.startsWith('/') ? buffer.slice(1) : '';
      return fuzzyFilter(visibleCommands, q);
    };

    const writePromptLine = () => {
      const ph = placeholder ? ` ${chalk.dim(`(${placeholder})`)}` : '';
      const display = slashActive ? chalk.cyan(buffer) : buffer;
      write(`  ${chalk.bold('?')} ${chalk.white(message)}${ph}\n  ${display}`);
    };

    const renderPopover = () => {
      const items = filtered();
      let lines = 0;
      const q = buffer.startsWith('/') ? buffer.slice(1) : '';

      write('\n');
      lines++;

      if (q) {
        const count = items.length;
        const label = count === 0 ? chalk.dim(`── No matches for "${q}" ──`)
          : count === 1 ? chalk.dim(`── 1 match ──`)
          : chalk.dim(`── ${count} matches ──`);
        write(`  ${label}\n`);
      } else {
        write(`  ${chalk.dim('── Commands ──')}\n`);
      }
      lines++;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const sel = i === slashIdx;
        const icon = sel ? chalk.cyan('❯') : ' ';

        let nameStr: string;
        if (q && item.matchIndices.size > 0) {
          nameStr = '/';
          for (let ci = 0; ci < item.name.length; ci++) {
            const ch = item.name[ci];
            if (item.matchIndices.has(ci)) {
              nameStr += sel ? chalk.cyan.bold.underline(ch) : chalk.cyan(ch);
            } else {
              nameStr += sel ? chalk.bold(ch) : chalk.dim(ch);
            }
          }
        } else {
          nameStr = sel ? chalk.cyan.bold(`/${item.name}`) : chalk.dim(`/${item.name}`);
        }

        const desc = sel ? chalk.white(item.description) : chalk.dim(item.description);
        const pad = ' '.repeat(Math.max(1, 18 - item.name.length));
        write(`  ${icon} ${nameStr}${pad}${desc}\n`);
        lines++;
      }

      if (items.length > 0) {
        write(`  ${chalk.dim('↑↓')} navigate  ${chalk.dim('⏎')} select  ${chalk.dim('⎵')} accept  ${chalk.dim('esc')} cancel\n`);
        lines++;
      } else {
        write(`  ${chalk.dim('esc')} cancel\n`);
        lines++;
      }

      return lines;
    };

    const erasePopover = () => {
      if (popoverLines > 0) {
        moveUp(popoverLines);
        write(`${CSI}0J`);
        popoverLines = 0;
      }
    };

    const erasePromptLine = () => {
      write('\r');
      write(`${CSI}2K`);
    };

    const redrawPrompt = () => {
      erasePromptLine();
      const display = slashActive ? chalk.cyan(buffer) : buffer;
      write(`  ${display}`);
    };

    const redrawPopover = () => {
      erasePopover();
      redrawPrompt();
      slashIdx = Math.min(slashIdx, Math.max(0, filtered().length - 1));
      popoverLines = renderPopover();
    };

    const exitSlash = () => {
      slashActive = false;
      erasePopover();
      redrawPrompt();
      showCursor();
    };

    const cleanup = () => {
      destroyed = true;
      process.stdin.off('data', onData);
      process.stdin.setRawMode(rawMode ?? false);
      showCursor();
    };

    const confirmCmd = (cmd: SlashCommand) => {
      erasePopover();
      erasePromptLine();
      // Erase the question line too
      moveUp(1);
      write(`${CSI}0J`);
      write(`  ${chalk.green('✔')} ${chalk.cyan(`/${cmd.name}`)}\n`);
      cleanup();
      // Await async handlers before re-rendering the prompt so async output
      // (e.g. provider checks) lands above the new prompt, not interleaved.
      Promise.resolve(onCommand(`/${cmd.name}`)).then(() => {
        inputWithSlashComplete(message, commands, onCommand, placeholder).then(resolve);
      });
    };

    const submitText = () => {
      const text = buffer;
      erasePopover();
      erasePromptLine();
      // Erase the question line too
      moveUp(1);
      write(`${CSI}0J`);
      write(`  ${chalk.green('✔')} ${chalk.white(message)} ${chalk.cyan(text)}\n`);
      cleanup();
      resolve(text);
    };

    const onData = (data: string) => {
      if (destroyed) return;

      if (data === '\x03') {
        cleanup();
        write('\n');
        process.exit(130);
        return;
      }

      if (slashActive) {
        const items = filtered();
        if (data === `${CSI}A` || data === 'k') {
          if (slashIdx > 0) slashIdx--;
          redrawPopover();
          return;
        }
        if (data === `${CSI}B` || data === 'j') {
          if (slashIdx < items.length - 1) slashIdx++;
          redrawPopover();
          return;
        }
        if (data === '\r' || data === '\n') {
          if (items.length > 0 && slashIdx < items.length) {
            confirmCmd(items[slashIdx]);
          }
          return;
        }
        if (data === ESC) {
          exitSlash();
          return;
        }
        if (data === '\x7F' || data === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            const newItems = filtered();
            slashIdx = Math.min(slashIdx, Math.max(0, newItems.length - 1));
            if (!buffer.startsWith('/')) {
              exitSlash();
            } else {
              redrawPopover();
            }
          }
          return;
        }
        if (data === ' ') {
          if (items.length > 0 && slashIdx < items.length) {
            buffer = `/${items[slashIdx].name}`;
          }
          redrawPopover();
          return;
        }
        if (data.length === 1 && data.charCodeAt(0) >= 32) {
          buffer += data;
          const newItems = filtered();
          slashIdx = Math.min(slashIdx, Math.max(0, newItems.length - 1));
          redrawPopover();
          return;
        }
        return;
      }

      // Normal mode
      if (data === '/' && buffer.length === 0) {
        buffer = '/';
        slashActive = true;
        slashIdx = 0;
        hideCursor();
        redrawPrompt();
        popoverLines = renderPopover();
        return;
      }

      if (data === '\r' || data === '\n') {
        if (buffer.trim()) {
          submitText();
        }
        return;
      }

      if (data === '\x7F' || data === '\b') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          redrawPrompt();
        }
        return;
      }

      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        buffer += data;
        redrawPrompt();
      }
    };

    process.stdin.on('data', onData);
    writePromptLine();
    showCursor();
  });
}

function readline() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export async function multiSelect(
  message: string,
  options: SelectOption[],
  defaults: string[] = [],
): Promise<string[]> {
  const selected = new Set(defaults);
  let cursor = 0;
  let active = true;

  const rawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  const write = (s: string) => process.stdout.write(s);
  const hideCursor = () => write(`${CSI}?25l`);
  const showCursor = () => write(`${CSI}?25h`);

  const renderFrame = () => {
    write(`  ${chalk.bold('?')} ${chalk.white(message)} ${chalk.dim('(space to toggle, enter to confirm)')}\n`);
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isCursor = i === cursor;
      const isChecked = selected.has(opt.value as string);
      const checkbox = isChecked ? chalk.green('◉') : chalk.dim('◯');
      const arrow = isCursor ? chalk.cyan('❯') : ' ';
      const label = isCursor ? chalk.white.bold(opt.label) : chalk.dim(opt.label);
      write(`  ${arrow} ${checkbox} ${label}\n`);
    }
  };

  hideCursor();
  renderFrame();

  return new Promise<string[]>((resolve) => {
    const onData = (data: string) => {
      if (!active) return;

      if (data === keys.ctrlC || data === keys.escape) {
        active = false;
        process.stdin.off('data', onData);
        process.stdin.setRawMode(rawMode ?? false);
        showCursor();
        write('\n');
        process.exit(data === keys.ctrlC ? 130 : 0);
        return;
      }

      if (data === keys.up || data === 'k') {
        if (cursor > 0) cursor--;
        rewrite();
        return;
      }

      if (data === keys.down || data === 'j') {
        if (cursor < options.length - 1) cursor++;
        rewrite();
        return;
      }

      if (data === ' ') {
        const val = options[cursor].value as string;
        if (selected.has(val)) selected.delete(val);
        else selected.add(val);
        rewrite();
        return;
      }

      if (data === keys.enter) {
        active = false;
        process.stdin.off('data', onData);
        process.stdin.setRawMode(rawMode ?? false);
        showCursor();
        const result = [...selected];
        const total = options.length + 1;
        write(`${CSI}${total}A${CSI}0J`);
        write(`  ${chalk.green('✔')} ${chalk.white(message)} ${chalk.cyan([...selected].join(', '))}\n`);
        resolve(result);
        return;
      }
    };

    const rewrite = () => {
      const total = options.length + 1;
      write(`${CSI}${total}A${CSI}0J`);
      renderFrame();
    };

    process.stdin.on('data', onData);
  });
}
