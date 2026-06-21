// Theme module — colour tokens, icons and small formatters shared by the Ink
// component tree. No rendering here; Ink's <Text color> consumes the hex
// strings directly. The violet → cyan → fuchsia identity is preserved.

export const colors = {
  mentor: '#67e8f9',
  executor: '#f0abfc',
  human: '#86efac',
  success: '#4ade80',
  error: '#f87171',
  warn: '#fbbf24',
  info: '#60a5fa',
  accent: '#a78bfa',
  accentDim: '#7c3aed',
  brand: '#c4b5fd',
  dim: 'gray',
} as const;

export const heroGradient: Array<[number, number, number]> = [
  [129, 140, 248],
  [148, 130, 250],
  [167, 139, 250],
  [192, 132, 252],
  [217, 70, 239],
  [236, 72, 153],
];

const isUnicode = process.platform !== 'win32' || !!process.env.WT_SESSION;

export const icons = {
  mentor: isUnicode ? '◆' : '*',
  executor: isUnicode ? '◇' : 'o',
  human: isUnicode ? '◉' : '@',
  check: isUnicode ? '✓' : 'v',
  cross: isUnicode ? '✗' : 'x',
  dot: isUnicode ? '●' : '*',
  arrow: isUnicode ? '→' : '->',
  divider: isUnicode ? '─' : '-',
  bullet: isUnicode ? '•' : '-',
  info: isUnicode ? 'ℹ' : 'i',
  warn: isUnicode ? '⚠' : '!',
  sparkle: isUnicode ? '✦' : '*',
  chevron: isUnicode ? '›' : '>',
  pointer: isUnicode ? '❯' : '>',
  ellipsis: isUnicode ? '…' : '...',
  pause: isUnicode ? '⏸' : '||',
  play: isUnicode ? '▶' : '>',
  pencil: isUnicode ? '✎' : '~',
  search: isUnicode ? '◎' : 'o',
  gear: isUnicode ? '⚙' : '#',
} as const;

export const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function rgbHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, Math.max(1, maxLen - 1)) + icons.ellipsis;
}
