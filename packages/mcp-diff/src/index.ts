// @videoos/mcp-diff —— 文本/文件对比服务器（stdio MCP）：LCS diff（行/词模式）、文件 diff（路径监狱）、相似度。
// 纯 TS 零原生依赖：LCS 用滚动 DP（Int32Array），乘积超限返回 E_TOO_LARGE；文件读取走 MCP_DIFF_ROOTS 监狱。
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { jailFromEnv, ToolError, defineTool, err, ok, runStdioServer, byteLength } from "@videoos/mcp-lite";
import { z } from "zod";

const MAX_BYTES = 1_048_576; // 单输入 1MB
const MAX_CELLS = 4_200_000; // DP 表单元上限（≈2048x2048）
const MAX_PATCH = 2000; // patch 条目上限

const jail = await jailFromEnv("MCP_DIFF_ROOTS");

/* ---------------- LCS 核心 ---------------- */

type DiffOpType = "ctx" | "del" | "add";
interface DiffOp {
  type: DiffOpType;
  text: string;
}

/** LCS 长度（Int32Array DP，倒序填充） */
function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  let prev = new Int32Array(w);
  let curr = new Int32Array(w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      curr[j] = a[i] === b[j] ? prev[j + 1] + 1 : Math.max(prev[j], curr[j + 1]);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[0];
}

