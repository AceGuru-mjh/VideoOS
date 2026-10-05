// @videoos/mcp-host —— MCP 客户端宿主（agent-kit SPEC §3.4 冻结契约的实现）。
// 关键设计点：
//   1. 每个子服务器一个 node:child_process 进程 + 独立行缓冲读取器；响应按全局自增 JSON-RPC id 分发，
//      因此并发的 tools/call 互不串线，超时后迟到的响应按 id 直接丢弃（不杀进程）。
//   2. 工具聚合：同名工具冲突时冲突者以 "<server>.<name>" 全名暴露；callTool 同时接受原名与全名。
//   3. 崩溃重启：非 stop() 引发的退出 → 指数退避重启（restartBackoff × 2^n），
//      上限 MAX_RESTARTS_PER_WINDOW 次 / RESTART_WINDOW_MS 滚动窗口；超限标记 unhealthy 并从 listTools 排除。
import { spawn, type ChildProcess } from "node:child_process";
import {
  LATEST_PROTOCOL_VERSION,
  parseLine,
  type JsonRpcMessage,
  type JsonRpcResponse,
} from "@videoos/mcp-lite";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_BACKOFF_MS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_RESTARTS_PER_WINDOW,
  RESTART_WINDOW_MS,
  STOP_GRACE_MS,
  type McpHostConfig,
  type McpServerConfig,
} from "./config";

/** callTool 返回形状（ok 时 data 为工具 JSON 结果；失败时 error 人类可读） */
export interface ToolCallResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** listTools 条目：name 为暴露名（不冲突用原名，冲突用 "<server>.<name>"） */
export interface ListedTool {
  server: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** "log" 事件载荷：工具调用即 SPEC 冻结形状；生命周期事件（tool:""）多一个可选 message 字段 */
export interface HostLogEvent {
  server: string;
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
  message?: string;
}

export type HostLogCallback = (event: HostLogEvent) => void;

/** inspect() 条目：进程/握手/重启的实时观测（SPEC 冻结面之外的内省，测试与诊断用） */
export interface ServerStatus {
  server: string;
  running: boolean;
  pid: number | undefined;
  exitCode: number | null;
  signalCode: string | null;
  ready: boolean;
  unhealthy: boolean;
  restarts: number;
  toolCount: number;
}

/** tools/list 返回的原始工具形状 */
interface RawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** 构造器归一化后的服务器配置（全部字段有默认值） */
interface NormalizedServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  timeoutMs: number;
  allowedTools: string[] | undefined;
}

/** 单服务器运行时状态 */
interface ServerEntry {
  name: string;
  config: NormalizedServerConfig;
  child: ChildProcess | null;
  /** 当前 child 是否已退出（child 句柄保留以便读取 exitCode） */
  exited: boolean;
  exitPromise: Promise<void> | null;
  resolveExit: (() => void) | null;
  /** 每次 spawn 自增；旧 child 的 exit/error 回调凭此失效 */
  spawnGeneration: number;
  ready: boolean;
  unhealthy: boolean;
  tools: RawTool[];
  /** 滚动窗口内的重启时间戳 */
  restarts: number[];
  restartTimer: ReturnType<typeof setTimeout> | null;
  /** stop() 已对本服务器发起（退出不计入重启） */
  stopping: boolean;
  /** 最近一段 stderr（诊断意外退出用） */
  lastStderr: string;
}

/** 聚合后的工具绑定：originalName 是服务器侧名字，exposedName 是对外暴露名 */
interface ToolBinding {
  server: string;
  originalName: string;
  exposedName: string;
  description: string;
  parameters: Record<string, unknown>;
  allowed: boolean;
}

/** 内部请求（initialize / tools/list / tools/call）的统一结果：永不 reject */
type RequestResult = { ok: true; response: JsonRpcResponse } | { ok: false; error: string };

interface PendingRequest {
  server: string;
  id: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  finish: (result: RequestResult) => void;
}

/** 行缓冲读取器：stdout chunk → 完整行（\n 分隔，容忍 \r\n 与空行） */
class LineReader {
  private buffer = "";
  private closed = false;

