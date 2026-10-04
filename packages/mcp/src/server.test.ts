// server.ts 单元测试：方法路由 / 错误码 / 初始化门禁 / 版本协商回退 / 会话管理
import { describe, expect, it } from "bun:test";
import { LATEST_PROTOCOL_VERSION, McpServer } from "./server";
import type { McpServerDeps, McpToolDeps } from "./server";
import type { JsonRpcRequest, JsonRpcResponse } from "./protocol";

interface Recorded {
  name: string;
  args: Record<string, unknown>;
  ctx: unknown;
}

function makeDeps(): { deps: McpServerDeps; calls: Recorded[]; contextCalls: number[] } {
  const calls: Recorded[] = [];
  const contextCalls = [0]; // 单元素盒装计数器（闭包内可变 + 可返回）
  const tools: McpToolDeps = {
    list: () => [
      { name: "echo", description: "回显参数", parameters: { type: "object", properties: { msg: { type: "string" } } } },
      { name: "fail", description: "总是失败", parameters: { type: "object", properties: {} } },
    ],
    async call(name, args, ctx) {
      calls.push({ name, args, ctx });
      if (name === "fail") return { ok: false, error: "SCHEMA: msg is required" };
      if (name === "throw") throw new Error("kaboom");
      return { ok: true, data: { echoed: args, viaCtx: (ctx as { marker: string }).marker } };
    },
  };
  return {
    calls,
    contextCalls,
    deps: {
      tools,
      getContext: async () => {
        contextCalls[0]++;
        return { marker: `ctx-${contextCalls[0]}` };
      },
    },
  };
}

function req(id: number | string, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };
}

async function send(server: McpServer, id: number | string, method: string, params?: unknown): Promise<JsonRpcResponse> {
  const res = await server.handleRequest(req(id, method, params));
  if (res === null) throw new Error(`${method} unexpectedly returned null (notification?)`);
  return res;
}

