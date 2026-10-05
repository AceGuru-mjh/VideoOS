// viz-data.ts — S5 可视化面板数据推导（v0.2 §6，issues #55/#56）。
// 纯函数：把会话的工具调用轨迹（持久化消息记录 + 实时 ActiveRun）映射到
// 6 步任务管线、用量聚合与尽力而为的产物解析。无 React、无 store 依赖，
// 仅类型引用 —— 便于推导与复用。
//
// 数据源说明：resultSummary 是服务端压缩过的 JSON 字符串（≤300 字符，
// 超长截断为 "…"，截断后 JSON.parse 会失败）——所有解析都提供正则回退，
// 失败时由调用方优雅降级为「—」。
import type { ChatMessageRecord } from "../../api";
import type { ActiveRun } from "../../store";
import { deriveRunStatus } from "./util";

// ---------------------------------------------------------------- 管线定义

export type PipelineStepId = "plan" | "dsl" | "compile" | "preview" | "qa" | "render";

export interface PipelineStepMeta {
  id: PipelineStepId;
  label: string;
}

/** 6 步流水线（issue #55 / v0.2 §6）：规划 → DSL → 编译 → 预览 → QA → 渲染 */
export const PIPELINE_STEPS: readonly PipelineStepMeta[] = [
  { id: "plan", label: "规划" },
  { id: "dsl", label: "DSL" },
  { id: "compile", label: "编译" },
  { id: "preview", label: "预览" },
  { id: "qa", label: "QA" },
  { id: "render", label: "渲染" },
] as const;

/**
 * 工具 → 管线步骤映射（任务书冻结 + 诊断工具归 QA 的裁量）：
 * - 规划：storyboard.plan / storyboard.toScenes（助手在首个工具前的规划文本同样计入）
 * - DSL：scene.* / layer.* / audio.set / asset.add
 * - 编译：compile.*
 * - 预览：render.preview / render.range
 * - QA：test.*；视觉检查类诊断（inspect.frame / diff.frames / check.*）一并归入
 * - 渲染：render.final
 * 未映射（transaction.* / cache.* / render.status / render.cancel / asset.list /
 * audio.list 等只读清单类）不驱动任何步骤。
 */
export function stepOfTool(name: string): PipelineStepId | null {
  if (name === "storyboard.plan" || name === "storyboard.toScenes") return "plan";
  if (name.startsWith("scene.") || name.startsWith("layer.") || name === "audio.set" || name === "asset.add") return "dsl";
  if (name.startsWith("compile.")) return "compile";
  if (name === "render.preview" || name === "render.range") return "preview";
  if (name.startsWith("test.") || name === "inspect.frame" || name === "diff.frames" || name.startsWith("check.")) return "qa";
  if (name === "render.final") return "render";
  return null;
}

// ---------------------------------------------------------------- 运行模型

export interface VizToolCall {
  name: string;
  status: "start" | "ok" | "error" | "stopped";
  durationMs: number;
  args?: unknown;
  resultSummary?: string;
  frame?: number;
  videoUrl?: string;
}

/** 一次 Agent 任务（持久化消息或实时 run）在可视化层的统一形状 */
export interface VizRun {
  key: string;
  createdAt: number;
  status: "running" | "ok" | "error" | "stopped";
  toolCalls: readonly VizToolCall[];
  /** 助手正文（规划文本判定用） */
  text: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  error: string | null;
}

/**
 * 会话 → 运行列表（时间序）。liveRun 仅在其属于当前会话且尚未落库时追加
 * （runId 去重，覆盖 finalize 竞态与多标签页场景）。
 */
export function collectRuns(
  messages: readonly ChatMessageRecord[],
  liveRun: ActiveRun | null,
  sessionId: string | null,
): VizRun[] {
  const runs: VizRun[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (m.toolCalls === undefined || m.toolCalls.length === 0) continue;
    runs.push({
      key: m.id,
      createdAt: m.createdAt,
      status: deriveRunStatus(m.toolCalls),
      toolCalls: m.toolCalls,
      text: m.content,
      usage: m.usage ?? null,
      error: null,
    });
  }
  if (liveRun !== null && liveRun.sessionId === sessionId) {
    const persisted = messages.some((m) => m.runId !== undefined && m.runId === liveRun.runId);
    if (!persisted) {
      runs.push({
        key: `live-${liveRun.runId}`,
        createdAt: Date.now(),
        status: liveRun.status,
        toolCalls: liveRun.toolCalls,
        text: liveRun.text,
        usage: liveRun.usage,
        error: liveRun.error,
      });
    }
  }
  return runs;
}

