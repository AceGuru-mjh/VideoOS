// 权限矩阵 + 自主级别 + 确认流（issue #54，v0.2 §6 server 侧）。
// - resolvePermission：toolPermissions 显式覆盖 > 自主级别预设（L1-L4，31 个 VAP 工具按 inspect/core/danger 分级；
//   mcp_* 前缀工具走 "mcp" 类目：缺省 L1/L2 confirm、L3/L4 allow）
// - GatedRegistry：包裹 VapToolRegistry（{list, call} 同形，orchestrator 无感切换）：
//   deny → {ok:false, error:"PERMISSION_DENIED: ..."}（LLM 读错误自适应，无 WS 确认）；
//   confirm → WS agent-confirm 挂起 → POST /api/agent/resolve {confirmId, decision}（allow/always/deny）或超时默认 deny；
//   "always" → 持久化 toolPermissions[name]="allow" 并放行；
//   危险模式黑名单（settings.agent.dangerousPatterns，正则匹配 JSON.stringify(args)）→ 硬拒绝（优先于一切许可）
// - ConfirmCenter：挂起确认登记簿（ServerState 持有；resolve 路由 ↔ gate 的会合点；settle 时广播 agent-resolved）
import type { VapContext, VapToolInfo, VapToolResult } from "@videoos/agent";
import type { SettingsStore } from "../settings/store";
import type { ServerEvent } from "../state";
import { newId } from "./sessions";
import type { McpAggregatedTool, McpToolSource } from "./mcp";

// ---------------------------------------------------------------- 类型

export type PermissionDecision = "allow" | "confirm" | "deny";
export type ConfirmDecision = "allow" | "always" | "deny";

/** settings.agent 快照（结构化形状；gate 内可变副本 —— "always" 会写入 allow） */
export interface AgentGateSettings {
  autonomy: "L1" | "L2" | "L3" | "L4";
  toolPermissions: Record<string, PermissionDecision>;
  confirmRender: boolean;
  dangerousPatterns: string[];
}

/** 确认等待超时（挂起确认默认 120s；测试经 options 注入短超时） */
export const DEFAULT_CONFIRM_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------- 31 VAP 工具分级（packages/agent/src/vap/ 注册表实读）

/** 纯检查类（无副作用）：L1-L4 全部 allow */
const PURE_INSPECT_TOOLS: ReadonlySet<string> = new Set([
  "compile.diagnostics",
  "compile.vir",
  "scene.list",
  "scene.inspect",
  "layer.inspect",
  "asset.list",
  "audio.list",
  "render.status",
  "cache.stats",
  "test.results",
  "transaction.list",
  "inspect.frame",
  "diff.frames",
  "check.overflow",
  "check.missingAssets",
  "storyboard.plan",
]);

/** 核心变更类（迭代工作流主干）：L2 起允许 */
const CORE_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "compile.run",
  "render.preview",
  "render.range",
  "render.cancel",
  "test.run",
  "transaction.begin",
  "transaction.commit",
  "transaction.rollback",
  "storyboard.toScenes",
]);

/** 危险变更类（破坏性/不可逆/昂贵输出）：L2 需确认；L3 仅 render.final（confirmRender 时）与 cache.clear 需确认 */
const DANGEROUS_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "scene.modify",
  "layer.modify",
  "audio.set",
  "asset.add",
  "render.final",
  "cache.clear",
]);

/** MCP 工具前缀（合并进 LLM 工具表时由 GatedRegistry 加缀） */
export const MCP_TOOL_PREFIX = "mcp_";

/**
 * 权限裁决（纯函数）：
 * 1. settings.agent.toolPermissions[toolName] 显式覆盖最高优先；
 * 2. mcp_* 工具：toolPermissions["mcp"] 类目覆盖 → 缺省 L1/L2 confirm、L3/L4 allow；
 * 3. 自主级别预设（L1 全确认除纯检查 / L2 核心允许+危险确认 / L3 全允许除 render.final(confirmRender)+cache.clear / L4 全允许）。
 */
export function resolvePermission(toolName: string, agent: AgentGateSettings): PermissionDecision {
  const explicit = agent.toolPermissions[toolName];
  if (explicit !== undefined) return explicit;
  if (toolName.startsWith(MCP_TOOL_PREFIX)) {
    const mcpClass = agent.toolPermissions["mcp"];
    if (mcpClass !== undefined) return mcpClass;
    return agent.autonomy === "L1" || agent.autonomy === "L2" ? "confirm" : "allow";
  }
  switch (agent.autonomy) {
    case "L1":
      return PURE_INSPECT_TOOLS.has(toolName) ? "allow" : "confirm";
    case "L2":
      if (PURE_INSPECT_TOOLS.has(toolName)) return "allow";
      if (DANGEROUS_MUTATION_TOOLS.has(toolName)) return "confirm";
      return CORE_MUTATION_TOOLS.has(toolName) ? "allow" : "confirm"; // 未知新工具默认 confirm
    case "L3":
      if (toolName === "cache.clear") return "confirm";
      if (toolName === "render.final") return agent.confirmRender ? "confirm" : "allow";
      return "allow";
    case "L4":
      return "allow";
  }
}

