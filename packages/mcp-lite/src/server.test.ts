// mcp-lite 服务器单元 + 进程级 E2E 测试（Issue #29）：
// 门禁 -32002 / 未知方法 -32601 / 通知静默 / -32602 参数与未知工具 / -32603 兜底 /
// defineTool zod 校验 / 真进程 stdio 往返 / stdin 关闭退出。
import { afterAll, describe, expect, it } from "bun:test";
import { z } from "zod/v4";
import { handleLiteMessage } from "./server";
import { defineTool, LiteParamError } from "./tool";
import type { JsonRpcMessage, JsonRpcResponse } from "./protocol";
import type { LiteTool } from "./tool";

// ---------------------------------------------------------------------------
// 单元级：handleLiteMessage 直连
// ---------------------------------------------------------------------------

const echoTool = defineTool({
  name: "echo",
  description: "echo back",
  schema: z.object({ text: z.string().min(1) }),
  call: (args) => ({ ok: true, data: { echoed: args.text } }),
});

const boomTool: LiteTool = {
  name: "boom",
  description: "always fails at runtime",
  parameters: { type: "object", properties: {} },
  call: () => {
    throw new Error("kaboom");
  },
};

async function send(msg: unknown, tools: LiteTool[] = [echoTool, boomTool], state = { initialized: true }): Promise<JsonRpcResponse | null> {
  return handleLiteMessage(msg as JsonRpcMessage, tools, state);
}

describe("handleLiteMessage 单元", () => {
  it("initialize → 协议版本 + serverInfo", async () => {
    const res = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, [echoTool], { initialized: false });
    expect(res?.result).toEqual({
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "mcp-lite", version: "0.1.0" },
    });
  });

  it("未初始化门禁：initialize 前其他请求 → -32002", async () => {
    const res = await send({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [echoTool], { initialized: false });
    expect(res?.error?.code).toBe(-32002);
  });

  it("通知（无 id）→ 无响应", async () => {
    const res = await send({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res).toBeNull();
  });

  it("未知方法 → -32601", async () => {
    const res = await send({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(res?.error?.code).toBe(-32601);
    expect(res?.error?.message).toContain("resources/list");
  });

  it("形状非法（缺 method / jsonrpc 版本错）→ -32600", async () => {
    expect((await send({ id: 1 }))?.error?.code).toBe(-32600);
    expect((await send({ jsonrpc: "1.0", id: 1, method: "x" }))?.error?.code).toBe(-32600);
    expect((await send([1, 2]))?.error?.code).toBe(-32600);
  });

  it("tools/list → parameters + inputSchema 双键", async () => {
    const res = await send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const result = res?.result as { tools: Array<{ name: string; parameters: unknown; inputSchema: unknown }> };
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0].name).toBe("echo");
    expect(result.tools[0].parameters).toEqual(result.tools[0].inputSchema);
    expect((result.tools[0].parameters as { type: string }).type).toBe("object");
  });

  it("tools/call 成功 → result 级 { ok, data }", async () => {
    const res = await send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
    expect(res?.result).toEqual({ ok: true, data: { echoed: "hi" } });
  });

  it("zod 校验失败 → -32602 且 message 含字段路径", async () => {
    const res = await send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: { text: "" } } });
    expect(res?.error?.code).toBe(-32602);
    expect(res?.error?.message).toContain("text");
  });

  it("信封参数错误 → -32602（name 缺失 / arguments 非对象）", async () => {
    expect((await send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: {} }))?.error?.code).toBe(-32602);
    expect((await send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: [1] } }))?.error?.code).toBe(-32602);
    expect((await send({ jsonrpc: "2.0", id: 8, method: "tools/call", params: "nope" }))?.error?.code).toBe(-32602);
  });

  it("未知工具 → -32602 且列出可用工具", async () => {
    const res = await send({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "ghost" } });
    expect(res?.error?.code).toBe(-32602);
    expect(res?.error?.message).toContain("echo");
  });

  it("工具执行抛错（非 LiteParamError）→ -32603 兜底", async () => {
    const res = await send({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "boom" } });
    expect(res?.error?.code).toBe(-32603);
    expect(res?.error?.message).toContain("kaboom");
  });

  it("工具业务失败 → result 级 { ok: false, error }（非协议错误）", async () => {
    const failing: LiteTool = {
      name: "deny",
      description: "returns ok:false",
      parameters: { type: "object", properties: {} },
      call: () => ({ ok: false, error: "path outside jail" }),
    };
    const res = await send({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "deny" } }, [failing]);
    expect(res?.result).toEqual({ ok: false, error: "path outside jail" });
  });

  it("arguments 缺省 → 空对象（可选参工具可用）", async () => {
    const optional = defineTool({
      name: "ping",
      description: "ping",
      schema: z.object({}),
      call: () => ({ ok: true, data: { pong: true } }),
    });
    const res = await send({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "ping" } }, [optional]);
    expect(res?.result).toEqual({ ok: true, data: { pong: true } });
  });
});