describe("McpServer：initialize 与协议版本协商", () => {
  it("initialize → 回显客户端版本 + serverInfo + capabilities", async () => {
    const { deps } = makeDeps();
    const server = new McpServer(deps);
    expect(server.isInitialized).toBe(false);
    const res = await send(server, 1, "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.1" },
    });
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "videoos", version: "0.1.0" },
    });
    expect(server.isInitialized).toBe(true);
  });

  it("客户端版本在 supported 列表 → 回显（2024-11-05）", async () => {
    const server = new McpServer(makeDeps().deps);
    const res = await send(server, 1, "initialize", { protocolVersion: "2024-11-05" });
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
  });

  it("客户端版本不支持 → 回退最新 2025-03-26", async () => {
    const server = new McpServer(makeDeps().deps);
    const res = await send(server, 1, "initialize", { protocolVersion: "1999-01-01" });
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  it("自定义 supportedProtocolVersions / serverName / serverVersion", async () => {
    const server = new McpServer(makeDeps().deps, {
      serverName: "videoos-dev",
      serverVersion: "9.9.9",
      supportedProtocolVersions: ["2024-11-05"],
    });
    const echoed = await send(server, 1, "initialize", { protocolVersion: "2024-11-05" });
    expect((echoed.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
    const fallback = await send(server, 2, "initialize", { protocolVersion: "2025-03-26" });
    expect((fallback.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05"); // 不在列表 → 回列表最新
    expect((fallback.result as { serverInfo: { name: string } }).serverInfo.name).toBe("videoos-dev");
  });

  it("initialize 无 params / 无 protocolVersion → 回最新版本", async () => {
    const server = new McpServer(makeDeps().deps);
    const res = await send(server, 1, "initialize");
    expect((res.result as { protocolVersion: string }).protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe("McpServer：初始化门禁（-32002）", () => {
  it("initialize 之前 tools/list / ping / 未知方法 → -32002", async () => {
    const server = new McpServer(makeDeps().deps);
    for (const method of ["tools/list", "ping", "tools/call", "no/such-method"]) {
      const res = await send(server, 1, method);
      expect(res.error?.code).toBe(-32002);
      expect(res.error?.message).toContain("Server not initialized");
    }
  });

  it("initialize 之后放行", async () => {
    const server = new McpServer(makeDeps().deps);
    await send(server, 1, "initialize");
    const ping = await send(server, 2, "ping");
    expect(ping.result).toEqual({});
  });
});

describe("McpServer：tools/list 与 tools/call", () => {
  async function readyServer(): Promise<{ server: McpServer; calls: Recorded[]; contextCalls: number[] }> {
    const { deps, calls, contextCalls } = makeDeps();
    const server = new McpServer(deps);
    await send(server, 0, "initialize");
    return { server, calls, contextCalls };
  }

  it("tools/list → tools[].inputSchema = registry parameters", async () => {
    const { server } = await readyServer();
    const res = await send(server, 1, "tools/list");
    const tools = (res.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
    expect(tools.length).toBe(2);
    expect(tools[0]).toEqual({
      name: "echo",
      description: "回显参数",
      inputSchema: { type: "object", properties: { msg: { type: "string" } } },
    });
  });

  it("tools/call ok → content text = data 的 2 空格 JSON，isError false", async () => {
    const { server } = await readyServer();
    const res = await send(server, 1, "tools/call", { name: "echo", arguments: { msg: "hi" } });
    const out = res.result as { content: Array<{ type: string; text: string }>; isError: boolean };
    expect(out.isError).toBe(false);
    expect(out.content.length).toBe(1);
    expect(out.content[0].type).toBe("text");
    expect(JSON.parse(out.content[0].text)).toEqual({ echoed: { msg: "hi" }, viaCtx: "ctx-1" });
    expect(out.content[0].text).toContain('\n  "echoed"'); // 2 空格缩进
  });

  it("tools/call ok=false（VapToolResult 失败）→ isError true + text=error", async () => {
    const { server } = await readyServer();
    const res = await send(server, 1, "tools/call", { name: "fail" });
    const out = res.result as { content: Array<{ text: string }>; isError: boolean };
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toBe("SCHEMA: msg is required");
  });

  it("tools/call arguments 缺省 → 传给工具 {}；上下文跨调用复用（getContext 只装配一次）", async () => {
    const { server, calls, contextCalls } = await readyServer();
    await send(server, 1, "tools/call", { name: "echo" });
    await send(server, 2, "tools/call", { name: "echo", arguments: { a: 1 } });
    expect(calls.length).toBe(2);
    expect(calls[0].args).toEqual({});
    expect(calls[1].args).toEqual({ a: 1 });
    expect(contextCalls[0]).toBe(1); // SessionManager 缓存
    expect((calls[0].ctx as { marker: string }).marker).toBe("ctx-1");
    expect((calls[1].ctx as { marker: string }).marker).toBe("ctx-1");
  });

  it("tools/call 缺 name / name 非字符串 → -32602", async () => {
    const { server } = await readyServer();
    expect((await send(server, 1, "tools/call", {})).error?.code).toBe(-32602);
    expect((await send(server, 2, "tools/call", { name: 42 })).error?.code).toBe(-32602);
    expect((await send(server, 3, "tools/call", { name: "echo", arguments: [1, 2] })).error?.code).toBe(-32602);
    expect((await send(server, 4, "tools/call", { name: "echo", arguments: "str" })).error?.code).toBe(-32602);
  });

  it("tools/call params 非对象 → -32602", async () => {
    const { server } = await readyServer();
    expect((await send(server, 1, "tools/call", "echo")).error?.code).toBe(-32602);
  });

  it("tools/call 工具执行抛异常 → -32603", async () => {
    const { server } = await readyServer();
    const res = await send(server, 1, "tools/call", { name: "throw" });
    expect(res.error?.code).toBe(-32603);
    expect(res.error?.message).toContain("kaboom");
  });

  it("会话统计：toolCalls / toolErrors", async () => {
    const { server } = await readyServer();
    await send(server, 1, "tools/call", { name: "echo" });
    await send(server, 2, "tools/call", { name: "fail" });
    expect(server.sessions.statistics).toEqual({ toolCalls: 2, toolErrors: 1, contextCreations: 1 });
  });
});

describe("McpServer：其余方法与错误码", () => {
  it("未知方法 → -32601（initialize 之后）", async () => {
    const server = new McpServer(makeDeps().deps);
    await send(server, 1, "initialize");
    const res = await send(server, 2, "prompts/list");
    expect(res.error?.code).toBe(-32601);
    expect(res.error?.message).toContain("prompts/list");
  });

  it("notifications/initialized / initialized / 任意通知 → null（无响应）", async () => {
    const server = new McpServer(makeDeps().deps);
    expect(await server.handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await server.handleRequest({ jsonrpc: "2.0", method: "initialized" })).toBeNull();
    expect(await server.handleRequest({ jsonrpc: "2.0", method: "notifications/cancelled", params: {} })).toBeNull();
  });

  it("handleMessage：解析错 → -32700（id null）", async () => {
    const server = new McpServer(makeDeps().deps);
    const out = await server.handleMessage("{not valid json");
    expect(out).not.toBeNull();
    const res = JSON.parse(out as string) as JsonRpcResponse;
    expect(res.id).toBeNull();
    expect(res.error?.code).toBe(-32700);
  });

  it("handleMessage：非法形状 → -32600（可提取 id 时带上）", async () => {
    const server = new McpServer(makeDeps().deps);
    const scalar = JSON.parse((await server.handleMessage('"hello"')) as string) as JsonRpcResponse;
    expect(scalar.error?.code).toBe(-32600);
    expect(scalar.id).toBeNull();
    const array = JSON.parse((await server.handleMessage("[1,2,3]")) as string) as JsonRpcResponse;
    expect(array.error?.code).toBe(-32600);
    const noMethod = JSON.parse((await server.handleMessage('{"jsonrpc":"2.0","id":9}')) as string) as JsonRpcResponse;
    expect(noMethod.error?.code).toBe(-32600);
    expect(noMethod.id).toBe(9);
    const badVersion = JSON.parse((await server.handleMessage('{"jsonrpc":"1.0","id":3,"method":"ping"}')) as string) as JsonRpcResponse;
    expect(badVersion.error?.code).toBe(-32600);
  });

  it("handleMessage：通知 → null；请求 → 响应字符串", async () => {
    const server = new McpServer(makeDeps().deps);
    expect(await server.handleMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}')).toBeNull();
    // 未初始化 → -32002（门禁同样作用于 handleMessage 路径）
    const gated = JSON.parse((await server.handleMessage('{"jsonrpc":"2.0","id":5,"method":"ping"}')) as string) as JsonRpcResponse;
    expect(gated.error?.code).toBe(-32002);
    await server.handleMessage('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}');
    const ping = await server.handleMessage('{"jsonrpc":"2.0","id":5,"method":"ping"}');
    expect(JSON.parse(ping as string)).toEqual({ jsonrpc: "2.0", id: 5, result: {} });
  });

  it("VapToolRegistry 形状兼容（结构化契约）", async () => {
    // @videoos/agent 的 VapToolRegistry 与 McpToolDeps 结构兼容 —— 用鸭子形状冒烟验证
    const registryLike: McpToolDeps = {
      list: () => [{ name: "compile.run", description: "compile", parameters: { type: "object", properties: {} } }],
      call: async () => ({ ok: true, data: { scenes: 2 } }),
    };
    const server = new McpServer({ tools: registryLike, getContext: async () => ({}) });
    await send(server, 1, "initialize");
    const res = await send(server, 2, "tools/call", { name: "compile.run", arguments: {} });
    expect((res.result as { isError: boolean }).isError).toBe(false);
  });
});
