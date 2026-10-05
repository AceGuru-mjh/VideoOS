// MCP-Lite 测试工具箱：spawn 真子进程做协议级 E2E（agent-kit SPEC §3.6 的标准姿势）。
// 用法（任意 mcp-* 包的 *.test.ts）：
//   import { spawnLiteServer } from "@videoos/mcp-lite/testing";
//   const srv = await spawnLiteServer(join(import.meta.dir, "index.ts"), { env: { MCP_FS_ROOTS: dir } });
//   const res = await srv.call("fs.read", { path: "a.txt" });
//   expect(res.ok).toBe(true);
//   await srv.close();
import { spawn } from "node:child_process";
import type { LiteToolResult } from "./tool";

export interface LiteServerHandle {
  /** 底层子进程 pid */
  readonly pid: number | undefined;
  /** 已完成 initialize 握手 */
  readonly protocolVersion: string;
  /** serverInfo（握手返回） */
  readonly serverInfo: { name: string; version: string };
  /** tools/list 结果（握手时缓存） */
  readonly tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  /** 发送原始 JSON-RPC 请求（自增 id；返回 id 供断言） */
  request(method: string, params?: unknown): number;
  /** 等待接下来 n 行 stdout */
  next(n: number, label?: string): Promise<string[]>;
  /** 工具调用便捷路径（解析 content[0].text → {ok,data,error}） */
  call(name: string, args?: Record<string, unknown>): Promise<LiteToolResult>;
  /** 关闭进程（SIGTERM → 1s → SIGKILL） */
  close(): Promise<void>;
}

export interface SpawnOptions {
  env?: Record<string, string>;
  /** 每步等待超时（ms），默认 20000 */
  timeoutMs?: number;
  /** 额外命令行参数（插在 script 前） */
  args?: string[];
}

interface JsonRpcLine {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 解析一行 JSON-RPC 响应 */
export function parseResponse(line: string): JsonRpcLine {
  return JSON.parse(line) as JsonRpcLine;
}

/** spawn 一个 mcp-lite stdio 服务器并完成 initialize 握手 */
export async function spawnLiteServer(script: string, options: SpawnOptions = {}): Promise<LiteServerHandle> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  // process.execPath：用当前 bun 可执行文件的绝对路径（Windows runner 上 PATH 里的裸 "bun"
  // 经 node:child_process spawn 解析会 ENOENT —— 与 main 侧 3a07734 修复同源）。
  const child = spawn(
    process.execPath,
    ["run", ...(options.args ?? []), script],
    { env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>, stdio: ["pipe", "pipe", "pipe"] },
  );

  let buffer = "";
  const lines: string[] = [];
  const waiters: Array<{
    count: number;
    resolve: (ls: string[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  function flush(): void {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]!;
      if (lines.length >= waiter.count) {
        clearTimeout(waiter.timer);
        waiters.splice(i, 1);
        waiter.resolve(lines.splice(0, waiter.count));
      }
    }
  }

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      lines.push(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
    flush();
  });
  child.stdout.on("error", () => {});
  child.on("exit", () => {
    // 进程退出：唤醒所有等待者（避免悬挂）
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`server exited before responding (collected: ${JSON.stringify(lines)})`));
    }
  });

  function next(count: number, label: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(
          new Error(
            `timeout (${timeoutMs}ms) waiting for ${count} line(s) [${label}]; got so far: ${JSON.stringify(lines)}`,
          ),
        );
      }, timeoutMs);
      waiters.push({ count, resolve, reject, timer });
      flush();
    });
  }

  function write(obj: unknown): void {
    child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  // ---- initialize 握手 ----
  write({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } });
  const [initLine] = await next(1, "initialize");
  const init = parseResponse(initLine!);
  if (init.error !== undefined) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  const initResult = init.result as {
    protocolVersion: string;
    serverInfo: { name: string; version: string };
  };
  write({ jsonrpc: "2.0", method: "notifications/initialized" });
  write({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const [listLine] = await next(1, "tools/list");
  const list = parseResponse(listLine!);
  if (list.error !== undefined) throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
  const tools = (list.result as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> })
    .tools;

  let nextId = 3;

  const handle: LiteServerHandle = {
    pid: child.pid,
    protocolVersion: initResult.protocolVersion,
    serverInfo: initResult.serverInfo,
    tools,
    request(method: string, params?: unknown): number {
      const id = nextId++;
      write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
      return id;
    },
    next(count: number, label = "lines"): Promise<string[]> {
      return next(count, label);
    },
    async call(name: string, args: Record<string, unknown> = {}): Promise<LiteToolResult> {
      const id = handle.request("tools/call", { name, arguments: args });
      const [line] = await next(1, `tools/call ${name}`);
      const response = parseResponse(line!);
      if (response.error !== undefined) {
        return { ok: false, error: `JSON-RPC ${response.error.code}: ${response.error.message}` };
      }
      const result = response.result as { content?: Array<{ type: string; text: string }>; isError?: boolean };
      const text = result.content?.[0]?.text ?? "";
      if (result.isError === true) return { ok: false, error: text };
      try {
        return { ok: true, data: JSON.parse(text) as unknown };
      } catch {
        return { ok: true, data: text };
      }
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 1000);
        child.on("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
        child.kill("SIGTERM");
      });
    },
  };
  return handle;
}
