// mcp-web 协议级 E2E（Issue #34）：全部离线 —— node:http 起本地 mock 服务，
// Bun.spawn 拉起真服务器进程，stdin/stdout 走 JSON-RPC 断言工具行为。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// 测试辅助：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端（协议级 E2E）
// 注意：cmd 用 process.execPath（bun 绝对路径）——Bun.spawn 按子进程 env 的 PATH
// 解析裸命令名，用绝对路径才能在 PATH 被改写的场景下稳定拉起。
// ---------------------------------------------------------------------------

const CHILDREN: Array<Bun.Subprocess<"pipe", "pipe", "pipe">> = [];
afterAll(() => {
  for (const c of CHILDREN) {
    try {
      c.kill();
    } catch {
      /* exited */
    }
  }
});

interface McpChild {
  listTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>>;
  call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }>;
  close(): Promise<void>;
}

async function spawnMcp(script: string, env: Record<string, string> = {}): Promise<McpChild> {
  const proc = Bun.spawn({
    cmd: [process.execPath, script],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  CHILDREN.push(proc);
  let nextId = 1;
  let buffer = "";
  const waiters: Array<(line: string) => void> = [];
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const w = waiters.shift();
        if (w) w(line);
      }
    }
    while (waiters.length > 0) waiters.shift()!("__EOF__");
  })();
  const request = async (method: string, params?: unknown): Promise<{ id: number; result?: any; error?: { code: number; message: string } }> => {
    const id = nextId++;
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const line = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method} #${id}`)), 15_000);
      waiters.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
    if (line === "__EOF__") throw new Error(`server exited while waiting for ${method}`);
    return JSON.parse(line);
  };
  const init = await request("initialize", { protocolVersion: "2025-03-26" });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    listTools: async () => {
      const r = await request("tools/list");
      if (r.error) throw new Error(r.error.message);
      return r.result.tools;
    },
    call: async (name, args = {}) => {
      const r = await request("tools/call", { name, arguments: args });
      if (r.error) return { ok: false, error: `${r.error.code}: ${r.error.message}` };
      return r.result;
    },
    close: async () => {
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      await proc.exited;
    },
  };
}

// ---------------------------------------------------------------------------
// 本地 mock HTTP 服务（全部请求都不出机器）
// ---------------------------------------------------------------------------

const SERVERS: http.Server[] = [];

interface MockServer {
  port: number;
  url: (path: string) => string;
  close: () => Promise<void>;
}

function startMock(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<MockServer> {
  const server = http.createServer(handler);
  SERVERS.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        url: (path: string) => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

afterAll(async () => {
  await Promise.all(SERVERS.map((s) => new Promise<void>((done) => s.close(() => done()))));
});

// ---------------------------------------------------------------------------
// 测试主体
// ---------------------------------------------------------------------------

let mcp: McpChild;

beforeAll(async () => {
  mcp = await spawnMcp(join(import.meta.dir, "index.ts"));
}, 30_000);

describe("mcp-web 协议级 E2E（离线 mock）", () => {
  it("tools/list → 2 个工具，schema 均为 object", async () => {
    const tools = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["web.dns", "web.fetch"]);
    for (const t of tools) {
      expect((t.parameters as { type?: string }).type).toBe("object");
      expect(t.description.length).toBeGreaterThan(0);
    }
  }, 15_000);

  it("web.fetch：text/plain 原样透传", async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("hello plain");
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/") });
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe(200);
    expect(r.data.text).toBe("hello plain");
    expect(r.data.truncated).toBe(false);
    expect(String(r.data.contentType)).toContain("text/plain");
    await mock.close();
  }, 15_000);

  it("web.fetch：HTML 抽正文（去 script/style、块级换行）", async () => {
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<html><head><script>evil()</script><style>.x{}</style></head><body><h1>Title</h1><p>Para one</p><br><p>Para two</p></body></html>",
      );
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/") });
    expect(r.ok).toBe(true);
    expect(r.data.text).toContain("Title");
    expect(r.data.text).toContain("Para one");
    expect(r.data.text).toContain("Para two");
    expect(r.data.text).not.toContain("evil");
    expect(r.data.text).not.toContain(".x{");
    expect(r.data.text).toContain("\n");
    await mock.close();
  }, 15_000);

  it("web.fetch：跟随 302 重定向（/a → /b）", async () => {
    const mock = await startMock((req, res) => {
      if (req.url === "/a") {
        res.writeHead(302, { location: "/b" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("landed");
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/a") });
    expect(r.ok).toBe(true);
    expect(r.data.text).toBe("landed");
    expect(String(r.data.url).endsWith("/b")).toBe(true);
    await mock.close();
  }, 15_000);

  it("web.fetch：7 跳重定向链 → too many redirects", async () => {
    const mock = await startMock((req, res) => {
      const m = /^\/r(\d)$/.exec(req.url ?? "");
      if (m !== null && Number(m[1]) < 7) {
        res.writeHead(302, { location: `/r${Number(m[1]) + 1}` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("end");
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/r1") });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("too many redirects");
    await mock.close();
  }, 15_000);

  it("web.fetch：maxBytes 截断（5000 字节正文读 1024）", async () => {
    const body = "a".repeat(5000);
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(body);
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/"), maxBytes: 1024 });
    expect(r.ok).toBe(true);
    expect(r.data.truncated).toBe(true);
    expect(new TextEncoder().encode(r.data.text as string).length).toBe(1024);
    await mock.close();
  }, 15_000);

  it("web.fetch：正文恰好等于 maxBytes → 不截断", async () => {
    const body = "b".repeat(1024);
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(body);
    });
    const r = await mcp.call("web.fetch", { url: mock.url("/"), maxBytes: 1024 });
    expect(r.ok).toBe(true);
    expect(r.data.truncated).toBe(false);
    expect(new TextEncoder().encode(r.data.text as string).length).toBe(1024);
    await mock.close();
  }, 15_000);

  it("web.fetch：非 http(s) 协议拒绝", async () => {
    const r = await mcp.call("web.fetch", { url: "ftp://example.com/x" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("only http(s)");
  }, 15_000);

  it("web.fetch：连接已关闭端口 → fetch failed", async () => {
    // 起服务拿端口 → 关掉 → 再请求（必然连接拒绝）
    const mock = await startMock((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("x");
    });
    const port = mock.port;
    await mock.close();
    const r = await mcp.call("web.fetch", { url: `http://127.0.0.1:${port}/` });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("fetch failed");
  }, 15_000);

  it("web.dns：localhost 解析出 127.0.0.1", async () => {
    const r = await mcp.call("web.dns", { hostname: "localhost" });
    expect(r.ok).toBe(true);
    expect(r.data.addresses).toContain("127.0.0.1");
  }, 15_000);

  it("web.dns：不存在的主机 → dns lookup failed", async () => {
    const r = await mcp.call("web.dns", { hostname: "nonexistent.invalid.example" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dns lookup failed");
  }, 15_000);

  it("web.fetch：zod 校验（maxBytes 下限 1024）→ -32602", async () => {
    const r = await mcp.call("web.fetch", { url: "http://127.0.0.1/x", maxBytes: 10 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("-32602");
  }, 15_000);
});
