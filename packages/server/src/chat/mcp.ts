// MCP optional-peer 桥（issue #53，v0.2 §6 server 侧）：消费 @videoos/mcp-host（Agent Kit 交付，主线可选依赖）。
//
// ⚠️ 预期契约（本文件顶部 McpHostModule 即服务端期望的模块形状；另见 agent-kit/SPEC.md §3.4）：
//   import { createHost } from "@videoos/mcp-host";
//   createHost({ server: { id, command, args, env } }) → McpHost   // 单服务器宿主实例
//   McpHost: start() / stop() / listTools() → [{name, description, parameters}]
//            callTool(name, args, timeoutMs?) → {ok, data?, error?} / onEvent?(cb)
// SPEC §3.4 另冻结了 `class McpHost(config: {servers: Record<string, ...>})` 形状 —— loadMcpHost 对两种导出
// 形状自适应（createHost 工厂优先，McpHost 类适配为单服务器工厂；listTools 同步/异步、含/不含 server 字段均可）。
//
// 行为：
// - 包未安装 / 加载失败 / 导出形状不符 → 模块缓存 null，全部 /api/mcp* 路由 501 MCP_HOST_UNAVAILABLE（主线零依赖）
// - McpManager（ServerState 懒单例）：服务器配置 CRUD（settings.mcp.servers）、启停、工具聚合（白名单过滤）、
//   callTool 桥（前缀名 mcp_<serverId>_<tool> 可逆解析，serverId 不含下划线）
// - PUT /api/mcp/servers：严格校验（zod，独立于 settings 的迁移容错）→ 持久化 → 全停 → 启动全部 enabled
// - 测试注入：__setMcpHostForTests(module)（fake host，无需真实包）
import { z } from "zod";
import type { VapToolResult } from "@videoos/agent";
import { ServerError } from "../errors";
import { issuesToMessage } from "../settings/store";
import type { SettingsStore } from "../settings/store";
import { McpServerEntrySchema, MCP_SERVER_ID_PATTERN, type McpServerEntry } from "../settings/schema";
import type { ServerEvent } from "../state";

// ---------------------------------------------------------------- 预期契约（见文件头注释）