// ---------------------------------------------------------------- ConfirmCenter（挂起确认登记簿）

export interface PendingConfirmInfo {
  confirmId: string;
  sessionId: string;
  runId: string;
  tool: { name: string; args: unknown };
  createdAt: number;
}

interface PendingEntry extends PendingConfirmInfo {
  settled: boolean;
  readonly promise: Promise<ConfirmDecision>;
  settle(decision: ConfirmDecision): void;
}

/**
 * 挂起确认登记簿：create() 登记 + 返回 promise；resolve() 被 POST /api/agent/resolve 调用；
 * awaitDecision() 以超时/停止竞速（默认拒绝）；每次 settle 广播 agent-resolved（UI 确认卡同步消失）。
 */
export class ConfirmCenter {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(
    private readonly onSettle: (confirmId: string, decision: ConfirmDecision, info: PendingConfirmInfo) => void = () => undefined,
  ) {}

  /** 当前挂起数（诊断/测试） */
  get size(): number {
    return this.entries.size;
  }

  /** 查询挂起确认（UI 刷新兜底） */
  get(confirmId: string): PendingConfirmInfo | null {
    return this.entries.get(confirmId) ?? null;
  }

  /** 登记一条挂起确认（gate 在 emit agent-confirm 前调用） */
  create(info: { sessionId: string; runId: string; tool: { name: string; args: unknown } }): PendingConfirmInfo {
    const confirmId = newId("cf");
    let resolver!: (d: ConfirmDecision) => void;
    const promise = new Promise<ConfirmDecision>((res) => {
      resolver = res;
    });
    const entry: PendingEntry = {
      confirmId,
      sessionId: info.sessionId,
      runId: info.runId,
      tool: info.tool,
      createdAt: Date.now(),
      settled: false,
      promise,
      settle(decision) {
        if (entry.settled) return;
        entry.settled = true;
        resolver(decision);
      },
    };
    this.entries.set(confirmId, entry);
    return { confirmId, sessionId: info.sessionId, runId: info.runId, tool: info.tool, createdAt: entry.createdAt };
  }

  /** 用户裁决（POST /api/agent/resolve）：命中并裁决 → true；不存在/已裁决（超时/停止）→ false */
  resolve(confirmId: string, decision: ConfirmDecision): boolean {
    const entry = this.entries.get(confirmId);
    if (entry === undefined) return false;
    this.settleEntry(entry, decision);
    return true;
  }

