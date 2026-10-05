// Chat view helpers (v0.2 §3): time/token/duration formatting, tool-name
// categorization, compact args rendering, QA summary parsing.
// 用户可见文案（相对时间 / 工具分类 / 起始任务）由调用方传入 t 查词典；
// tokens/ms/s/m 等技术单位保留原文。

/** i18n 查词函数形状（useI18n().t） */
export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** epoch ms → 刚刚 / N 分钟前 / N 小时前 / N 天前 / date（词典键 + 浏览器本地日期） */
export function fmtRelTime(ts: number, t: TranslateFn): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("chatStream.relNow");
  if (diff < 3_600_000) return t("chatStream.relMinutes", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("chatStream.relHours", { n: Math.floor(diff / 3_600_000) });
  if (diff < 7 * 86_400_000) return t("chatStream.relDays", { n: Math.floor(diff / 86_400_000) });
  return new Date(ts).toLocaleDateString();
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

/** tool name → category label for the TaskCard icon chip (词典键，双语） */
export function toolCategory(name: string, t: TranslateFn): string {
  if (name.startsWith("compile")) return t("chatStream.catCompile");
  if (name.startsWith("scene.") || name.startsWith("layer.")) return t("chatStream.catScene");
  if (name.startsWith("render.preview")) return t("chatStream.catPreview");
  if (name.startsWith("render")) return t("chatStream.catRender");
  if (name.startsWith("test.")) return t("chatStream.catTest");
  if (name.startsWith("asset.")) return t("chatStream.catAsset");
  return t("chatStream.catTool");
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

/** 空会话起始任务建议（词典键，双语） */
export function starterPrompts(t: TranslateFn): string[] {
  return [t("chatStream.starter1"), t("chatStream.starter2"), t("chatStream.starter3")];
}