/** 宿主暴露的单个工具描述 */
export interface McpToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** callTool 结果（与 VapToolResult 同形） */
export interface McpToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** createHost 传入的单服务器规格 */
export interface McpHostServerSpec {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** 规范化宿主实例（内部统一形状；运行时容忍同步/异步与 SPEC §3.4 变体） */
export interface McpHost {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolCallResult>;
  onEvent?(cb: (event: unknown) => void): void;
}

/** @videoos/mcp-host 期望导出（服务端桥接点；见文件头契约说明） */
export interface McpHostModule {
  createHost(config: { server: McpHostServerSpec }): McpHost;
}

// ---------------------------------------------------------------- optional peer 探测（进程级缓存）

const HOST_PACKAGE = "@videoos/mcp-host";

/** 进程级探测缓存：undefined = 未探测；null = 不可用（包缺失/形状不符，已 warn） */
let probedModule: McpHostModule | null | undefined;

/** SPEC §3.4 形状的宽松视图（class McpHost + McpHostConfig{servers}，工具项含 server 字段） */
interface RawHostLike {
  start?: () => unknown;
  stop?: () => unknown;
  listTools?: () => unknown;
  callTool?: (name: string, args: Record<string, unknown>, timeoutMs?: number) => unknown;
  on?: (event: string, cb: (e: unknown) => void) => void;
  onEvent?: (cb: (e: unknown) => void) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** 校验 listTools 结果条目（坏条目剔除而非整组失败） */
function toToolDescriptors(raw: unknown): McpToolDescriptor[] {
  if (!Array.isArray(raw)) return [];
  const out: McpToolDescriptor[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (rec === null || typeof rec.name !== "string" || rec.name.length === 0) continue;
    out.push({
      name: rec.name,
      description: typeof rec.description === "string" ? rec.description : "",
      parameters: asRecord(rec.parameters) ?? { type: "object" },
    });
  }
  return out;
}

/** 宿主实例规范化：listTools 同步/异步均可、SPEC 形状含 server 字段时按 serverId 过滤、on("log")↔onEvent 适配 */
function normalizeHost(raw: RawHostLike, serverId: string): McpHost {
  return {
    start: async () => {
      await raw.start?.();
    },
    stop: async () => {
      await raw.stop?.();
    },
    listTools: async () => {
      const listed = await (raw.listTools?.() ?? []);
      // SPEC §3.4：listTools 项含 server 字段 → 只保留本服务器；投影形状无该字段 → 全部保留
      return toToolDescriptors(
        Array.isArray(listed)
          ? listed.filter((t) => {
              const server = asRecord(t)?.server;
              return server === undefined || server === serverId;
            })
          : listed,
      );
    },
    callTool: async (name, args, timeoutMs) => {
      const result = await (raw.callTool?.(name, args, timeoutMs) ?? { ok: false, error: "MCP_CALL_FAILED: host has no callTool" });
      const rec = asRecord(result);
      if (rec === null || typeof rec.ok !== "boolean") {
        return { ok: false, error: "MCP_BAD_RESULT: callTool returned a non-conforming result" };
      }
      return {
        ok: rec.ok,
        ...(rec.data !== undefined ? { data: rec.data } : {}),
        ...(typeof rec.error === "string" ? { error: rec.error } : {}),
      };
    },
    ...(typeof raw.onEvent === "function"
      ? { onEvent: (cb: (event: unknown) => void) => raw.onEvent?.(cb) }
      : typeof raw.on === "function"
        ? { onEvent: (cb: (event: unknown) => void) => raw.on?.("log", cb) }
        : {}),
  };
}

/** 原始模块 → McpHostModule（createHost 工厂直接透传；SPEC §3.4 class McpHost 适配；否则 null）。测试可注入两种形状。 */
export function adaptMcpHostModule(mod: Record<string, unknown>): McpHostModule | null {
  if (typeof mod.createHost === "function") {
    const createHost = mod.createHost as (config: unknown) => unknown;
    return {
      createHost: (config) => {
        const instance = asRecord(createHost(config));
        if (instance === null) throw new Error("createHost returned a non-object");
        return normalizeHost(instance as unknown as RawHostLike, config.server.id);
      },
    };
  }
  if (typeof mod.McpHost === "function") {
    const Ctor = mod.McpHost as new (config: unknown) => RawHostLike;
    return {
      createHost: (config) =>
        normalizeHost(
          new Ctor({
            servers: { [config.server.id]: { command: config.server.command, args: config.server.args, env: config.server.env } },
          }),
          config.server.id,
        ),
    };
  }
  return null;
}

/**
 * 探测 @videoos/mcp-host（optional peer）：包未安装 / 加载抛错 / 导出形状不符 → null（进程级缓存，只 warn 一次）。
 * 注意：specifier 经变量间接传入（TS 不做静态解析 —— 包不存在也不会引发类型/编译错误）。
 */
export async function loadMcpHost(): Promise<McpHostModule | null> {
  if (probedModule !== undefined) return probedModule;
  try {
    const specifier = HOST_PACKAGE;
    const mod = asRecord(await import(specifier));
    const adapted = mod === null ? null : adaptMcpHostModule(mod);
    if (adapted === null) {
      console.warn(`[videoos/server] ${HOST_PACKAGE} loaded but exports no createHost/McpHost; MCP endpoints stay 501`);
    }
    probedModule = adapted;
  } catch (err) {
    // 常态：包未安装（主线不被 Agent Kit 阻塞）；其余加载错误同样降级而非炸服务
    console.warn(
      `[videoos/server] ${HOST_PACKAGE} unavailable (${err instanceof Error ? err.message : String(err)}); MCP endpoints return 501`,
    );
    probedModule = null;
  }
  return probedModule;
}

/** 重置进程级探测缓存（测试隔离用） */
export function __resetMcpHostProbeForTests(): void {
  probedModule = undefined;
}

// ---------------------------------------------------------------- PUT /api/mcp/servers 校验（严格；与 settings 迁移容错分离）

const mcpServerPutShape = {
  id: z.string().regex(MCP_SERVER_ID_PATTERN, "id must match /^[a-z0-9][a-z0-9-]*$/（小写字母/数字开头，仅小写字母、数字、连字符）"),
  command: z.string().min(1, "command must be a non-empty string"),
  label: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  whitelist: z.array(z.string()).optional(),
  timeoutMs: z.number().int().min(100).max(600_000).optional(),
};

/** PUT 单条输入（缺省字段归一化：args/env/whitelist=[]、enabled=false、timeoutMs=30000） */
const McpServerPutSchema = z.object(mcpServerPutShape);
const McpServersPutSchema = z.object({ servers: z.array(McpServerPutSchema) }).strict();

function normalizeServerEntry(raw: z.infer<typeof McpServerPutSchema>): McpServerEntry {
  return {
    id: raw.id,
    ...(raw.label !== undefined ? { label: raw.label } : {}),
    command: raw.command,
    args: raw.args ?? [],
    env: raw.env ?? {},
    enabled: raw.enabled ?? false,
    whitelist: raw.whitelist ?? [],
    timeoutMs: raw.timeoutMs ?? 30_000,
  };
}

// ---------------------------------------------------------------- McpManager（ServerState 懒单例）

/** 聚合工具项（GET /api/mcp/tools 元素；orchestrator 合并时加 mcp_<serverId>_ 前缀） */
export interface McpAggregatedTool {
  serverId: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** GatedRegistry 消费的最小桥接面（结构化匹配，gate 不直接依赖 McpManager） */
export interface McpToolSource {
  aggregatedTools(): McpAggregatedTool[];
  callTool(prefixedName: string, args: Record<string, unknown>): Promise<VapToolResult>;
}

interface ManagedServer {
  spec: McpServerEntry;
  host: McpHost | null;
  running: boolean;
  tools: McpToolDescriptor[];
  lastError: string | null;
}

export interface McpServerStatus {
  id: string;
  label?: string;
  enabled: boolean;
  running: boolean;
  toolCount: number;
  lastError?: string;
}

function mcpUnavailable(): ServerError {
  return new ServerError("MCP_HOST_UNAVAILABLE", `@videoos/mcp-host 未安装或不可用（可选依赖）；安装后 MCP 面板与端点可用`, 501);
}

export class McpManager {
  private module: McpHostModule | null = null;
  private moduleReady = false;
  private readonly servers = new Map<string, ManagedServer>();

