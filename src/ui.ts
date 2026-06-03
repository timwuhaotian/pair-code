import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

const isUnicode = process.platform !== 'win32' || !!process.env.WT_SESSION;

export const icons = {
  mentor: isUnicode ? '◆' : '*',
  executor: isUnicode ? '◇' : 'o',
  human: isUnicode ? '◉' : '@',
  gear: isUnicode ? '⚙' : '#',
  check: isUnicode ? '✓' : '√',
  cross: isUnicode ? '✗' : 'x',
  dot: isUnicode ? '●' : '*',
  arrow: isUnicode ? '→' : '->',
  divider: isUnicode ? '─' : '-',
  bullet: isUnicode ? '•' : '-',
  info: isUnicode ? 'ℹ' : 'i',
  warn: isUnicode ? '⚠' : '!',
  sparkle: isUnicode ? '✦' : '*',
  chevron: isUnicode ? '›' : '>',
  ellipsis: isUnicode ? '…' : '...',
  bracketL: isUnicode ? '⟨' : '<',
  bracketR: isUnicode ? '⟩' : '>',
  pause: isUnicode ? '⏸' : '||',
  play: isUnicode ? '▶' : '>',
  stop: isUnicode ? '■' : 'x',
};

export const palette = {
  mentor: chalk.hex('#67e8f9'),
  mentorBg: chalk.bgHex('#0891b2').white,
  executor: chalk.hex('#f0abfc'),
  executorBg: chalk.bgHex('#c026d3').white,
  human: chalk.hex('#86efac'),
  success: chalk.hex('#4ade80'),
  error: chalk.hex('#f87171'),
  warn: chalk.hex('#fbbf24'),
  info: chalk.hex('#60a5fa'),
  dim: chalk.gray,
  bold: chalk.bold,
  muted: chalk.dim,
  accent: chalk.hex('#a78bfa'),
  accentDim: chalk.hex('#7c3aed'),
  brand: chalk.hex('#c4b5fd'),
  bgDark: chalk.bgHex('#1a1a2e'),
};

export type RGB = [number, number, number];

// Violet → fuchsia → pink, used for the hero banner gradient.
export const HERO_GRADIENT: RGB[] = [
  [129, 140, 248],
  [148, 130, 250],
  [167, 139, 250],
  [192, 132, 252],
  [217, 70, 239],
  [236, 72, 153],
];

export function gradient(text: string, colors: RGB[] = HERO_GRADIENT): string {
  if (colors.length === 0) return text;
  if (colors.length === 1) {
    const [r, g, b] = colors[0];
    return chalk.rgb(r, g, b)(text);
  }
  const chars = [...text];
  const n = chars.length;
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const idx = t * (colors.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(colors.length - 1, lo + 1);
    const frac = idx - lo;
    const [r1, g1, b1] = colors[lo];
    const [r2, g2, b2] = colors[hi];
    const r = Math.round(r1 + (r2 - r1) * frac);
    const g = Math.round(g1 + (g2 - g1) * frac);
    const b = Math.round(b1 + (b2 - b1) * frac);
    out += chalk.rgb(r, g, b)(chars[i]);
  }
  return out;
}

export function getColumns(): number {
  return Math.min(process.stdout.columns || 80, 120);
}

export function divider(char?: string, color?: (s: string) => string): string {
  const col = char ?? icons.divider;
  const line = col.repeat(getColumns());
  return color ? color(line) : palette.dim(line);
}

export function center(text: string, width?: number): string {
  const w = width ?? getColumns();
  const stripped = stripAnsi(text);
  const tw = stringWidth(stripped);
  const pad = Math.max(0, Math.floor((w - tw) / 2));
  return ' '.repeat(pad) + text;
}

export function wrap(text: string, indent: number = 0, width?: number): string {
  const w = (width ?? getColumns()) - indent;
  return wrapAnsi(text, Math.max(w, 20), { hard: true, trim: false });
}

export function statusIcon(status: string): string {
  switch (status) {
    case 'idle': return palette.dim(icons.dot);
    case 'mentoring': return palette.mentor('●');
    case 'executing': return palette.executor('●');
    case 'reviewing': return palette.info('●');
    case 'paused': return palette.warn(icons.pause);
    case 'error': return palette.error('✖');
    case 'finished': return palette.success('✓');
    default: return palette.dim('○');
  }
}

const SPINNER = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

export function spinnerChar(tick: number, color: (s: string) => string = palette.accent): string {
  return color(SPINNER[Math.abs(tick) % SPINNER.length]);
}

export function phaseSpinner(phase: string, tick: number = 0): string {
  switch (phase) {
    case 'thinking': return spinnerChar(tick, palette.mentor);
    case 'using_tools': return palette.warn('◆');
    case 'responding': return spinnerChar(tick, palette.success);
    case 'waiting': return palette.dim('◌');
    case 'stalled': return palette.error('!');
    case 'idle': return palette.dim('·');
    case 'error': return palette.error('✖');
    default: return palette.dim('·');
  }
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function truncate(str: string, maxLen: number): string {
  const stripped = stripAnsi(str);
  if (stringWidth(stripped) <= maxLen) return str;
  return stripAnsi(str).slice(0, maxLen - 1) + icons.ellipsis;
}

export function visibleWidth(str: string): number {
  return stringWidth(stripAnsi(str));
}