  constructor(private readonly onLine: (line: string) => void) {}

  push(chunk: string): void {
    if (this.closed) return;
    this.buffer += chunk;
    let nl = this.buffer.indexOf("\n");
    while (nl >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim().length > 0) this.onLine(line);
      nl = this.buffer.indexOf("\n");
    }
  }
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 重启退避定时器不阻塞进程退出（CI 防挂保险；测试事件循环存活期间照常触发） */
function detachTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * MCP 客户端宿主：拉起多个 stdio MCP 子服务器，聚合它们的工具并统一调用。
 *
 * 用法：
 *   const host = new McpHost(await loadHostConfig("mcp.json"));
 *   host.on("log", (e) => console.error(e));
 *   await host.start();
 *   host.listTools();
 *   await host.callTool("time.now", { timeZone: "Asia/Shanghai" });
 *   await host.stop();   // 幂等
 */
export class McpHost {
  private readonly entries = new Map<string, ServerEntry>();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly logListeners: HostLogCallback[] = [];
  private readonly restartBackoffMs: number;
  private requestSeq = 0;
  private toolBindings: ToolBinding[] = [];
  private toolLookup = new Map<string, ToolBinding>();
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(config: McpHostConfig) {
    if (config === null || typeof config !== "object") {
      throw new Error("McpHost: config must be an object");
    }
    const backoff = config.restartBackoff;
    this.restartBackoffMs =
      typeof backoff === "number" && Number.isFinite(backoff) && backoff > 0
        ? backoff
        : DEFAULT_RESTART_BACKOFF_MS;
    for (const [name, raw] of Object.entries(config.servers ?? {})) {
      const server = raw as McpServerConfig | null | undefined;
      if (server === null || server === undefined || typeof server !== "object") {
        throw new Error(`McpHost: servers.${name} must be an object`);
      }
      if (typeof server.command !== "string" || server.command.length === 0) {
        throw new Error(`McpHost: servers.${name}.command must be a non-empty string`);
      }
      if (!Array.isArray(server.args) || server.args.some((a) => typeof a !== "string")) {
        throw new Error(`McpHost: servers.${name}.args must be an array of strings`);
      }
      this.entries.set(name, {
        name,
        config: {
          command: server.command,
          args: [...server.args],
          env: { ...(server.env ?? {}) },
          enabled: server.enabled ?? true,
          timeoutMs: server.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
          allowedTools: server.allowedTools === undefined ? undefined : [...server.allowedTools],
        },
        child: null,
        exited: true,
        exitPromise: null,
        resolveExit: null,
        spawnGeneration: 0,
        ready: false,
        unhealthy: false,
        tools: [],
        restarts: [],
        restartTimer: null,
        stopping: false,
        lastStderr: "",
      });
    }
  }

  /** 注册事件监听（当前仅 "log"：每次 callTool 与服务器生命周期事件） */
  on(event: "log", cb: HostLogCallback): void {
    if (event !== "log") {
      throw new Error(`McpHost.on: unknown event ${JSON.stringify(event)} (only "log" is supported)`);
    }
    this.logListeners.push(cb);
  }