  constructor(
    private readonly deps: {
      settings: SettingsStore;
      hub: { emit(e: ServerEvent): void };
    },
  ) {}

  /** 探测并缓存 host 模块（首次调用触发 import；之后零开销）。null = 不可用。 */
  async ensureModule(): Promise<McpHostModule | null> {
    if (!this.moduleReady) {
      this.module = await loadMcpHost();
      this.moduleReady = true;
      if (this.module !== null) this.syncFromSettings();
    }
    return this.module;
  }

  /** 测试注入：直接给定 host 模块（null = 模拟不可用），并重置全部运行态 */
  async __setMcpHostForTests(module: McpHostModule | null): Promise<void> {
    await this.stopAll();
    this.servers.clear();
    this.module = module;
    this.moduleReady = true;
    if (module !== null) this.syncFromSettings();
  }

  /** settings.mcp.servers → 内存映射（新增入表；已删除移除；spec 刷新为最新值） */
  private syncFromSettings(): void {
    const entries = this.deps.settings.get().mcp.servers;
    for (const id of [...this.servers.keys()]) {
      if (!entries.some((e) => e.id === id)) this.servers.delete(id);
    }
    for (const entry of entries) {
      const existing = this.servers.get(entry.id);
      if (existing === undefined) {
        this.servers.set(entry.id, { spec: entry, host: null, running: false, tools: [], lastError: null });
      } else {
        existing.spec = entry;
      }
    }
  }

  private describeHostEvent(serverId: string, event: unknown): string {
    if (typeof event === "string") return `[mcp/${serverId}] ${event}`;
    try {
      return `[mcp/${serverId}] ${JSON.stringify(event).slice(0, 200)}`;
    } catch {
      return `[mcp/${serverId}] <unserializable event>`;
    }
  }

  /** GET /api/mcp/status → {available, servers}；host 不可用 → 501 */
  async status(): Promise<{ available: boolean; servers: McpServerStatus[] }> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    this.syncFromSettings();
    return {
      available: true,
      servers: [...this.servers.values()].map((s) => ({
        id: s.spec.id,
        ...(s.spec.label !== undefined ? { label: s.spec.label } : {}),
        enabled: s.spec.enabled,
        running: s.running,
        toolCount: s.tools.length,
        ...(s.lastError !== null ? { lastError: s.lastError } : {}),
      })),
    };
  }

  /** GET /api/mcp/servers → {servers}；host 不可用 → 501 */
  async listServers(): Promise<{ servers: McpServerEntry[] }> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    this.syncFromSettings();
    return { servers: this.deps.settings.get().mcp.servers };
  }