/** LCS 编辑脚本：ctx/del/add 序列（贪心回溯，删除优先） */
function lcsOps(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((t) => ({ type: "add" as DiffOpType, text: t }));
  if (m === 0) return a.map((t) => ({ type: "del" as DiffOpType, text: t }));
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "ctx", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      ops.push({ type: "del", text: a[i] });
      i += 1;
    } else {
      ops.push({ type: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "del", text: a[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", text: b[j] });
    j += 1;
  }
  return ops;
}

/** 输入体积/DP 乘积守卫 */
function guardSizes(a: string[], b: string[]): string | null {
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    return `E_TOO_LARGE: diff inputs too large (${a.length} x ${b.length} units, limit ~${MAX_CELLS} cells); split the input or compare summaries`;
  }
  return null;
}

/** stats：added/removed 计数；changed = 每个连续替换区域内的 min(删除数, 新增数) 之和 */
function diffStats(ops: DiffOp[]): { added: number; removed: number; changed: number } {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let dels = 0;
  let adds = 0;
  let inRegion = false;
  const flush = (): void => {
    if (inRegion) {
      changed += Math.min(dels, adds);
      dels = 0;
      adds = 0;
      inRegion = false;
    }
  };
  for (const op of ops) {
    if (op.type === "ctx") {
      flush();
    } else {
      inRegion = true;
      if (op.type === "del") {
        removed += 1;
        dels += 1;
      } else {
        added += 1;
        adds += 1;
      }
    }
  }
  flush();
  return { added, removed, changed };
}

/* ---------------- unified diff 渲染 ---------------- */

/** 行模式：3 行上下文的标准 unified diff；无差异返回 "" */
function unifiedFromOps(ops: DiffOp[], labelA: string, labelB: string): string {
  if (!ops.some((o) => o.type !== "ctx")) return "";
  const CONTEXT = 3;
  const ranges: Array<[number, number]> = [];
  let start = -1;
  let end = -1;
  ops.forEach((op, idx) => {
    if (op.type === "ctx") return;
    const s = Math.max(0, idx - CONTEXT);
    const e = Math.min(ops.length - 1, idx + CONTEXT);
    if (start === -1) {
      start = s;
      end = e;
    } else if (s <= end + 1) {
      end = Math.max(end, e);
    } else {
      ranges.push([start, end]);
      start = s;
      end = e;
    }
  });
  if (start !== -1) ranges.push([start, end]);

  const lines: string[] = [`--- ${labelA}`, `+++ ${labelB}`];
  for (const [rs, re] of ranges) {
    let aBefore = 0;
    let bBefore = 0;
    let aCount = 0;
    let bCount = 0;
    for (let k = 0; k < rs; k++) {
      if (ops[k].type !== "add") aBefore += 1;
      if (ops[k].type !== "del") bBefore += 1;
    }
    for (let k = rs; k <= re; k++) {
      if (ops[k].type !== "add") aCount += 1;
      if (ops[k].type !== "del") bCount += 1;
    }
    const aStart = aCount > 0 ? aBefore + 1 : aBefore;
    const bStart = bCount > 0 ? bBefore + 1 : bBefore;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (let k = rs; k <= re; k++) {
      const op = ops[k];
      lines.push(op.type === "ctx" ? ` ${op.text}` : op.type === "del" ? `-${op.text}` : `+${op.text}`);
    }
  }
  return lines.join("\n");
}

/** 词模式：同类型连续 op 合并为一行（空格连接） */
function unifiedFromOpsWords(ops: DiffOp[], labelA: string, labelB: string): string {
  if (!ops.some((o) => o.type !== "ctx")) return "";
  let aCount = 0;
  let bCount = 0;
  for (const op of ops) {
    if (op.type !== "add") aCount += 1;
    if (op.type !== "del") bCount += 1;
  }
  const lines: string[] = [`--- ${labelA}`, `+++ ${labelB}`, `@@ -1,${aCount} +1,${bCount} @@`];
  let runType: DiffOpType | null = null;
  let run: string[] = [];
  const flush = (): void => {
    if (runType !== null && run.length > 0) {
      const prefix = runType === "ctx" ? " " : runType === "del" ? "-" : "+";
      lines.push(prefix + run.join(" "));
    }
    runType = null;
    run = [];
  };
  for (const op of ops) {
    if (op.type !== runType) {
      flush();
      runType = op.type;
    }
    run.push(op.text);
  }
  flush();
  return lines.join("\n");
}

/* ---------------- diff 主逻辑 ---------------- */

interface DiffOutcome {
  unified: string;
  stats: { added: number; removed: number; changed: number };
  patch: DiffOp[];
  truncated: boolean;
  mode: "line" | "word";
}

function diffTexts(a: string, b: string, mode: "line" | "word", labelA: string, labelB: string): DiffOutcome | string {
  const unitsA = mode === "line" ? a.split("\n") : a.split(/\s+/).filter((t) => t.length > 0);
  const unitsB = mode === "line" ? b.split("\n") : b.split(/\s+/).filter((t) => t.length > 0);
  const guard = guardSizes(unitsA, unitsB);
  if (guard !== null) return guard;
  const ops = lcsOps(unitsA, unitsB);
  const unified =
    mode === "line" ? unifiedFromOps(ops, labelA, labelB) : unifiedFromOpsWords(ops, labelA, labelB);
  return {
    unified,
    stats: diffStats(ops),
    patch: ops.slice(0, MAX_PATCH),
    truncated: ops.length > MAX_PATCH,
    mode,
  };
}

/** 读监狱内文本文件：不存在 E_NOT_FOUND / 二进制 E_BINARY / 超限 E_TOO_LARGE */
async function readJailText(path: string): Promise<string> {
  const abs = await jail.resolve(path); // 越狱 → E_JAIL
  if (!existsSync(abs)) throw new ToolError("E_NOT_FOUND", `file not found: ${path}`);
  const info = await stat(abs);
  if (info.size > MAX_BYTES) throw new ToolError("E_TOO_LARGE", `file too large (${info.size} bytes > ${MAX_BYTES}): ${path}`);
  if (!info.isFile()) throw new ToolError("E_NOT_FOUND", `not a regular file: ${path}`);
  const buf = await readFile(abs);
  if (buf.includes(0)) throw new ToolError("E_BINARY", `file appears to be binary (NUL byte found): ${path}`);
  return buf.toString("utf8");
}

/* ---------------- 工具定义 ---------------- */

const modeSchema = z.enum(["line", "word"]).describe("line: compare whole lines; word: compare whitespace-split tokens").default("line");

const tools = [
  defineTool(
    "diff.texts",
    "Diff two texts with an LCS algorithm (line or word mode): unified diff string, add/remove/change stats and a structured patch.",
    z.object({
      a: z.string().describe("old text"),
      b: z.string().describe("new text"),
      mode: modeSchema,
    }),
    ({ a, b, mode }) => {
      if (byteLength(a) > MAX_BYTES || byteLength(b) > MAX_BYTES) {
        return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      }
      const outcome = diffTexts(a, b, mode, "a", "b");
      if (typeof outcome === "string") return err(outcome);
      return ok(outcome);
    },
  ),
  defineTool(
    "diff.files",
    "Diff two files inside MCP_DIFF_ROOTS (line or word mode); same output as diff.texts with file labels.",
    z.object({
      pathA: z.string().describe("old file path, relative to jail root or absolute inside roots"),
      pathB: z.string().describe("new file path, relative to jail root or absolute inside roots"),
      mode: modeSchema,
    }),
    async ({ pathA, pathB, mode }) => {
      const [a, b] = await Promise.all([readJailText(pathA), readJailText(pathB)]);
      const outcome = diffTexts(a, b, mode, pathA, pathB);
      if (typeof outcome === "string") return err(outcome);
      return ok(outcome);
    },
  ),
  defineTool(
    "diff.similarity",
    "Similarity of two texts as 0-100: LCS length / longer input, over lines (multi-line input) or characters (single-line input).",
    z.object({
      a: z.string().describe("first text"),
      b: z.string().describe("second text"),
    }),
    ({ a, b }) => {
      if (byteLength(a) > MAX_BYTES || byteLength(b) > MAX_BYTES) {
        return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      }
      const multi = a.includes("\n") || b.includes("\n");
      const ua = multi ? a.split("\n") : Array.from(a);
      const ub = multi ? b.split("\n") : Array.from(b);
      if (ua.length === 0 && ub.length === 0) {
        return ok({ similarity: 100, lcsLength: 0, units: multi ? "lines" : "chars" });
      }
      const guard = guardSizes(ua, ub);
      if (guard !== null) return err(guard);
      const lcs = lcsLength(ua, ub);
      const similarity = Math.round((lcs / Math.max(ua.length, ub.length)) * 1000) / 10;
      return ok({ similarity, lcsLength: lcs, units: multi ? "lines" : "chars" });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-diff", serverVersion: "0.1.0" });
