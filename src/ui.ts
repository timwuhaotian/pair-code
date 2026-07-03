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
  accentDim: '#8b5cf6',
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
  sparkle: isUnicode ? '✦' : '*',
  chevron: isUnicode ? '›' : '>',
  pointer: isUnicode ? '❯' : '>',
  ellipsis: isUnicode ? '…' : '...',
  pause: isUnicode ? '⏸' : '||',
  gear: isUnicode ? '⚙' : '#',
  infinity: isUnicode ? '∞' : 'inf',
  arrowDown: isUnicode ? '↓' : 'v',
  corner: isUnicode ? '╰' : '\\',
  caret: isUnicode ? '▌' : '|',
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

/**
 * Render the iteration counter. An unlimited run (maxIterations === Infinity,
 * the default) has no meaningful denominator, so we show the count against the
 * infinity glyph — `3/∞` — rather than `3/Infinity`.
 */
export function formatIterations(iteration: number, max: number): string {
  return Number.isFinite(max) ? `${iteration}/${max}` : `${iteration}/${icons.infinity}`;
}

export function truncate(str: string, maxLen: number): string {
  // Operate on code points (via the spread) rather than UTF-16 code units so a
  // truncation boundary never splits a surrogate pair (e.g. an emoji glyph).
  const chars = [...str];
  if (chars.length <= maxLen) return str;
  // maxLen <= 1 leaves no room for "<char>…", so bound the ellipsis itself to
  // maxLen rather than overflowing to maxLen+1 glyphs.
  if (maxLen <= 1) return (maxLen <= 0 ? '' : icons.ellipsis).slice(0, maxLen);
  return chars.slice(0, maxLen - 1).join('') + icons.ellipsis;
}

// ── Display helpers ─────────────────────────────────────────────────────
// Profile/model label formatters. These are pure presentation, so they live in
// the theme/formatter module rather than the provider-resolution module.

const KNOWN_BRANDS: Record<string, string> = {
  gpt: 'GPT',
  glm: 'GLM',
  llama: 'Llama',
  qwen: 'Qwen',
  kimi: 'Kimi',
  gemini: 'Gemini',
  gemma: 'Gemma',
  claude: 'Claude',
  anthropic: 'Anthropic',
  grok: 'Grok',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
  moonshot: 'Moonshot',
  openrouter: 'OpenRouter',
  zhipu: 'Zhipu',
};

const ACRONYMS = new Set(['gpt', 'glm', 'llm', 'tts', 'stt', 'ocr', 'ai']);

export function humanizeProfileName(raw: string): string {
  const lower = raw.toLowerCase();
  for (const brand in KNOWN_BRANDS) {
    if (!lower.startsWith(brand)) continue;
    const rest = lower.slice(brand.length);
    // Bare brand → just the brand label.
    if (!rest) return KNOWN_BRANDS[brand];
    // Brand + separated suffix (e.g. 'anthropic-eu') → keep the suffix so labels
    // stay unique (e.g. 'Anthropic (eu)'). A run-on like 'anthropicfoo' isn't a
    // clean brand match, so fall through to default titlecasing instead.
    const suffix = rest.replace(/^[-_.]+/, '');
    if (suffix.length < rest.length) return `${KNOWN_BRANDS[brand]} (${suffix})`;
    break;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function inferTier(id: string): 'flagship' | 'standard' | 'fast' | 'light' {
  const lower = id.toLowerCase();
  if (/\b(opus|pro|max|flagship|ultra|m2|reasoner)\b/.test(lower)) return 'flagship';
  if (/\b(haiku|mini|flash|nano|fast|small|light|air)\b/.test(lower)) return 'fast';
  if (/\b(free|tiny)\b/.test(lower)) return 'light';
  return 'standard';
}

function formatSegment(part: string): string {
  const lower = part.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  for (const brand in KNOWN_BRANDS) {
    if (lower.startsWith(brand)) return KNOWN_BRANDS[brand] + part.slice(brand.length);
  }
  if (/^\d/.test(part)) return part;
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function humanizeModelId(id: string): string {
  const last = id.split('/').pop() ?? id;
  const parts = last.split('-');
  const out: string[] = [];
  for (const part of parts) {
    if (/^\d+$/.test(part) && out.length > 0 && /^[\d.]+$/.test(out[out.length - 1])) {
      out[out.length - 1] = out[out.length - 1] + '.' + part;
      continue;
    }
    out.push(formatSegment(part));
  }
  return out.join(' ');
}
