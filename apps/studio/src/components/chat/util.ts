// Chat view helpers (v0.2 §3): time/token/duration formatting, tool-name
// categorization, compact args rendering, QA summary parsing.

/** epoch ms → 刚刚 / N 分钟前 / N 小时前 / N 天前 / date */
export function fmtRelTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

/** token count → "830 tokens" / "12.3k tokens" / "1.04M tokens" */
export function fmtTokens(n: number): string {
  if (n < 1000) return `${n} tokens`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k tokens`;
  return `${(n / 1_000_000).toFixed(2)}M tokens`;
}

/** duration ms → "230ms" / "1.4s" / "1m03s" */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms - m * 60_000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/** tool name → category label for the TaskCard icon chip */
export function toolCategory(name: string): string {
  if (name.startsWith("compile")) return "编译";
  if (name.startsWith("scene.") || name.startsWith("layer.")) return "场景";
  if (name.startsWith("render.preview")) return "预览";
  if (name.startsWith("render")) return "渲染";
  if (name.startsWith("test.")) return "测试";
  if (name.startsWith("asset.")) return "素材";
  return "工具";
}

/** args → one-line JSON (short display + full value for the title tooltip) */
export function argsCompact(args: unknown): { short: string; full: string } {
  let full: string;
  try {
    full = args === undefined ? "{}" : JSON.stringify(args) ?? "{}";
  } catch {
    full = String(args);
  }
  if (full.length > 80) return { short: `${full.slice(0, 80)}…`, full };
  return { short: full, full };
}

/** QA resultSummary → {通过 x / 失败 y} when counts are trivially present. */
export function parseTestCounts(summary: string): { passed: number; failed: number } | null {
  const p = /(?:通过|passed)\s*[:：]?\s*(\d+)/i.exec(summary);
  const f = /(?:失败|failed)\s*[:：]?\s*(\d+)/i.exec(summary);
  if (p === null && f === null) return null;
  const passed = p !== null ? Number(p[1]) : 0;
  const failed = f !== null ? Number(f[1]) : 0;
  return { passed, failed };
}

/** persisted tool calls → overall card status */
export function deriveRunStatus(
  toolCalls: Array<{ status: string }>,
): "ok" | "error" | "stopped" {
  if (toolCalls.some((tc) => tc.status === "stopped")) return "stopped";
  if (toolCalls.some((tc) => tc.status === "error")) return "error";
  return "ok";
}

export const STARTER_PROMPTS: string[] = [
  "为当前项目写一个 15 秒的产品介绍视频",
  "检查当前场景的视觉质量问题并修复",
  "优化时间线节奏并重新渲染",
];