  /** 等待裁决：entry.promise vs 超时（默认拒绝）vs 停止标记轮询（停止 → 立即拒绝）；返回后确保登记簿已清位 */
  async awaitDecision(confirmId: string, timeoutMs: number, isStopped: () => boolean): Promise<ConfirmDecision> {
    const entry = this.entries.get(confirmId);
    if (entry === undefined) return "deny";
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    try {
      return await Promise.race([
        entry.promise,
        new Promise<ConfirmDecision>((res) => {
          timeout = setTimeout(() => res("deny"), timeoutMs);
        }),
        new Promise<ConfirmDecision>((res) => {
          poll = setInterval(() => {
            if (isStopped()) res("deny");
          }, 80);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (poll !== undefined) clearInterval(poll);
      this.settleEntry(entry, "deny"); // 已裁决（allow/always/deny）时为 no-op；超时/停止胜出时完成清位 + agent-resolved
    }
  }

  private settleEntry(entry: PendingEntry, decision: ConfirmDecision): void {
    if (entry.settled) return;
    this.entries.delete(entry.confirmId);
    entry.settle(decision);
    this.onSettle(entry.confirmId, decision, entry);
  }
}

// ---------------------------------------------------------------- GatedRegistry

/** 被包裹注册表的最小面（VapToolRegistry 结构化满足；测试可注入桩） */
export interface RegistryLike {
  list(): VapToolInfo[];
  call(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult>;
}

/** 运行上下文（gate 发事件与检查停止标记） */
export interface GateRunContext {
  sessionId: string;
  runId: string;
  isStopped(): boolean;
}

export interface GatedRegistryOptions {
  registry: RegistryLike;
  /** settings.agent 运行期快照（"always" 裁决时本地副本同步放行） */
  agent: AgentGateSettings;
  /** MCP 工具源（settings.mcp.mergeTools=false → null：不合并 mcp_* 工具） */
  mcp: McpToolSource | null;
  /** "always" 裁决的持久化通道 */
  settings: SettingsStore;
  confirms: ConfirmCenter;
  emit: (e: ServerEvent) => void;
  run: GateRunContext;
  /** 挂起确认等待超时（默认 120s；测试注入短超时） */
  confirmTimeoutMs?: number;
}

/** mcp_<serverId>_<tool> 合并命名（serverId 不含下划线 → 可逆解析） */
export function mcpToolName(serverId: string, tool: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}_${tool}`;
}

/** deny 类结果统一形状（错误码前缀固定，LLM 与前端按前缀识别） */
function permissionDenied(name: string, reason: string): VapToolResult {
  return { ok: false, error: `PERMISSION_DENIED: 工具 "${name}" ${reason}` };
}

/**
 * 权限门注册表：list() = VAP 工具 +（可选）MCP 合并工具；call() 经危险模式黑名单 + 权限矩阵 + 确认流后分发。
 * orchestrator 每次 run 构造一个（settings 快照 + 运行上下文），对 provider 完全透明。
 */
export class GatedRegistry {
  private readonly agent: AgentGateSettings;

  constructor(private readonly opts: GatedRegistryOptions) {
    this.agent = { ...opts.agent, toolPermissions: { ...opts.agent.toolPermissions } };
  }

  /** LLM 工具表：VAP 全量 +（mergeTools 且有运行中服务器时）mcp_<serverId>_<tool> 前缀工具 */
  list(): VapToolInfo[] {
    const mcp = this.opts.mcp === null ? [] : this.opts.mcp.aggregatedTools();
    return [
      ...this.opts.registry.list(),
      ...mcp.map((t) => this.toVapToolInfo(t)),
    ];
  }

  /** 门控调用：黑名单硬拒 → 权限裁决 → deny 拒 / allow 放行 / confirm 挂起确认流 */
  async call(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult> {
    const pattern = this.matchDangerousPattern(args);
    if (pattern !== null) {
      return { ok: false, error: `DANGER_PATTERN_MATCHED: ${pattern}` };
    }
    const decision = resolvePermission(name, this.agent);
    if (decision === "deny") {
      return permissionDenied(name, "已被权限设置拒绝（deny），请改用其他方式或询问用户");
    }
    if (decision === "allow") {
      return this.dispatch(name, args, ctx);
    }
    return this.confirmThenCall(name, args, ctx);
  }

  // ---------------------------------------------------------------- internals

  private toVapToolInfo(tool: McpAggregatedTool): VapToolInfo {
    return {
      name: mcpToolName(tool.serverId, tool.name),
      description: `[MCP/${tool.serverId}] ${tool.description}`,
      parameters: tool.parameters,
    };
  }

  /** 危险模式黑名单：任一正则命中 JSON.stringify(args) → 硬拒绝（非法正则跳过 + warn，不炸） */
  private matchDangerousPattern(args: unknown): string | null {
    if (this.agent.dangerousPatterns.length === 0) return null;
    let serialized: string;
    try {
      serialized = JSON.stringify(args ?? {}) ?? "";
    } catch {
      return null; // 不可序列化参数无从匹配 → 放行给后续校验
    }
    for (const pattern of this.agent.dangerousPatterns) {
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch (err) {
        console.warn(`[videoos/server] dangerousPattern 无效已跳过 (${pattern}): ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (re.test(serialized)) return pattern;
    }
    return null;
  }

  /** 确认流：emit agent-confirm → 等待 resolve/超时/停止 → allow/always 放行（always 持久化），否则拒绝 */
  private async confirmThenCall(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult> {
    const { confirms, emit, run } = this.opts;
    if (run.isStopped()) {
      return permissionDenied(name, "调用前运行已被停止");
    }
    const pending = confirms.create({ sessionId: run.sessionId, runId: run.runId, tool: { name, args } });
    emit({
      type: "agent-confirm",
      sessionId: run.sessionId,
      runId: run.runId,
      confirmId: pending.confirmId,
      tool: { name, args },
    });
    const decision = await confirms.awaitDecision(pending.confirmId, this.opts.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS, run.isStopped);
    if (decision === "deny") {
      return permissionDenied(name, "用户拒绝了本次调用或确认超时");
    }
    if (decision === "always") {
      // 持久化 + 本运行快照放行（后续同名调用不再确认）
      this.agent.toolPermissions[name] = "allow";
      try {
        this.opts.settings.update({ agent: { toolPermissions: { [name]: "allow" } } });
      } catch (err) {
        console.warn(`[videoos/server] "always" 持久化失败（本次仍放行）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return this.dispatch(name, args, ctx);
  }

  /** 实际分发：mcp_* → MCP 桥；其余 → 内部注册表 */
  private async dispatch(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult> {
    if (name.startsWith(MCP_TOOL_PREFIX)) {
      if (this.opts.mcp === null) {
        return { ok: false, error: `MCP_TOOL_UNAVAILABLE: ${name}（settings.mcp.mergeTools 未开启或无运行中服务器）` };
      }
      return this.opts.mcp.callTool(name, (args ?? {}) as Record<string, unknown>);
    }
    return this.opts.registry.call(name, args, ctx);
  }
}