// ---------------------------------------------------------------- 步骤状态

export type StepStatus = "pending" | "active" | "done" | "failed";

export interface StepState {
  status: StepStatus;
  /** 该步骤全部 ok 调用的耗时和（ms） */
  durationMs: number;
  /** true = 有可计时的工具调用（false = 仅规划文本，无耗时数据） */
  timed: boolean;
  errorText: string | null;
  /** 归属该步骤的调用次数 */
  calls: number;
  /** （全会话聚合）出现该步骤调用的运行次数 */
  runs: number;
}

const PENDING: StepState = { status: "pending", durationMs: 0, timed: false, errorText: null, calls: 0, runs: 0 };

/** 从 ok 之外的状态行里提取可读错误（error 字段优先，回退 resultSummary 解析） */
export function toolErrorText(tc: VizToolCall): string | null {
  if (tc.status !== "error") return null;
  const err = (tc as { error?: unknown }).error;
  if (typeof err === "string" && err.length > 0) return err;
  return errorFromSummary(tc.resultSummary);
}

/** resultSummary（可能截断）→ 错误文本，尽力而为 */
export function errorFromSummary(summary: string | undefined): string | null {
  if (summary === undefined || summary.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed !== null && typeof parsed === "object") {
      const e = (parsed as { error?: unknown }).error;
      if (typeof e === "string" && e.length > 0) return e;
    }
  } catch {
    // 截断的 JSON —— 正则回退
  }
  const m = /"error"\s*:\s*"([^"]{1,200})/.exec(summary);
  return m === null ? null : m[1] ?? null;
}

/**
 * 单次运行的 6 步状态：
 * - 有调用：error → failed（红显错误文本）；start → active（转圈）；
 *   ok → done（耗时求和）；全部 stopped → pending（未执行即停止）
 * - 无调用：规划步骤特判 —— 运行中且尚无任何工具 → active（思考/规划中）；
 *   已有规划文本（首工具前）或已收尾 → done（无耗时数据）
 */
export function deriveStepStates(run: VizRun): StepState[] {
  const anyTool = run.toolCalls.length > 0;
  const hasText = run.text.trim().length > 0;
  return PIPELINE_STEPS.map((step): StepState => {
    const calls = run.toolCalls.filter((tc) => stepOfTool(tc.name) === step.id);
    if (calls.length === 0) {
      if (step.id === "plan") {
        if (run.status === "running" && !anyTool) {
          return { ...PENDING, status: "active", runs: 1 };
        }
        if (hasText && (anyTool || run.status !== "running")) {
          return { ...PENDING, status: "done", runs: 1 };
        }
      }
      return PENDING;
    }
    const errored = calls.find((tc) => tc.status === "error");
    if (errored !== undefined) {
      return { status: "failed", durationMs: 0, timed: false, errorText: toolErrorText(errored), calls: calls.length, runs: 1 };
    }
    if (calls.some((tc) => tc.status === "start")) {
      return { ...PENDING, status: "active", calls: calls.length, runs: 1 };
    }
    const okCalls = calls.filter((tc) => tc.status === "ok");
    if (okCalls.length > 0) {
      return {
        status: "done",
        durationMs: okCalls.reduce((sum, tc) => sum + tc.durationMs, 0),
        timed: true,
        errorText: null,
        calls: calls.length,
        runs: 1,
      };
    }
    return PENDING;
  });
}

/**
 * 全会话聚合：步骤 done = 任一运行中该步骤有 ok 调用；failed = 有调用但
 * 全部失败；runs = 出现过该步骤调用的运行次数；耗时 = 全部 ok 求和。
 */
export function aggregateStepStates(runs: readonly VizRun[]): { steps: StepState[]; runCount: number } {
  const steps = PIPELINE_STEPS.map((step): StepState => {
    let calls = 0;
    let runHits = 0;
    let okCount = 0;
    let durationMs = 0;
    let active = false;
    let errorText: string | null = null;
    for (const run of runs) {
      const mine = run.toolCalls.filter((tc) => stepOfTool(tc.name) === step.id);
      if (mine.length === 0) continue;
      runHits += 1;
      calls += mine.length;
      for (const tc of mine) {
        if (tc.status === "ok") {
          okCount += 1;
          durationMs += tc.durationMs;
        } else if (tc.status === "start") {
          active = true;
        } else if (tc.status === "error" && errorText === null) {
          errorText = toolErrorText(tc);
        }
      }
    }
    if (okCount > 0) return { status: "done" as const, durationMs, timed: true, errorText: null, calls, runs: runHits };
    if (active) return { status: "active" as const, durationMs: 0, timed: false, errorText: null, calls, runs: runHits };
    if (calls > 0 && errorText !== null) {
      return { status: "failed" as const, durationMs: 0, timed: false, errorText, calls, runs: runHits };
    }
    // 规划文本：任一运行有规划（文本或工具）即视为点亮过
    const planned = step.id === "plan" && runs.some((r) => r.text.trim().length > 0 || r.toolCalls.some((tc) => stepOfTool(tc.name) === "plan"));
    if (planned) return { status: "done" as const, durationMs, timed: durationMs > 0, errorText: null, calls, runs: Math.max(runHits, 1) };
    return { ...PENDING, calls, runs: runHits };
  });
  return { steps, runCount: runs.length };
}

