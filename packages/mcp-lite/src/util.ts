// MCP-Lite 共享小工具：截断（输出超限防护）、超时（单调用限时）、字节安全转换。
import { err, type LiteToolResult } from "./tool";

/** UTF-8 字节数 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 截断字符串到 maxBytes（UTF-8 边界安全；绝不切在多字节字符中间）。
 * 返回 { text, truncated } —— 工具输出恒带 truncated 标记（SPEC §3.5）。
 */
export function truncateBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (byteLength(text) <= maxBytes) return { text, truncated: false };
  let cut = "";
  let used = 0;
  for (const ch of text) {
    const size = byteLength(ch);
    if (used + size > maxBytes) break;
    cut += ch;
    used += size;
  }
  return { text: `${cut}\n…[truncated at ${maxBytes} bytes]`, truncated: true };
}

/** 数组截到 max 条（附 truncated 计数） */
export function truncateList<T>(items: T[], max: number): { items: T[]; truncated: boolean; total: number } {
  return { items: items.slice(0, max), truncated: items.length > max, total: items.length };
}

/** 单次操作超时异常 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timeout after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/** 单次操作超时包装（超时抛 TimeoutError，由调用方转结构化错误） */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 把异常翻译为标准工具失败结果（TimeoutError → "TIMEOUT"，其余 → TOOL_ERROR） */
export function errorToResult(error: unknown): LiteToolResult {
  if (error instanceof TimeoutError) return err(`TIMEOUT: ${error.message}`);
  return err(`TOOL_ERROR: ${error instanceof Error ? error.message : String(error)}`);
}

/** 环境变量整数读取（缺省/非法回默认） */
export function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
