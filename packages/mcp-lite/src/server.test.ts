// LiteServer 路由/门禁单测 + runStdioServer 注入 IO 测试 + 真子进程协议级 E2E。
import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { defineTool, LiteServer, runStdioServer, err, ok } from "./index";
import { spawnLiteServer } from "./testing";
import { errorResponse, JsonRpcErrorCodes, resultResponse } from "./protocol";

const demoTools = [
  defineTool("demo.echo", "Echo.", z.object({ text: z.string() }), ({ text }) => ok({ text })),
];

describe("LiteServer.handleRequest", () => {
  it("uninitialized non-initialize request → -32002", async () => {
    const server = new LiteServer(demoTools);
    const response = await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response).toEqual(
      errorResponse(1, JsonRpcErrorCodes.SERVER_NOT_INITIALIZED, expect.any(String)),
    );
  });

  it("initialize → negotiation + capabilities + serverInfo", async () => {
    const server = new LiteServer(demoTools, { serverName: "unit", serverVersion: "9.9.9" });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    });
    expect(response).toEqual(
      resultResponse(1, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "unit", version: "9.9.9" },
      }),
    );
    expect(server.isInitialized).toBe(true);
  });

  it("unknown protocol version falls back to latest", async () => {
    const server = new LiteServer(demoTools);
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    expect((response!.result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  });

  it("unknown method → -32601", async () => {
    const server = new LiteServer(demoTools);
    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const response = await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(response!.error!.code).toBe(-32601);
  });

  it("notifications produce no response", async () => {
    const server = new LiteServer(demoTools);
    expect(await server.handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("malformed shapes → -32600", async () => {
    const server = new LiteServer(demoTools);
    const bad = await server.handleRequest({ jsonrpc: "1.0", id: 1, method: "ping" } as never);
    expect(bad!.error!.code).toBe(-32600);
    const array = await server.handleRequest([1, 2] as never);
    expect(array!.error!.code).toBe(-32600);
  });

  it("tools/call validation failure → -32602 with field path", async () => {
    const server = new LiteServer(demoTools);
    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "demo.echo", arguments: { text: 42 } },
    });
    expect(response!.error!.code).toBe(-32602);
    expect(response!.error!.message).toContain("text:");
  });

  it("tools/call unknown tool → -32602 listing available", async () => {
    const server = new LiteServer(demoTools);
    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "nope.nope", arguments: {} },
    });
    expect(response!.error!.code).toBe(-32602);
    expect(response!.error!.message).toContain("demo.echo");
  });

  it("tools/call result is MCP content shape; tool error → isError", async () => {
    const server = new LiteServer([
      ...demoTools,
      defineTool("demo.fail", "Fail.", z.object({}), () => err("E_X: nope")),
    ]);
    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });

    const okRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "demo.echo", arguments: { text: "hi" } },
    });
    expect(okRes!.result).toEqual({
      content: [{ type: "text", text: '{\n  "text": "hi"\n}' }],
      isError: false,
    });

    const failRes = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "demo.fail", arguments: {} },
    });
    expect(failRes!.result).toEqual({
      content: [{ type: "text", text: "E_X: nope" }],
      isError: true,
    });
  });

  it("tools/list includes inputSchema", async () => {
    const server = new LiteServer(demoTools);
    const listed = server.listTools();
    expect(listed).toEqual([
      {
        name: "demo.echo",
        description: "Echo.",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      },
    ]);
  });

  it("ping → {}", async () => {
    const server = new LiteServer(demoTools);
    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const response = await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(response).toEqual(resultResponse(2, {}));
  });
});

describe("runStdioServer (injected IO)", () => {
  async function drive(input: string[]): Promise<string[]> {
    const output: string[] = [];
    const lines = [...input];
    const io = {
      input: (async function* (): AsyncGenerator<string> {
        for (const line of lines) yield `${line}\n`;
      })(),
      output: {
        write: (chunk: string): void => {
          output.push(...String(chunk).split("\n").filter((l) => l.length > 0));
        },
      },
      signal: new AbortController().signal as unknown as { addEventListener(k: "abort", cb: () => void): void },
    };
    await runStdioServer(demoTools, { serverName: "inproc" }, io);
    return output;
  }

  it("bad JSON line → -32700 with id null", async () => {
    const output = await drive(["{not json"]);
    expect(JSON.parse(output[0]!).error).toEqual(
      expect.objectContaining({ code: -32700 }),
    );
  });

  it("full happy path over injected pipes", async () => {
    const output = await drive([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "demo.echo", arguments: { text: "yo" } } }),
    ]);
    const init = JSON.parse(output[0]!);
    expect(init.result.serverInfo.name).toBe("inproc");
    // 通知无响应：只有 2 条输出（initialize + tools/call）
    expect(output).toHaveLength(2);
    const call = JSON.parse(output[1]!);
    expect(call.result.isError).toBe(false);
    expect(JSON.parse(call.result.content[0].text)).toEqual({ text: "yo" });
  });
});

describe("E2E: spawn test-server.ts (protocol level)", () => {
  it("initialize + tools/list + tools/call happy path", async () => {
    const server = await spawnLiteServer(join(import.meta.dir, "..", "test-server.ts"));
    try {
      expect(server.protocolVersion).toBe("2025-03-26");
      expect(server.tools.map((t) => t.name)).toEqual(["demo.echo", "demo.add", "demo.fail", "demo.throw"]);
      expect(server.tools[0]!.inputSchema).toMatchObject({ type: "object" });

      const echo = await server.call("demo.echo", { text: "hello" });
      expect(echo).toEqual({ ok: true, data: { text: "hello" } });

      const add = await server.call("demo.add", { a: 2, b: 40 });
      expect(add).toEqual({ ok: true, data: { sum: 42 } });

      const fail = await server.call("demo.fail", { message: "x" });
      expect(fail).toEqual({ ok: false, error: "E_DEMO: x" });

      const thrown = await server.call("demo.throw", { message: "raw" });
      expect(thrown.ok).toBe(false);
      expect(thrown.error).toContain("TOOL_ERROR: raw");

      // 校验失败 → JSON-RPC -32602
      const id = server.request("tools/call", { name: "demo.add", arguments: { a: "x" } });
      const [line] = await server.next(1, "invalid params");
      const response = JSON.parse(line!) as { id: number; error?: { code: number } };
      expect(response.id).toBe(id);
      expect(response.error!.code).toBe(-32602);
    } finally {
      await server.close();
    }
  });

  it("raw spawn: un-initialized request → -32002; bad line → -32700", async () => {
    const child = spawn(
      "bun",
      ["run", join(import.meta.dir, "..", "test-server.ts")],
      { env: process.env as Record<string, string>, stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      const lines: string[] = [];
      let buffer = "";
      const collected = new Promise<void>((resolve) => {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          buffer += chunk;
          let nl: number;
          while ((nl = buffer.indexOf("\n")) >= 0) {
            lines.push(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
          }
          if (lines.length >= 2) resolve();
        });
        child.on("exit", () => resolve());
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })}\n`);
      child.stdin.write("{oops\n");
      const timer = new Promise((resolve) => setTimeout(resolve, 10_000));
      await Promise.race([collected, timer]);
      expect(lines).toHaveLength(2);
      expect((JSON.parse(lines[0]!) as { error: { code: number } }).error.code).toBe(-32002);
      expect((JSON.parse(lines[1]!) as { error: { code: number } }).error.code).toBe(-32700);
    } finally {
      child.stdin.end();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.on("exit", () => resolve()));
    }
  }, 20_000);
});
