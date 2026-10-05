// McpHost 客户端宿主（SPEC §3.4）：拉起服务器子进程、聚合工具、统一调用、崩溃自愈。
// - start(): 依次 spawn + initialize + notifications/initialized + tools/list
// - callTool(): 工具名冲突时以 "<server>.<name>" 全名暴露，接受全名与（无歧义时的）裸名
// - 超时：杀本次请求不杀进程（返回 timeout after Nms）
// - 自愈：进程意外退出 → 指数退避重启（300ms ×2，上限 5s；3 次/分钟，超过标记 unhealthy）
// - stop(): SIGTERM → 3s → SIGKILL；stop 后无孤儿进程
import { createLineBuffer, errorResponse, JsonRpcErrorCodes, resultResponse } from "@videoos/mcp-lite";
import type { JsonRpcResponse } from "@videoos/mcp-lite";
import { parseHostConfig } from "./config";
import type { HostLogEvent, HostToolInfo, HostToolResult, McpHostConfig, McpServerConfig } from "./types";

const DEFAULT_TIMEOUT_MS = 30_000;
const RESTART_BACKOFF_BASE_MS = 300;
const RESTART_BACKOFF_CAP_MS = 5_000;
const RESTART_WINDOW_MS = 60_000;
const RESTART_MAX_PER_WINDOW = 3;
const STOP_GRACE_MS = 3_000;