// ---------------------------------------------------------------- 用量聚合

/** 趋势条最多展示的最近运行数（issue #55：N ≤ 12） */
export const TREND_MAX = 12;

export interface UsageRunRow {
  key: string;
  /** 1-based 序号（会话内递增） */
  index: number;
  status: "running" | "ok" | "error" | "stopped";
  /** 全部调用耗时和（ms，进行中为已完成部分的累计） */
  totalMs: number;
  tokens: number | null;
  promptTokens: number;
  completionTokens: number;
  toolCount: number;
  title: string;
}

export interface UsageVideo {
  url: string;
  name: string;
}

export interface UsageSnapshot {
  /** 全部运行（时间序，不截断）——计数用 */
  totalRuns: number;
  /** 最近 TREND_MAX 次运行（时间序，末尾最新） */
  trendRuns: UsageRunRow[];
  promptTokens: number;
  completionTokens: number;
  /** render.preview 次数 */
  previewCalls: number;
  /** render.range 次数 */
  rangeCalls: number;
  /** 预览帧数估算：preview×1 + range 帧数（args.from/to 或结果 frames） */
  previewFrames: number;
  /** render.final ok 次数 */
  finalCalls: number;
  /** 产出的成片（videoUrl 去重） */
  videos: UsageVideo[];
  /** 缓存命中/未命中（render.final 结果聚合；null = 无可解析数据） */
  cacheHits: number | null;
  cacheMisses: number | null;
  /** cache.stats 快照（entries/bytes；null = 未解析到） */
  cacheEntries: number | null;
  cacheBytes: number | null;
}

/**
 * 截断安全的数字提取：优先 JSON.parse，失败（尾部 "…" 截断）时用
 * `"key":N` 正则回退 —— 服务端摘要里数字字段都在前 300 字符内。
 */