  /**
   * PUT /api/mcp/servers {servers: [...]}：严格校验 → 持久化 → 简单 diff 策略（全停 → 启动全部 enabled）。
   * 单服务器启动失败不回滚配置（错误进 status.lastError），响应 200。
   */
  async putServers(body: unknown): Promise<{ servers: McpServerEntry[] }> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    const parsed = McpServersPutSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServerError("SETTINGS_INVALID", issuesToMessage(parsed.error.issues));
    }
    const normalized = parsed.data.servers.map(normalizeServerEntry);
    const dup = normalized.find((e, i) => normalized.findIndex((o) => o.id === e.id) !== i);
    if (dup !== undefined) {
      throw new ServerError("SETTINGS_INVALID", `servers: duplicate id "${dup.id}"`);
    }
    this.deps.settings.update({ mcp: { servers: normalized } });
    await this.stopAll();
    this.servers.clear();
    this.syncFromSettings();
    for (const entry of normalized) {
      if (entry.enabled) await this.startServer(entry.id).catch(() => undefined); // 失败记入 lastError，不中断
    }
    return { servers: this.deps.settings.get().mcp.servers };
  }

  /** POST /api/mcp/servers/:id/start：幂等；未知 → 404；启动失败 → 500 MCP_START_FAILED（并记入 lastError） */
  async startServer(id: string): Promise<{ id: string; running: boolean; toolCount: number; lastError?: string }> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    this.syncFromSettings();
    const server = this.servers.get(id);
    if (server === undefined) {
      throw new ServerError("SERVER_NOT_FOUND", `mcp server "${id}" not found (PUT /api/mcp/servers 先配置)`, 404);
    }
    if (server.running) {
      return { id, running: true, toolCount: server.tools.length, ...(server.lastError !== null ? { lastError: server.lastError } : {}) };
    }
    try {
      const host = module.createHost({
        server: { id: server.spec.id, command: server.spec.command, args: server.spec.args, env: server.spec.env },
      });
      host.onEvent?.((event) => this.deps.hub.emit({ type: "server", message: this.describeHostEvent(server.spec.id, event) }));
      await host.start();
      const tools = await host.listTools();
      server.host = host;
      server.running = true;
      server.tools = tools;
      server.lastError = null;
      return { id, running: true, toolCount: tools.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      server.host = null;
      server.running = false;
      server.tools = [];
      server.lastError = message;
      throw new ServerError("MCP_START_FAILED", `mcp server "${id}" 启动失败：${message}`, 500);
    }
  }

  /** POST /api/mcp/servers/:id/stop：幂等；未知 → 404 */
  async stopServer(id: string): Promise<{ id: string; running: boolean }> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    this.syncFromSettings();
    const server = this.servers.get(id);
    if (server === undefined) {
      throw new ServerError("SERVER_NOT_FOUND", `mcp server "${id}" not found`, 404);
    }
    if (server.host !== null) {
      await Promise.resolve(server.host.stop()).catch((err: unknown) => {
        server.lastError = err instanceof Error ? err.message : String(err);
      });
    }
    server.host = null;
    server.running = false;
    server.tools = [];
    return { id, running: false };
  }

  /** GET /api/mcp/tools → 裸数组（运行中服务器聚合；白名单过滤，空 = 全部）；host 不可用 → 501 */
  async listTools(): Promise<McpAggregatedTool[]> {
    const module = await this.ensureModule();
    if (module === null) throw mcpUnavailable();
    return this.aggregatedTools();
  }

  /** 同步聚合（GatedRegistry 合并工具表用；模块未探测/无运行服务器 → 空数组） */
  aggregatedTools(): McpAggregatedTool[] {
    const out: McpAggregatedTool[] = [];
    for (const server of this.servers.values()) {
      if (!server.running) continue;
      for (const tool of server.tools) {
        if (server.spec.whitelist.length > 0 && !server.spec.whitelist.includes(tool.name)) continue;
        out.push({ serverId: server.spec.id, name: tool.name, description: tool.description, parameters: tool.parameters });
      }
    }
    return out;
  }

  /** mcp_<serverId>_<tool> → host.callTool 桥（白名单复检；结果与 VapToolResult 同形，不抛错） */
  async callTool(prefixedName: string, args: Record<string, unknown>): Promise<VapToolResult> {
    const stripped = prefixedName.startsWith("mcp_") ? prefixedName.slice("mcp_".length) : prefixedName;
    const sep = stripped.indexOf("_");
    if (sep <= 0) return { ok: false, error: `MCP_TOOL_NOT_FOUND: ${prefixedName}` };
    const serverId = stripped.slice(0, sep);
    const toolName = stripped.slice(sep + 1);
    const server = this.servers.get(serverId);
    if (server === undefined || !server.running || server.host === null) {
      return { ok: false, error: `MCP_SERVER_NOT_RUNNING: ${serverId}（POST /api/mcp/servers/${serverId}/start）` };
    }
    if (server.spec.whitelist.length > 0 && !server.spec.whitelist.includes(toolName)) {
      return { ok: false, error: `MCP_TOOL_NOT_WHITELISTED: ${toolName} 不在服务器 ${serverId} 白名单内` };
    }
    try {
      const result = await server.host.callTool(toolName, args, server.spec.timeoutMs);
      return { ok: result.ok, ...(result.data !== undefined ? { data: result.data } : {}), ...(result.error !== undefined ? { error: result.error } : {}) };
    } catch (err) {
      return { ok: false, error: `MCP_CALL_FAILED: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /** 全部停机（PUT / 测试重置用） */
  private async stopAll(): Promise<void> {
    for (const id of [...this.servers.keys()]) {
      await this.stopServer(id).catch(() => undefined);
    }
  }
}
