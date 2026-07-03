// Verdict parsing for mentor reviews: extract and strip the structured JSON
// block (`{"verdict":…, "risk":…, …}`) the mentor emits on every review.
// Domain logic only — no React, no Ink.

export interface Verdict {
  verdict?: string;
  risk?: string;
  confidence?: number;
  summary?: string;
}

/** Strip a single trailing comma before a closing } or ] so near-valid JSON parses. */
function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

/** Try to parse a candidate JSON string into a verdict, tolerating trailing commas. */
function toVerdict(raw: string): Verdict | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    try {
      o = JSON.parse(stripTrailingCommas(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== 'object') return null;
  const verdict = typeof o.verdict === 'string' ? o.verdict.toLowerCase() : undefined;
  const risk = typeof o.risk === 'string' ? o.risk.toLowerCase() : undefined;
  if (!verdict && !risk) return null;
  return {
    verdict,
    risk,
    confidence: typeof o.confidence === 'number' ? o.confidence : undefined,
    summary: typeof o.summary === 'string' ? o.summary : undefined,
  };
}

/**
 * Extract top-level {…} JSON spans via brace counting, handling nesting and
 * braces that appear inside JSON strings. Tracks string context (inside `"…"`)
 * and escaped quotes (`\"`) so a value like `{"summary": "use { for blocks"}`
 * isn't split prematurely.
 */
export function extractJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0, start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { blocks.push(text.slice(start, i + 1)); start = -1; } }
  }
  return blocks;
}

/**
 * Extract the verdict block from a mentor review. Scans every fenced code block
 * (```json, a bare ``` fence, or any language tag) and returns the first one
 * that parses into an object carrying a `verdict` or `risk` field — a leading
 * non-verdict json block no longer suppresses the chip. Falls back to
 * brace-matching the first {…} that parses when no fence yields a verdict.
 */
export function parseVerdict(content: string): Verdict | null {
  for (const m of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const v = toVerdict(m[1].trim());
    if (v) return v;
  }
  // No fenced verdict — try each top-level {…} span in document order.
  for (const block of extractJsonBlocks(content)) {
    const v = toVerdict(block);
    if (v) return v;
  }
  return null;
}

/**
 * Remove every verdict-bearing block from the rendered body so the raw JSON
 * never leaks beside the chip. Globally strips any fenced block (tagged, bare,
 * or ```json) whose payload parses to a verdict, then any remaining {…} span
 * that does — mirroring what `parseVerdict` consumes. Non-verdict code fences
 * are left untouched.
 */
export function stripVerdictBlocks(content: string): string {
  let out = content.replace(/```[^\n]*\n[\s\S]*?```/g, block => {
    const inner = block.replace(/^```[^\n]*\n/, '').replace(/```$/, '');
    return toVerdict(inner.trim()) ? '' : block;
  });
  // Remove top-level {…} spans that parse to a verdict. Brace-counting keeps
  // nested objects intact; split/join removes every occurrence.
  for (const block of extractJsonBlocks(out)) {
    if (toVerdict(block)) out = out.split(block).join('');
  }
  return out.trim();
}