export function numFromSummary(summary: string | undefined, key: string): number | null {
  if (summary === undefined || summary.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed !== null && typeof parsed === "object") {
      const container = parsed as { data?: unknown; [k: string]: unknown };
      const sources: Array<Record<string, unknown>> = [];
      if (container.data !== null && typeof container.data === "object" && !Array.isArray(container.data)) {
        sources.push(container.data as Record<string, unknown>);
      }
      sources.push(container);
      for (const src of sources) {
        const v = src[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
    }
  } catch {
    // 截断的 JSON —— 落到正则
  }
  const m = new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`).exec(summary);
  return m === null ? null : Number(m[1]);
}

/** render.range 的帧数估算：args.from/to 闭区间（clamp 到非负） */
function rangeFramesFromArgs(args: unknown): number | null {
  if (args === null || typeof args !== "object") return null;
  const a = args as { from?: unknown; to?: unknown };
  if (typeof a.from !== "number" || typeof a.to !== "number") return null;
  const from = Math.floor(a.from);
  const to = Math.floor(a.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return Math.min(to - from + 1, 1000);
}

/** 会话（+ 实时 run）→ 用量快照。全部尽力而为：解析失败的字段为 null。 */
export function deriveUsage(runs: readonly VizRun[]): UsageSnapshot {
  let promptTokens = 0;
  let completionTokens = 0;
  let previewCalls = 0;
  let rangeCalls = 0;
  let previewFrames = 0;
  let finalCalls = 0;
  let cacheHits: number | null = null;
  let cacheMisses: number | null = null;
  let cacheEntries: number | null = null;
  let cacheBytes: number | null = null;
  const videos: UsageVideo[] = [];
  const seenUrls = new Set<string>();
  const rows: UsageRunRow[] = [];

  runs.forEach((run, i) => {
    let totalMs = 0;
    if (run.usage !== null) {
      promptTokens += run.usage.promptTokens;
      completionTokens += run.usage.completionTokens;
    }
    for (const tc of run.toolCalls) {
      totalMs += tc.durationMs;
      if (tc.status === "ok") {
        if (tc.name === "render.preview") {
          previewCalls += 1;
          previewFrames += 1;
        } else if (tc.name === "render.range") {
          rangeCalls += 1;
          const fromArgs = rangeFramesFromArgs(tc.args);
          const fromResult = numFromSummary(tc.resultSummary, "frames");
          previewFrames += fromArgs ?? fromResult ?? 1;
        } else if (tc.name === "render.final") {
          finalCalls += 1;
          const hits = numFromSummary(tc.resultSummary, "cacheHits");
          const misses = numFromSummary(tc.resultSummary, "cacheMisses");
          if (hits !== null) cacheHits = (cacheHits ?? 0) + hits;
          if (misses !== null) cacheMisses = (cacheMisses ?? 0) + misses;
        } else if (tc.name === "cache.stats") {
          const entries = numFromSummary(tc.resultSummary, "entries");
          const bytes = numFromSummary(tc.resultSummary, "bytes");
          if (entries !== null) cacheEntries = entries;
          if (bytes !== null) cacheBytes = bytes;
        }
        if (tc.videoUrl !== undefined && tc.videoUrl.length > 0 && !seenUrls.has(tc.videoUrl)) {
          seenUrls.add(tc.videoUrl);
          const name = tc.videoUrl.split("/").filter((p) => p.length > 0).pop() ?? tc.videoUrl;
          videos.push({ url: tc.videoUrl, name });
        }
      }
    }
    const tokens = run.usage === null ? null : run.usage.promptTokens + run.usage.completionTokens;
    rows.push({
      key: run.key,
      index: i + 1,
      status: run.status,
      totalMs,
      tokens,
      promptTokens: run.usage?.promptTokens ?? 0,
      completionTokens: run.usage?.completionTokens ?? 0,
      toolCount: run.toolCalls.length,
      title:
        `任务 ${i + 1} · ${run.status === "running" ? "进行中" : run.status === "ok" ? "完成" : run.status === "error" ? "出错" : "已停止"}` +
        ` · ${run.toolCalls.length} 次调用 · ${fmtMs(totalMs)}` +
        (tokens !== null ? ` · ${fmtK(tokens)} tokens` : ""),
    });
  });

  return {
    totalRuns: rows.length,
    trendRuns: rows.slice(-TREND_MAX),
    promptTokens,
    completionTokens,
    previewCalls,
    rangeCalls,
    previewFrames,
    finalCalls,
    videos,
    cacheHits,
    cacheMisses,
    cacheEntries,
    cacheBytes,
  };
}

// ---------------------------------------------------------------- 产物解析

/**
 * 失败 QA → 相关帧号（issue #56「跳到失败帧」）：优先深走
 * suites[].results[] 找 status==="fail" 的 details.frame/message；
 * JSON 截断时回退首个 `"frame":N`。
 */
export function parseQaFailFrame(summary: string | undefined): number | null {
  if (summary === undefined || summary.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (parsed !== null && typeof parsed === "object") {
      const data = (parsed as { data?: unknown }).data ?? parsed;
      if (data !== null && typeof data === "object") {
        const suites = (data as { suites?: unknown }).suites;
        if (Array.isArray(suites)) {
          for (const suite of suites) {
            const results = (suite as { results?: unknown }).results;
            if (!Array.isArray(results)) continue;
            for (const r of results) {
              const rec = r as { status?: unknown; details?: unknown; message?: unknown };
              if (rec.status !== "fail") continue;
              const details = rec.details;
              if (details !== null && typeof details === "object") {
                const f = (details as { frame?: unknown }).frame;
                if (typeof f === "number" && Number.isFinite(f)) return Math.max(0, Math.floor(f));
                if (typeof f === "string" && /^\d+$/.test(f)) return Number(f);
              }
              const msg = rec.message;
              if (typeof msg === "string") {
                const m = /\bframe\s+(\d+)/i.exec(msg);
                if (m !== null) return Number(m[1]);
              }
            }
          }
        }
      }
    }
  } catch {
    // 截断的 JSON —— 正则回退
  }
  const m = /"frame"\s*:\s*"?(\d+)"?/.exec(summary);
  return m === null ? null : Number(m[1]);
}

// ---------------------------------------------------------------- 格式化

/** 数字紧凑格式（无单位后缀）：980 / 12.3k / 1.04M */
export function fmtK(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 毫秒紧凑格式：230ms / 1.4s / 1m03s（与 util.fmtDuration 一致，供 title 用） */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms - m * 60_000) / 1000);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

/** 字节紧凑格式：512 B / 1.2 KB / 3.4 MB */
export function fmtBytesLocal(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