  /** 依次 spawn 全部 enabled 服务器并完成 initialize 握手 + tools/list；单服务器失败不阻断其余（记 log，走重启/不健康路径） */
  async start(): Promise<void> {
    if (this.stopPromise !== null) throw new Error("McpHost: already stopped");
    if (this.startPromise !== null) return this.startPromise;
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.config.enabled === false) {
        this.emitLog({ server: entry.name, tool: "", ok: true, ms: 0, message: "skipped: enabled=false" });
        continue;
      }
      try {
        await this.launch(entry);
      } catch (error) {
        this.emitLog({
          server: entry.name,
          tool: "",
          ok: false,
          ms: 0,
          error: `launch failed: ${errText(error)}`,
        });
      }
    }
  }

  /** 停止全部子进程：SIGTERM → 等 exit（STOP_GRACE_MS 内未退则 SIGKILL）；幂等，重复调用返回同一 Promise */
  async stop(): Promise<void> {
    if (this.stopPromise !== null) return this.stopPromise;
    this.stopPromise = this.doStop();
    return this.stopPromise;
  }

  private async doStop(): Promise<void> {
    this.stopped = true;
    const waits: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      entry.stopping = true;
      if (entry.restartTimer !== null) {
        clearTimeout(entry.restartTimer);
        entry.restartTimer = null;
      }
      const child = entry.child;
      if (child !== null && !entry.exited) {
        waits.push(this.terminate(child, entry.exitPromise ?? Promise.resolve()));
      }
    }
    await Promise.all(waits);
    // 兜底：任何残留 pending（理论上已被各 exit 处理器清空）
    for (const pending of [...this.pending.values()]) {
      pending.finish({ ok: false, error: "McpHost stopped" });
    }
  }

  private async terminate(child: ChildProcess, exited: Promise<void>): Promise<void> {
    const kill = (signal: NodeJS.Signals): void => {
      try {
        child.kill(signal);
      } catch {
        // 已死亡：忽略
      }
    };
    kill("SIGTERM");
    const killTimer = setTimeout(() => kill("SIGKILL"), STOP_GRACE_MS);
    try {
      await exited;
    } finally {
      clearTimeout(killTimer);
    }
  }

  /** 聚合全部健康服务器的工具（allowedTools 过滤后）；name 为暴露名（冲突时为 "<server>.<name>"） */
  listTools(): ListedTool[] {
    return this.toolBindings
      .filter((binding) => binding.allowed)
      .map((binding) => ({
        server: binding.server,
        name: binding.exposedName,
        description: binding.description,
        parameters: binding.parameters,
      }));
  }

  /**
   * 调用工具：接受原名与 "<server>.<name>" 全名两种写法。
   * 未知工具 → "TOOL_NOT_FOUND: …"；白名单之外 → "tool not allowed: …"；超时 → "timeout after Nms"（不杀进程）。
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const started = Date.now();
    const binding = this.toolLookup.get(name);
    if (binding === undefined) {
      const error = `TOOL_NOT_FOUND: ${name} (available: ${this.availableToolNames()})`;
      this.emitLog({ server: "", tool: name, ok: false, ms: 0, error });
      return { ok: false, error };
    }
    if (!binding.allowed) {
      const error = `tool not allowed: ${name}`;
      this.emitLog({ server: binding.server, tool: binding.exposedName, ok: false, ms: 0, error });
      return { ok: false, error };
    }
    const entry = this.entries.get(binding.server);
    if (entry === undefined) {
      const error = `TOOL_NOT_FOUND: ${name} (server "${binding.server}" is gone)`;
      this.emitLog({ server: binding.server, tool: binding.exposedName, ok: false, ms: 0, error });
      return { ok: false, error };
    }
    const timeoutMs = entry.config.timeoutMs;
    const result = await this.sendRequest(
      entry,
      "tools/call",
      { name: binding.originalName, arguments: args },
      timeoutMs,
    );
    const ms = Date.now() - started;
    if (!result.ok) {
      this.emitLog({ server: binding.server, tool: binding.exposedName, ok: false, ms, error: result.error });
      return { ok: false, error: result.error };
    }
    const response = result.response;
    if (response.error !== undefined) {
      const error = `JSON-RPC ${response.error.code}: ${response.error.message}`;
      this.emitLog({ server: binding.server, tool: binding.exposedName, ok: false, ms, error });
      return { ok: false, error };
    }
    const payload = (response.result ?? {}) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    const text = payload.content?.[0]?.text ?? "";
    if (payload.isError === true) {
      this.emitLog({ server: binding.server, tool: binding.exposedName, ok: false, ms, error: text });
      return { ok: false, error: text };
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    this.emitLog({ server: binding.server, tool: binding.exposedName, ok: true, ms });
    return { ok: true, data };
  }

  /** 服务器运行状态观测（测试/诊断用；SPEC 冻结面之外的内省接口） */
  inspect(): ServerStatus[] {
    return [...this.entries.values()].map((entry) => ({
      server: entry.name,
      running: entry.child !== null && !entry.exited,
      pid: entry.child?.pid,
      exitCode: entry.child?.exitCode ?? null,
      signalCode: entry.child?.signalCode ?? null,
      ready: entry.ready,
      unhealthy: entry.unhealthy,
      restarts: entry.restarts.length,
      toolCount: entry.tools.length,
    }));
  }

  // ---------------- 内部：进程生命周期 ----------------

  /** spawn 一个服务器并完成握手；握手失败但进程仍存活时杀掉（交给 exit 处理器走重启路径） */
  private async launch(entry: ServerEntry): Promise<void> {
    if (this.stopped || entry.stopping) return;
    const generation = ++entry.spawnGeneration;
    entry.exited = false;
    entry.ready = false;
    entry.tools = [];
    entry.lastStderr = "";

    let child: ChildProcess;
    try {
      child = spawn(entry.config.command, entry.config.args, {
        env: { ...process.env, ...entry.config.env } as Record<string, string>,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      entry.exited = true;
      entry.child = null;
      this.emitLog({
        server: entry.name,
        tool: "",
        ok: false,
        ms: 0,
        error: `spawn failed: ${errText(error)}`,
      });
      this.scheduleRestart(entry);
      return;
    }
    entry.child = child;

    // 流错误（EPIPE 等）一律静默：进程退出统一由 exit/error 事件处理，避免未捕获异常炸宿主
    child.stdin?.on("error", () => {});
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      entry.lastStderr = (entry.lastStderr + chunk).slice(-2_000);
    });

    entry.exitPromise = new Promise<void>((resolve) => {
      entry.resolveExit = resolve;
    });

    // 每服务器独立行缓冲读取器：响应按全局自增 id 分发（并发调用互不串线）
    const reader = new LineReader((line) => {
      let message: JsonRpcMessage;
      try {
        message = parseLine(line);
      } catch {
        return; // 服务器输出的坏 JSON 行：丢弃
      }
      this.dispatch(message);
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => reader.push(chunk));

    child.on("exit", (code, signal) => {
      this.onProcessGone(entry, generation, `code=${code ?? "null"} signal=${signal ?? "none"}`);
    });
    child.on("error", (error) => {
      this.onProcessGone(entry, generation, `spawn error: ${error.message}`);
    });

    const ready = await this.handshake(entry);
    if (!ready && !entry.exited && entry.child === child) {
      // 进程活着但握手失败（超时/被拒）→ 强杀，统一走 exit → 重启/不健康路径
      try {
        child.kill("SIGKILL");
      } catch {
        // 已死亡：忽略
      }
    }
  }

  /** 进程退出 / spawn 失败的统一入口（generation 防旧 child 回调串扰） */
  private onProcessGone(entry: ServerEntry, generation: number, reason: string): void {
    if (generation !== entry.spawnGeneration || entry.exited) return;
    entry.exited = true;
    entry.resolveExit?.();
    this.failPendingFor(entry.name, `server "${entry.name}" exited before responding (${reason})`);
    entry.ready = false;
    entry.tools = [];
    this.rebuildRegistry();
    if (entry.stopping || this.stopped) return; // stop() 引发：不计入重启
    const stderr = entry.lastStderr.trim();
    const note = stderr.length > 0 ? `; stderr: ${stderr.slice(-300)}` : "";
    this.emitLog({
      server: entry.name,
      tool: "",
      ok: false,
      ms: 0,
      error: `server exited unexpectedly (${reason})${note}`,
    });
    this.scheduleRestart(entry);
  }

  /** 指数退避重启；超过 MAX_RESTARTS_PER_WINDOW/RESTART_WINDOW_MS 则标记 unhealthy 并从 listTools 排除 */
  private scheduleRestart(entry: ServerEntry): void {
    if (entry.stopping || this.stopped || entry.unhealthy) return;
    const now = Date.now();
    entry.restarts = entry.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (entry.restarts.length >= MAX_RESTARTS_PER_WINDOW) {
      entry.unhealthy = true;
      this.rebuildRegistry();
      this.emitLog({
        server: entry.name,
        tool: "",
        ok: false,
        ms: 0,
        error: `server unhealthy: ${MAX_RESTARTS_PER_WINDOW} restarts within ${RESTART_WINDOW_MS}ms; excluded from listTools`,
      });
      return;
    }
    const attempt = entry.restarts.length + 1;
    const delay = this.restartBackoffMs * 2 ** entry.restarts.length;
    const timer = setTimeout(() => {
      entry.restartTimer = null;
      if (entry.stopping || this.stopped || entry.unhealthy) return;
      entry.restarts.push(Date.now());
      this.emitLog({
        server: entry.name,
        tool: "",
        ok: true,
        ms: 0,
        message: `restarting (attempt ${attempt}/${MAX_RESTARTS_PER_WINDOW} per ${RESTART_WINDOW_MS}ms window, backoff ${delay}ms)`,
      });
      void this.launch(entry);
    }, delay);
    detachTimer(timer);
    entry.restartTimer = timer;
  }

  /** initialize → notifications/initialized → tools/list；任一步失败返回 false */
  private async handshake(entry: ServerEntry): Promise<boolean> {
    const started = Date.now();
    const fail = (reason: string): false => {
      this.emitLog({
        server: entry.name,
        tool: "",
        ok: false,
        ms: Date.now() - started,
        error: `handshake failed: ${reason}`,
      });
      return false;
    };
    const init = await this.sendRequest(
      entry,
      "initialize",
      {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "@videoos/mcp-host", version: "0.1.0" },
      },
      HANDSHAKE_TIMEOUT_MS,
    );
    if (!init.ok) return fail(init.error);
    if (init.response.error !== undefined) {
      return fail(`initialize rejected: ${init.response.error.code} ${init.response.error.message}`);
    }
    const initResult = init.response.result as { protocolVersion?: unknown } | null | undefined;
    if (initResult === null || initResult === undefined || typeof initResult !== "object") {
      return fail("initialize result malformed");
    }
    if (!this.writeNotification(entry, "notifications/initialized")) {
      return fail("stdin closed before notifications/initialized");
    }
    const list = await this.sendRequest(entry, "tools/list", {}, HANDSHAKE_TIMEOUT_MS);
    if (!list.ok) return fail(list.error);
    if (list.response.error !== undefined) {
      return fail(`tools/list rejected: ${list.response.error.code} ${list.response.error.message}`);
    }
    const listResult = list.response.result as { tools?: unknown } | null | undefined;
    if (listResult === null || listResult === undefined || typeof listResult !== "object" || !Array.isArray(listResult.tools)) {
      return fail("tools/list result malformed");
    }
    const tools: RawTool[] = [];
    for (const item of listResult.tools) {
      const tool = item as { name?: unknown; description?: unknown; inputSchema?: unknown } | null;
      if (tool === null || typeof tool !== "object" || typeof tool.name !== "string") continue;
      tools.push({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema:
          tool.inputSchema !== null && typeof tool.inputSchema === "object"
            ? (tool.inputSchema as Record<string, unknown>)
            : {},
      });
    }
    entry.tools = tools;
    entry.ready = true;
    this.rebuildRegistry();
    this.emitLog({
      server: entry.name,
      tool: "",
      ok: true,
      ms: Date.now() - started,
      message: `ready (${tools.length} tools, protocol ${String(initResult.protocolVersion ?? "?")})`,
    });
    return true;
  }

  // ---------------- 内部：请求/响应管线 ----------------

  /** 发送 JSON-RPC 请求并等响应；永不 reject（超时 / 进程退出 / 写失败 → {ok:false,error}） */
  private sendRequest(
    entry: ServerEntry,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<RequestResult> {
    return new Promise<RequestResult>((resolve) => {
      const child = entry.child;
      if (this.stopped || entry.stopping || child === null || entry.exited) {
        resolve({ ok: false, error: `server "${entry.name}" is not running` });
        return;
      }
      const id = ++this.requestSeq;
      const pending: PendingRequest = {
        server: entry.name,
        id,
        settled: false,
        timer: null,
        finish: (result: RequestResult): void => {
          if (pending.settled) return;
          pending.settled = true;
          if (pending.timer !== null) clearTimeout(pending.timer);
          this.pending.delete(id);
          resolve(result);
        },
      };
      pending.timer = setTimeout(() => {
        pending.finish({ ok: false, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      this.pending.set(id, pending);
      const message = { jsonrpc: "2.0" as const, id, method, ...(params !== undefined ? { params } : {}) };
      try {
        child.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        pending.finish({ ok: false, error: `write to server "${entry.name}" failed: ${errText(error)}` });
      }
    });
  }

  /** 写通知（无 id，不期待响应）；成功返回 true */
  private writeNotification(entry: ServerEntry, method: string): boolean {
    const child = entry.child;
    if (child === null || entry.exited || this.stopped || entry.stopping) return false;
    try {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
      return true;
    } catch {
      return false;
    }
  }

  /** 响应按 id 路由；迟到的响应（超时后）与服务器→客户端通知/请求一律忽略 */
  private dispatch(message: JsonRpcMessage): void {
    const probe = message as { method?: unknown; id?: unknown };
    if (probe.method !== undefined) return;
    const id = probe.id;
    if (typeof id !== "number") return; // 本宿主只发出数字 id；字符串/null id 的响应无从归属
    const pending = this.pending.get(id);
    if (pending === undefined) return; // 超时后迟到的响应：按 id 丢弃
    pending.finish({ ok: true, response: message as JsonRpcResponse });
  }

  /** 某服务器退出时，失败其全部未决请求 */
  private failPendingFor(server: string, error: string): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.server === server) pending.finish({ ok: false, error });
    }
  }

  // ---------------- 内部：工具聚合 ----------------

  /** 重建工具注册表：合并全部 ready 且非 unhealthy 的服务器；同名冲突 → 全名暴露 */
  private rebuildRegistry(): void {
    const bindings: ToolBinding[] = [];
    const byOriginal = new Map<string, ToolBinding[]>();
    for (const entry of this.entries.values()) {
      if (!entry.ready || entry.unhealthy) continue;
      const allowedTools = entry.config.allowedTools;
      for (const tool of entry.tools) {
        const binding: ToolBinding = {
          server: entry.name,
          originalName: tool.name,
          exposedName: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          allowed:
            allowedTools === undefined ||
            allowedTools.includes(tool.name) ||
            allowedTools.includes(`${entry.name}.${tool.name}`),
        };
        bindings.push(binding);
        const bucket = byOriginal.get(tool.name);
        if (bucket === undefined) byOriginal.set(tool.name, [binding]);
        else bucket.push(binding);
      }
    }
    for (const bucket of byOriginal.values()) {
      if (bucket.length > 1) {
        for (const binding of bucket) binding.exposedName = `${binding.server}.${binding.originalName}`;
      }
    }
    const lookup = new Map<string, ToolBinding>();
    for (const binding of bindings) {
      lookup.set(binding.exposedName, binding); // 暴露名（原名或全名）
      const qualified = `${binding.server}.${binding.originalName}`;
      if (!lookup.has(qualified)) lookup.set(qualified, binding); // 全名始终可寻址
    }
    // 冲突工具的原名仍可调用：路由到配置顺序中的第一个提供者（宽容策略）
    for (const [original, bucket] of byOriginal) {
      if (bucket.length > 1 && !lookup.has(original)) lookup.set(original, bucket[0]!);
    }
    this.toolBindings = bindings;
    this.toolLookup = lookup;
  }

  private availableToolNames(): string {
    const names = this.toolBindings
      .filter((binding) => binding.allowed)
      .map((binding) => binding.exposedName)
      .sort();
    const shown = names.slice(0, 30);
    return shown.length < names.length ? `${shown.join(", ")}, ...` : shown.join(", ");
  }

  private emitLog(event: HostLogEvent): void {
    for (const callback of [...this.logListeners]) {
      try {
        callback(event);
      } catch {
        // 监听器异常不得影响宿主
      }
    }
  }
}