interface PendingRequest {
  resolve: (res: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RemoteTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ServerState {
  name: string;
  cfg: McpServerConfig;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null;
  running: boolean;
  healthy: boolean;
  tools: RemoteTool[];
  pending: Map<number, PendingRequest>;
  nextId: number;
  /** 滚动 60s 窗口内的重启尝试时间戳 */
  restarts: number[];
  stopping: boolean;
  backoffTimer: ReturnType<typeof setTimeout> | null;
  stderrTail: string[];
}

/** 路由表：exposedName → { server, raw }；rawName → owners[] */
interface RoutingTable {
  byExposed: Map<string, { server: string; raw: string }>;
  byRaw: Map<string, Array<{ server: string; raw: string }>>;
}

export class McpHost {
  private readonly servers = new Map<string, ServerState>();
  private readonly logCallbacks: Array<(e: HostLogEvent) => void> = [];
  private routing: RoutingTable = { byExposed: new Map(), byRaw: new Map() };
  private started = false;

  constructor(config: McpHostConfig) {
    const normalized = parseHostConfig(config);
    for (const [name, cfg] of Object.entries(normalized.servers)) {
      this.servers.set(name, {
        name,
        cfg,
        proc: null,
        running: false,
        healthy: true,
        tools: [],
        pending: new Map(),
        nextId: 1,
        restarts: [],
        stopping: false,
        backoffTimer: null,
        stderrTail: [],
      });
    }
  }

  // ------------------------------------------------------------------ 生命周期

  /** 依次拉起全部 enabled 服务器（spawn 失败/初始化失败 → 标记 unhealthy，不抛出） */
  async start(): Promise<void> {
    this.started = true;
    for (const state of this.servers.values()) {
      if (state.cfg.enabled === false) continue;
      if (state.running) continue;
      await this.spawnOne(state);
    }
    this.rebuildRouting();
  }

  /** SIGTERM → 3s → SIGKILL；清理全部计时器与挂起请求 */
  async stop(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const state of this.servers.values()) {
      state.stopping = true;
      if (state.backoffTimer !== null) {
        clearTimeout(state.backoffTimer);
        state.backoffTimer = null;
      }
      if (state.proc !== null) stops.push(this.stopOne(state));
      else this.failPending(state, new Error("host stopped"));
    }
    await Promise.all(stops);
    this.routing = { byExposed: new Map(), byRaw: new Map() };
  }

  private async stopOne(state: ServerState): Promise<void> {
    const proc = state.proc;
    state.proc = null;
    state.running = false;
    if (proc === null) return;
    this.failPending(state, new Error(`server "${state.name}" stopped`));
    try {
      proc.kill(); // SIGTERM
    } catch {
      // already dead
    }
    const grace = new Promise<void>((resolve) => setTimeout(resolve, STOP_GRACE_MS));
    const exited = Promise.resolve(proc.exited).then(() => undefined);
    await Promise.race([exited, grace]);
    try {
      proc.kill(9); // SIGKILL（已退出时无害）
    } catch {
      // already dead
    }
    await exited;
  }

  // ------------------------------------------------------------------ 工具面

  listTools(): HostToolInfo[] {
    const out: HostToolInfo[] = [];
    for (const [exposed, target] of this.routing.byExposed) {
      const state = this.servers.get(target.server);
      if (state === undefined || !this.isLive(state)) continue;
      const tool = state.tools.find((t) => t.name === target.raw);
      if (tool === undefined) continue;
      if (!this.allowedFor(state, exposed, tool.name)) continue;
      out.push({ server: target.server, name: exposed, description: tool.description, parameters: tool.parameters });
    }
    return out;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<HostToolResult> {
    const target = this.resolveTool(name);
    if (target === undefined) {
      return { ok: false, error: `unknown tool: ${name} (call listTools() to enumerate)` };
    }
    if ("ambiguous" in target) {
      return { ok: false, error: `ambiguous tool name "${name}" — use the qualified form: ${target.options.join(" / ")}` };
    }
    if ("dead" in target) {
      return { ok: false, error: `server "${target.server}" is not running (unhealthy or stopped)` };
    }
    const { server, raw } = target;
    const state = this.servers.get(server);
    if (state === undefined || !this.isLive(state)) {
      return { ok: false, error: `server "${server}" is not running (unhealthy or stopped)` };
    }
    // 白名单（exposed / 裸名 / 全名 三种写法都认）
    if (!this.allowedFor(state, name, raw)) {
      return { ok: false, error: `tool "${raw}" is not in the allowedTools whitelist of server "${server}"` };
    }

    const started = Date.now();
    let outcome: HostToolResult;
    try {
      const res = await this.rpc(state, "tools/call", { name: raw, arguments: args });
      if (res.error !== undefined) {
        outcome = { ok: false, error: `${res.error.code}: ${res.error.message}` };
      } else {
        const r = res.result as { ok?: boolean; data?: unknown; error?: string } | undefined;
        outcome =
          r === undefined
            ? { ok: false, error: "empty tools/call result" }
            : r.ok === true
              ? { ok: true, ...(r.data !== undefined ? { data: r.data } : {}) }
              : { ok: false, ...(r.error !== undefined ? { error: r.error } : {}) };
      }
    } catch (err) {
      outcome = { ok: false, error: (err as Error).message };
    }
    const ms = Date.now() - started;
    this.emitLog({ server, tool: raw, ok: outcome.ok, ms, ...(outcome.ok ? {} : { error: outcome.error ?? "tool failed" }) });
    return outcome;
  }

  /** 日志事件订阅（工具调用 / 崩溃重启） */
  on(event: "log", cb: (e: HostLogEvent) => void): void {
    if (event !== "log") throw new Error(`unknown event: ${event} (only "log" is supported)`);
    this.logCallbacks.push(cb);
  }

  // ------------------------------------------------------------------ 内部：进程与 RPC

  private isLive(state: ServerState): boolean {
    return state.cfg.enabled !== false && state.healthy && state.running && state.proc !== null;
  }

  /** 白名单判定：exposed / 裸名 / <server>.<name> 全名任一命中即放行；无白名单 = 全部放行 */
  private allowedFor(state: ServerState, exposed: string, raw: string): boolean {
    if (state.cfg.allowedTools === undefined) return true;
    return (
      state.cfg.allowedTools.includes(exposed) ||
      state.cfg.allowedTools.includes(raw) ||
      state.cfg.allowedTools.includes(`${state.name}.${raw}`)
    );
  }

  /** 解析工具名：全名精确 > 裸名唯一存活 > 裸名歧义 > 已知但服务器已死 > 未知 */
  private resolveTool(
    name: string,
  ): { server: string; raw: string } | { ambiguous: true; options: string[] } | { dead: true; server: string } | undefined {
    const live = (server: string): boolean => {
      const s = this.servers.get(server);
      return s !== undefined && this.isLive(s);
    };
    const exposed = this.routing.byExposed.get(name);
    if (exposed !== undefined && live(exposed.server)) return exposed;
    const owners = this.routing.byRaw.get(name) ?? [];
    const liveOwners = owners.filter((o) => live(o.server));
    if (liveOwners.length === 1) return liveOwners[0];
    if (liveOwners.length > 1) {
      return { ambiguous: true, options: liveOwners.map((t) => `${t.server}.${t.raw}`) };
    }
    if (owners.length > 0) return { dead: true, server: owners[0].server };
    return undefined;
  }

  /** 冲突感知重建路由表：byRaw 含全部已知工具（死活都算，供 dead 检测）；byExposed 仅存活拓扑（同名 → <server>.<name>） */
  private rebuildRouting(): void {
    const byRaw = new Map<string, Array<{ server: string; raw: string }>>();
    for (const state of this.servers.values()) {
      if (state.tools.length === 0) continue;
      for (const tool of state.tools) {
        const list = byRaw.get(tool.name) ?? [];
        list.push({ server: state.name, raw: tool.name });
        byRaw.set(tool.name, list);
      }
    }
    const byExposed = new Map<string, { server: string; raw: string }>();
    for (const [raw, owners] of byRaw) {
      for (const owner of owners) {
        if (!this.isLive(this.servers.get(owner.server) as ServerState)) continue;
        const liveSameName = owners.filter((o) => this.isLive(this.servers.get(o.server) as ServerState));
        const exposed = liveSameName.length > 1 ? `${owner.server}.${owner.raw}` : owner.raw;
        byExposed.set(exposed, owner);
      }
    }
    this.routing = { byExposed, byRaw };
  }

  private emitLog(e: HostLogEvent): void {
    for (const cb of this.logCallbacks) {
      try {
        cb(e);
      } catch {
        // 订阅方异常不影响宿主
      }
    }
  }

  private failPending(state: ServerState, err: Error): void {
    for (const [, p] of state.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    state.pending.clear();
  }

  /** 发送请求并等待响应（超时 → 杀本次不杀进程） */
  private rpc<T = JsonRpcResponse>(state: ServerState, method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const proc = state.proc;
    if (proc === null) {
      return Promise.reject(new Error(`server "${state.name}" is not running`)) as Promise<T>;
    }
    const id = state.nextId++;
    const timeout = timeoutMs ?? state.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error(`timeout after ${timeout}ms`));
      }, timeout);
      state.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          state.pending.delete(id);
          resolve(res as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          state.pending.delete(id);
          reject(err);
        },
        timer,
      });
      try {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) })}\n`);
      } catch (err) {
        const p = state.pending.get(id);
        if (p !== undefined) {
          clearTimeout(p.timer);
          state.pending.delete(id);
        }
        reject(new Error(`write to server "${state.name}" failed: ${(err as Error).message}`));
      }
    });
  }

  /** 拉起单个服务器：spawn → initialize → initialized 通知 → tools/list */
  private async spawnOne(state: ServerState): Promise<boolean> {
    state.stopping = false;
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn({
        cmd: [state.cfg.command, ...state.cfg.args],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...(state.cfg.env ?? {}) },
      });
    } catch (err) {
      state.healthy = false;
      state.running = false;
      state.proc = null;
      this.emitLog({ server: state.name, tool: "(spawn)", ok: false, ms: 0, error: `spawn failed: ${(err as Error).message}` });
      return false;
    }
    state.proc = proc;
    state.running = true;
    state.healthy = true;
    this.pumpStdout(state, proc);
    this.pumpStderr(state, proc);
    void proc.exited.then((code) => this.onExit(state, code)).catch(() => this.onExit(state, -1));

    try {
      const init = await this.rpc(state, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp-host", version: "0.1.0" } });
      if (init.error !== undefined) throw new Error(`initialize rejected: ${init.error.message}`);
      // notifications/initialized（无响应，不等待）
      try {
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
      } catch {
        // 服务器可能恰好退出 —— 由 exit 处理器接管
      }
      const list = await this.rpc(state, "tools/list");
      if (list.error !== undefined) throw new Error(`tools/list rejected: ${list.error.message}`);
      const result = list.result as { tools?: RemoteTool[] };
      state.tools = (result.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: (t.parameters ?? (t as { inputSchema?: Record<string, unknown> }).inputSchema ?? {}) as Record<string, unknown>,
      }));
      this.rebuildRouting();
      return true;
    } catch (err) {
      // 初始化失败：等价于一次失败尝试（若在重启流程中会被计入频控）
      state.running = false;
      state.healthy = false;
      this.emitLog({ server: state.name, tool: "(init)", ok: false, ms: 0, error: (err as Error).message });
      if (!state.stopping) this.maybeScheduleRestart(state, `init failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** 进程意外退出：拒绝挂起请求 → 退避重启（频控 3 次/分钟）或标记 unhealthy */
  private onExit(state: ServerState, code: number): void {
    if (state.stopping) return;
    state.running = false;
    state.proc = null;
    this.failPending(state, new Error(`server "${state.name}" exited (code ${code})`));
    this.emitLog({ server: state.name, tool: "(crash)", ok: false, ms: 0, error: `exited with code ${code}` });
    this.maybeScheduleRestart(state, `exited with code ${code}`);
    this.rebuildRouting();
  }

  private maybeScheduleRestart(state: ServerState, reason: string): void {
    if (state.stopping) return;
    const now = Date.now();
    state.restarts = state.restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (state.restarts.length >= RESTART_MAX_PER_WINDOW) {
      state.healthy = false;
      this.emitLog({
        server: state.name,
        tool: "(unhealthy)",
        ok: false,
        ms: 0,
        error: `restart budget exhausted (${RESTART_MAX_PER_WINDOW}/min): ${reason}`,
      });
      this.rebuildRouting();
      return;
    }
    const attempt = state.restarts.length + 1;
    const backoff = Math.min(RESTART_BACKOFF_BASE_MS * 2 ** (attempt - 1), RESTART_BACKOFF_CAP_MS);
    state.restarts.push(now);
    state.backoffTimer = setTimeout(() => {
      state.backoffTimer = null;
      if (state.stopping) return;
      void this.spawnOne(state);
    }, backoff);
  }

  private pumpStdout(state: ServerState, proc: Bun.Subprocess<"pipe", "pipe", "pipe">): void {
    const buffer = createLineBuffer();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for await (const chunk of proc.stdout) {
          for (const line of buffer.feed(decoder.decode(chunk, { stream: true }))) {
            this.handleServerLine(state, line);
          }
        }
      } catch {
        // 流关闭（进程退出）
      }
    })();
  }

  private pumpStderr(state: ServerState, proc: Bun.Subprocess<"pipe", "pipe", "pipe">): void {
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for await (const chunk of proc.stderr) {
          const text = decoder.decode(chunk, { stream: true });
          for (const line of text.split("\n")) {
            if (line.trim().length === 0) continue;
            state.stderrTail.push(line);
            if (state.stderrTail.length > 8) state.stderrTail.shift();
          }
        }
      } catch {
        // ignore
      }
    })();
  }

  private handleServerLine(state: ServerState, line: string): void {
    let msg: { id?: unknown; result?: unknown; error?: { code: number; message: string } };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行（调试输出）忽略
    }
    if (typeof msg.id !== "number" && typeof msg.id !== "string") return; // 服务器通知暂不处理
    const pending = state.pending.get(msg.id as number);
    if (pending === undefined) return; // 已超时被丢弃的迟到响应
    if (msg.error !== undefined) {
      pending.resolve(errorResponse(msg.id as number, msg.error.code ?? JsonRpcErrorCodes.INTERNAL_ERROR, msg.error.message ?? "server error"));
      return;
    }
    pending.resolve(resultResponse(msg.id as number, msg.result));
  }
}
