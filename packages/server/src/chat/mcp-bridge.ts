// MCP 桥（#53）：optional peer 消费 @videoos/mcp-host —— 包存在才点亮，不存在优雅降级。
// 职责：host 生命周期（按 settings.mcp.servers 启停）、工具聚合、统一调用入口、
//      orchestrator 工具表合并（settings.mcp.mergeTools）。
// 机制说明：
// - @videoos/mcp-host 是可选 peer：类型只做 type-only 静态导入（编译期擦除，不构成
//   运行时依赖），值（McpHost 类）在 start() 时 dynamic import —— 独立安装缺包时
//   detect() = false，全部方法降级为空/失败形状（app.ts 映射 501，UI 隐藏入口）。
// - host 为懒加载单例：start() 按“当前 settings”构建并拉起；stop() 丢弃实例；
//   restartIfConfigChanged() 以配置指纹（稳定 JSON）跟随 PUT /api/mcp/servers 变更。
// - 工具归属：McpHost.listTools() 的 HostToolInfo 自带 server 字段（host 内部路由表
//   精确归属），裸名与 "<server>.<name>" 冲突全名都能正确归位 —— 无需从前缀猜测。
// - 白名单双层：host 侧（start() 时烘焙进 allowedTools；exposed/裸名/全名三写法任一
//   命中即放行）+ 桥侧（按“当前 settings”的 whitelist 再过滤，覆盖“改了配置但尚未
//   restartIfConfigChanged”的窗口期）。
import type { HostLogEvent, HostToolInfo, McpHost, McpServerConfig } from "@videoos/mcp-host";
import type { McpServerEntry, SettingsStore } from "../settings";

/** MCP 工具摘要（面板清单 + orchestrator 合并视图） */
export interface McpToolSummary {
  /** host 暴露名（冲突时 "<server>.<name>"） */
  name: string;
  description: string;
  server: string;
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  toolCount: number;
  tools: McpToolSummary[];
}

export interface McpBridgeStatus {
  /** @videoos/mcp-host 可解析（false → 全部端点 501 + UI 入口隐藏） */
  available: boolean;
  /** host 已启动且至少一台 enabled 服务器 */
  running: boolean;
  servers: McpServerStatus[];
}

export interface McpToolDefinition {
  name: string;
  description: string;
  /** JSON Schema（host tools/list 透传） */
  parameters: Record<string, unknown>;
}

export interface McpCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** host 日志环容量（最近 N 条事件；跨 host 重启保留，供诊断与测试观察） */
const LOG_RING_CAPACITY = 50;

/** settings 条目 → host 服务器配置（whitelist 空 = 全部 → 省略 allowedTools） */
function toHostServerConfig(entry: McpServerEntry): McpServerConfig {
  return {
    command: entry.command,
    args: entry.args,
    env: entry.env,
    enabled: entry.enabled,
    timeoutMs: entry.timeoutMs,
    ...(entry.whitelist.length > 0 ? { allowedTools: entry.whitelist } : {}),
  };
}

/**
 * 配置指纹（restartIfConfigChanged 的比对基准）：稳定 JSON。
 * 排序规则：服务器名 / env 键 / 白名单成员（集合语义，顺序无关）；args 保序（命令行
 * 语义敏感，重排即不同命令）。键序不同但语义相同的配置 → 同指纹 → 不触发重启。
 */
function serversFingerprint(servers: Record<string, McpServerEntry>): string {
  const names = Object.keys(servers).sort();
  return JSON.stringify(
    names.map((name) => {
      const e = servers[name];
      return [
        name,
        e.command,
        e.args,
        Object.keys(e.env).sort().map((k) => [k, e.env[k]]),
        e.enabled,
        [...e.whitelist].sort(),
        e.timeoutMs,
      ] as const;
    }),
  );
}

export class McpBridge {
  private readonly settings: SettingsStore;
  /** 仅测试用：模拟“独立安装缺 @videoos/mcp-host”的降级路径 */
  private readonly forceUnavailable: boolean;
  private available: boolean | null = null;
  private host: McpHost | null = null;
  /** start() 成功时的配置指纹（restartIfConfigChanged 比对基准） */
  private startedFingerprint: string | null = null;
  /** 在飞的 start()（并发调用合并为一次；结束后清空以便 stop 后可再次拉起） */
  private startPromise: Promise<void> | null = null;
  /** host 日志环（工具调用 / spawn / 崩溃 / unhealthy） */
  private readonly logRing: string[] = [];
  /** 终态失败的服务器（spawn 失败不重试 / 重启预算耗尽 —— 来自 host log 事件） */
  private readonly deadServers = new Set<string>();