describe("defineTool / LiteParamError", () => {
  it("parameters 由 zod schema 生成（含约束）", () => {
    const tool = defineTool({
      name: "t",
      description: "d",
      schema: z.object({ n: z.number().int().min(1).max(5), mode: z.enum(["a", "b"]).optional() }),
      call: () => ({ ok: true }),
    });
    expect(tool.parameters).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { n: { type: "integer", minimum: 1, maximum: 5 }, mode: { type: "string", enum: ["a", "b"] } },
      required: ["n"],
      additionalProperties: false,
    });
  });

  it("LiteParamError 直接抛出可被捕获识别", () => {
    const err = new LiteParamError("path: required");
    expect(err.name).toBe("LiteParamError");
    expect(err.message).toBe("path: required");
  });
});

// ---------------------------------------------------------------------------
// 进程级 E2E：Bun.spawn 真进程 + stdio JSON-RPC
// ---------------------------------------------------------------------------

const childProcesses: Array<{ kill: () => void; exited: Promise<number> }> = [];
afterAll(() => {
  for (const p of childProcesses) {
    try {
      p.kill();
    } catch {
      // already exited
    }
  }
});

const SERVER_SCRIPT = `${import.meta.dir}/e2e-fixture-server.ts`;

interface Child {
  send(line: string | object): void;
  nextLine(timeoutMs?: number): Promise<string>;
  close(): Promise<void>;
  exitCode: Promise<number | null>;
}

async function spawnServer(): Promise<Child> {
  const proc = Bun.spawn({
    cmd: [process.execPath, SERVER_SCRIPT],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  childProcesses.push(proc);
  let buffer = "";
  const pending: Array<(line: string) => void> = [];
  const pump = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const waiter = pending.shift();
        if (waiter !== undefined) waiter(line);
      }
    }
  })();
  const pumpPromise = pump.catch(() => undefined);
  return {
    send(line: string | object): void {
      proc.stdin.write(typeof line === "string" ? `${line}\n` : `${JSON.stringify(line)}\n`);
    },
    async nextLine(timeoutMs = 5_000): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout waiting for server line")), timeoutMs);
        pending.push((line) => {
          clearTimeout(timer);
          resolve(line);
        });
      });
    },
    async close(): Promise<void> {
      try {
        proc.stdin.end();
      } catch {
        // ignore
      }
      await pumpPromise;
    },
    exitCode: (async () => {
      const code = await proc.exited;
      return code;
    })(),
  };
}

describe("进程级 E2E（Bun.spawn 真进程）", () => {
  it("完整生命周期：initialize → tools/list → tools/call → EOF 退出", async () => {
    const child = await spawnServer();

    child.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
    const init = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    expect(init.result).toHaveProperty("serverInfo.name", "mcp-lite-e2e");

    child.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    child.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    const tools = (list.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(["echo"]);

    child.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "e2e" } } });
    const call = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    expect(call.result).toEqual({ ok: true, data: { echoed: "e2e" } });

    await child.close();
    expect(await child.exitCode).toBe(0);
  }, 15_000);

  it("门禁在真进程上也生效（initialize 前 tools/list → -32002）", async () => {
    const child = await spawnServer();
    child.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const res = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    expect(res.error?.code).toBe(-32002);
    await child.close();
  }, 15_000);

  it("粘包写入：两条请求一次 write 也能逐条响应", async () => {
    const child = await spawnServer();
    child.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await child.nextLine();
    child.send(
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"text":"x"}}}\n',
    );
    const first = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    const second = JSON.parse(await child.nextLine()) as JsonRpcResponse;
    expect(first.id).toBe(2);
    expect(second.id).toBe(3);
    expect(second.result).toEqual({ ok: true, data: { echoed: "x" } });
    await child.close();
  }, 15_000);
});