  constructor(options: { settings: SettingsStore; forceUnavailable?: boolean }) {
    this.settings = options.settings;
    this.forceUnavailable = options.forceUnavailable ?? false;
  }

  /** 探测 @videoos/mcp-host 可用性（结果缓存；import 失败 → false） */
  async detect(): Promise<boolean> {
    if (this.forceUnavailable) {
      this.available = false;
      return false;
    }
    if (this.available !== null) return this.available;
    try {
      // 值的唯一加载点：缺包时此处抛出 → 缓存 false（类型导入已编译期擦除，不参与）
      await import("@videoos/mcp-host");
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  /**
   * 全量状态（配置态 + host 运行态；绝不主动拉起进程 —— host.listTools 是纯内存快照）。
   * 每服务器 running/healthy 的诚实边界（host 公开面无逐服务器内省）：
   * - running = host 已启动 && enabled && 未见终态失败。归属到该服务器的工具必然 live
   *   （host.listTools 的 isLive 检查），但“工具全被白名单滤掉/服务器零工具”与“已崩溃”
   *   从外部无法区分 —— 以 log 事件的终态标记（"(spawn)" spawn 失败不重试、
   *   "(unhealthy)" 重启预算耗尽）兜底；崩溃-退避重启的短暂窗口（≤ 数百 ms）内可能
   *   短暂报旧值，重启完成即恢复。
   * - healthy = 未见终态失败（默认 true）。
   */
  async status(): Promise<McpBridgeStatus> {
    const available = await this.detect();
    if (!available) return { available: false, running: false, servers: [] };
    const mcp = this.settings.get().mcp;
    const hostStarted = this.host !== null;

    // 工具按 HostToolInfo.server 精确分组（已过 host 侧 + 桥级双层白名单）
    const grouped = new Map<string, McpToolSummary[]>();
    for (const t of this.liveHostTools()) {
      const list = grouped.get(t.server);
      if (list === undefined) grouped.set(t.server, [this.toSummary(t)]);
      else list.push(this.toSummary(t));
    }

    const anyEnabled = Object.values(mcp.servers).some((e) => e.enabled);
    const servers: McpServerStatus[] = Object.keys(mcp.servers)
      .sort()
      .map((name) => {
        const entry = mcp.servers[name];
        const dead = this.deadServers.has(name);
        const tools = grouped.get(name) ?? [];
        return {
          name,
          enabled: entry.enabled,
          running: hostStarted && entry.enabled && !dead,
          healthy: !dead,
          toolCount: tools.length,
          tools,
        };
      });
    return { available, running: hostStarted && anyEnabled, servers };
  }

  /** 拉起全部 enabled 服务器（不可用/已运行时 no-op；并发调用合并为一次） */
  async start(): Promise<void> {
    if (this.startPromise !== null) return this.startPromise;
    const run = this.doStart();
    this.startPromise = run;
    try {
      return await run;
    } finally {
      if (this.startPromise === run) this.startPromise = null;
    }
  }

  /** 停止 host（SIGTERM → 3s → SIGKILL 语义由 host 承担）；重复调用幂等。注：与 start() 并发交错属未定义（调用方按顺序使用） */
  async stop(): Promise<void> {
    const host = this.host;
    this.host = null;
    this.startedFingerprint = null;
    if (host !== null) await host.stop();
  }

  /**
   * 配置指纹变化时重启 host（app.ts 在 PUT /api/mcp/servers 之后调用）。
   * 从未启动过 → no-op（不自动拉起）；指纹未变 → no-op；变化 → stop() + start()。
   */
  async restartIfConfigChanged(): Promise<void> {
    if (this.host === null) return;
    const current = serversFingerprint(this.settings.get().mcp.servers);
    if (current === this.startedFingerprint) return;
    await this.stop();
    await this.start();
  }

  /** enabled + running 服务器的白名单内工具聚合（host 未启动 → []） */
  async listTools(): Promise<McpToolSummary[]> {
    return this.liveHostTools().map((t) => this.toSummary(t));
  }

  /** 按暴露名调用（白名单外/超时/进程异常 → { ok: false, error }，不抛出） */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    if (this.host === null) return { ok: false, error: "MCP_BRIDGE_NOT_RUNNING" };
    try {
      const res = await this.host.callTool(name, args);
      if (res.ok) return { ok: true, ...(res.data !== undefined ? { data: res.data } : {}) };
      return { ok: false, ...(res.error !== undefined ? { error: res.error } : {}) };
    } catch (err) {
      // host.callTool 自身不抛（超时/未知工具/死服务器都归一为 ok:false）；此处兜底意外异常
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * LLM 工具定义（mergeTools 开 + host 运行时非空，白名单内）。
   * 与 VAP 工具名的冲突过滤在 orchestrator（工具表合并处）做 —— 这里全量返回。
   */
  async toolDefinitions(): Promise<McpToolDefinition[]> {
    if (!this.settings.get().mcp.mergeTools) return [];
    return this.liveHostTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  /** 最近 host 日志（≤ 50 行：工具调用 / spawn / 崩溃 / unhealthy；跨 host 重启保留） */
  logs(): string[] {
    return [...this.logRing];
  }

  // ------------------------------------------------------------------ 内部

  private async doStart(): Promise<void> {
    if (!(await this.detect())) return; // 缺包 → no-op
    if (this.host !== null) return; // 已启动 → no-op
    const { McpHost: McpHostCtor } = await import("@videoos/mcp-host");
    const mcp = this.settings.get().mcp;
    const servers: Record<string, McpServerConfig> = {};
    for (const [name, entry] of Object.entries(mcp.servers)) servers[name] = toHostServerConfig(entry);
    const host = new McpHostCtor({ servers });
    // 订阅须在 host.start() 之前：spawn/初始化失败事件才能进日志环与 deadServers
    host.on("log", (e) => this.collectLog(e));
    this.deadServers.clear();
    try {
      await host.start();
    } catch (err) {
      // host.start() 理论不抛（spawn/初始化失败 → 标记 unhealthy）；防御性回滚，不留半启动状态
      this.startedFingerprint = null;
      try {
        await host.stop();
      } catch {
        // 尽力清理
      }
      throw err;
    }
    this.host = host;
    this.startedFingerprint = serversFingerprint(mcp.servers);
  }

  /** host 存活工具（已过 host 侧白名单）再过桥级白名单（当前 settings） */
  private liveHostTools(): HostToolInfo[] {
    if (this.host === null) return [];
    const servers = this.settings.get().mcp.servers;
    return this.host.listTools().filter((t) => this.whitelistAllows(servers[t.server], t.name, t.server));
  }

  /**
   * 桥级白名单判定（与 host.allowedFor 同语义三写法）：空 = 全部；
   * 否则 exposed / 裸名 / "<server>.<bare>" 全名任一命中即放行（冲突全名取裸部比对）。
   */
  private whitelistAllows(entry: McpServerEntry | undefined, exposed: string, server: string): boolean {
    if (entry === undefined) return false; // 配置已移除（restartIfConfigChanged 之前）→ 不再暴露
    if (entry.whitelist.length === 0) return true;
    const bare = exposed.startsWith(`${server}.`) ? exposed.slice(server.length + 1) : exposed;
    return entry.whitelist.includes(exposed) || entry.whitelist.includes(bare) || entry.whitelist.includes(`${server}.${bare}`);
  }

  private toSummary(t: HostToolInfo): McpToolSummary {
    return { name: t.name, description: t.description, server: t.server };
  }

  /** 日志环入列 + 终态失败标记（"(spawn)" 不重试 / "(unhealthy)" 预算耗尽） */
  private collectLog(e: HostLogEvent): void {
    const line = e.ok
      ? `${new Date().toISOString()} server=${e.server} tool=${e.tool} ok ${e.ms}ms`
      : `${new Date().toISOString()} server=${e.server} tool=${e.tool} fail ${e.ms}ms error=${e.error ?? ""}`;
    this.logRing.push(line);
    while (this.logRing.length > LOG_RING_CAPACITY) this.logRing.shift();
    if (!e.ok && (e.tool === "(spawn)" || e.tool === "(unhealthy)")) this.deadServers.add(e.server);
  }
}
