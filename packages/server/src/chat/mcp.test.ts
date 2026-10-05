// MCP optional-peer 桥测试（issue #53）：
// - 未注入 host（真实包缺失）→ 全部 /api/mcp* 端点 501 MCP_HOST_UNAVAILABLE
// - 单元：adaptMcpHostModule（createHost 工厂 / SPEC §3.4 class 形状 / 两者皆无）；settings 迁移容错（mcp.servers 脏数组 → []）
// - 注入 fake host：PUT 配置持久化 + enabled 自动启动 / status / tools 聚合 + 白名单 / start/stop 幂等与 404 / 校验 400
// - 启动失败 → 500 MCP_START_FAILED + status.lastError
// - mergeTools E2E：chat 工具调用桥接 mcp_<serverId>_<tool> / 白名单拒绝 / mergeTools 关闭 → MCP_TOOL_UNAVAILABLE
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startStudioServer, type StudioServerHandle } from "../index";
import { SettingsStore } from "../settings/store";
import { adaptMcpHostModule, type McpHost, type McpHostModule } from "./mcp";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-demo", `mcp-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "product-promo");

let handle: StudioServerHandle;
let base: string;

const send = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sendJson = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  const res = await send(method, path, body);
  if (res.status !== 200) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
};

const errorOf = async (res: Response): Promise<string> => ((await res.json()) as { error: string }).error;

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 30_000, what = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------- fake host（无真实包）

class FakeHost implements McpHost {
  readonly calls: string[] = [];
  running = false;
  constructor(
    readonly serverId: string,
    private readonly failStart: boolean,
  ) {}
  async start(): Promise<void> {
    this.calls.push(`start:${this.serverId}`);
    if (this.failStart) throw new Error("boom-start");
    this.running = true;
  }
  async stop(): Promise<void> {
    this.calls.push(`stop:${this.serverId}`);
    this.running = false;
  }
  async listTools() {
    return [
      { name: "echo", description: "Echo the arguments", parameters: { type: "object" } },
      { name: "danger", description: "A dangerous tool", parameters: { type: "object" } },
    ];
  }
  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number) {
    this.calls.push(`call:${name}`);
    return { ok: true, data: { server: this.serverId, tool: name, args, timeoutMs: timeoutMs ?? null } };
  }
}

function createFakeModule(failStartIds: string[] = []): { module: McpHostModule; instances: FakeHost[] } {
  const instances: FakeHost[] = [];
  return {
    instances,
    module: {
      createHost: ({ server }) => {
        const host = new FakeHost(server.id, failStartIds.includes(server.id));
        instances.push(host);
        return host;
      },
    },
  };
}

// ---------------------------------------------------------------- 单元

describe("MCP 适配单元", () => {
  test("adaptMcpHostModule：createHost 工厂形状（同步 listTools / 2 参 callTool 也被规范化）", async () => {
    const adapted = adaptMcpHostModule({
      createHost: (config: { server: { id: string } }) => ({
        start() {
          return undefined; // 同步 start
        },
        stop() {},
        listTools() {
          return [{ name: "t1", description: "d1", parameters: { type: "object" } }];
        },
        callTool: (name: string, args: Record<string, unknown>) => ({ ok: true, data: { name, args } }),
      }),
    });
    expect(adapted).not.toBeNull();
    const host = adapted!.createHost({ server: { id: "srv", command: "x", args: [], env: {} } });
    await host.start();
    const tools = await host.listTools();
    expect(tools).toEqual([{ name: "t1", description: "d1", parameters: { type: "object" } }]);
    const result = await host.callTool("t1", { a: 1 }, 5000); // 超时参数透传（多余参数对旧实现无害）
    expect(result).toEqual({ ok: true, data: { name: "t1", args: { a: 1 } } });
  });

  test("adaptMcpHostModule：SPEC §3.4 class McpHost 形状（含 server 字段的 listTools 过滤 + on(\"log\") 适配）", async () => {
    const logs: unknown[] = [];
    class SpecHost {
      started = false;
      constructor(readonly config: unknown) {}
      start() {
        this.started = true;
      }
      stop() {}
      listTools() {
        return [
          { server: "spec-srv", name: "t1", description: "d1", parameters: { type: "object" } },
          { server: "another", name: "t2", description: "d2", parameters: { type: "object" } },
        ];
      }
      callTool(name: string, args: Record<string, unknown>) {
        return { ok: true, data: { name, args } };
      }
      on(event: string, cb: (e: unknown) => void) {
        if (event === "log") logs.push(cb);
      }
    }
    const adapted = adaptMcpHostModule({ McpHost: SpecHost });
    expect(adapted).not.toBeNull();
    const host = adapted!.createHost({ server: { id: "spec-srv", command: "x", args: [], env: {} } });
    await host.start();
    expect((host as unknown as { running?: boolean }).running).toBeUndefined(); // 规范化壳不泄漏内部状态
    const tools = await host.listTools();
    expect(tools.map((t) => t.name)).toEqual(["t1"]); // 只保留本服务器
    expect((await host.callTool("t1", { x: 1 })).ok).toBe(true);
    // on("log") 适配为 onEvent
    host.onEvent?.((e) => logs.push({ forwarded: e }));
    expect(host.onEvent).toBeDefined();
  });

  test("adaptMcpHostModule：两种导出皆无 → null；坏 callTool 结果 → MCP_BAD_RESULT", async () => {
    expect(adaptMcpHostModule({ somethingElse: true })).toBeNull();
    const adapted = adaptMcpHostModule({
      createHost: () => ({ start() {}, stop() {}, listTools: () => [], callTool: () => "not-a-result" }),
    });
    const host = adapted!.createHost({ server: { id: "srv", command: "x", args: [], env: {} } });
    const result = await host.callTool("t", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MCP_BAD_RESULT");
  });

  test("settings 迁移容错：旧版 mcp.servers 脏数组 → 降级 []（不判整个文件损坏）", () => {
    const dir = mkdtempSync(join(tmpdir(), "vos-mcp-settings-"));
    try {
      writeFileSync(
        join(dir, "settings.json"),
        JSON.stringify({ general: { theme: "amber" }, mcp: { servers: [{ junk: true }, "garbage"], mergeTools: false } }),
        "utf8",
      );
      const store = new SettingsStore(dir);
      const values = store.get();
      expect(values.mcp.servers).toEqual([]); // 脏数据整组降级
      expect(values.general.theme).toBe("amber"); // 其余设置不受牵连
      expect(values.mcp.mergeTools).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------- E2E（真实端口）

describe("MCP API E2E", () => {
  beforeAll(async () => {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    cpSync(join(REPO_ROOT, "examples", "product-promo"), PROJECT_ROOT, {
      recursive: true,
      filter: (src) => !src.includes(`${join(PROJECT_ROOT, ".video")}`),
    });
    handle = await startStudioServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "vos-mcp-api-")), projectRoot: PROJECT_ROOT });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    await handle.close();
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("host 不可用 → 全部 MCP 端点 501 MCP_HOST_UNAVAILABLE（Agent Kit 入仓后经官方测试钩子模拟缺失，issue #62）", async () => {
    // @videoos/mcp-host 已随 Agent Kit（PR #61）常驻 monorepo，真实缺席不可复现；
    // 用主线自带测试缝 __setMcpHostForTests(null)（注释即"null = 模拟不可用"）覆盖 501 路径
    await handle.state.mcp.__setMcpHostForTests(null);
    for (const [method, path, body] of [
      ["GET", "/api/mcp/status", undefined],
      ["GET", "/api/mcp/servers", undefined],
      ["PUT", "/api/mcp/servers", { servers: [] }],
      ["POST", "/api/mcp/servers/x/start", undefined],
      ["POST", "/api/mcp/servers/x/stop", undefined],
      ["GET", "/api/mcp/tools", undefined],
    ] as const) {
      const res = await send(method, path, body);
      expect(res.status).toBe(501);
      expect(await errorOf(res)).toContain("MCP_HOST_UNAVAILABLE");
    }
  });

  test("注入 fake host：PUT 配置持久化 + enabled 自动启动 + status/tools/白名单 + start/stop/404", async () => {
    const fake = createFakeModule();
    await handle.state.mcp.__setMcpHostForTests(fake.module);

    const put = await sendJson<{ servers: Array<{ id: string; enabled: boolean; whitelist: string[]; timeoutMs: number }> }>("PUT", "/api/mcp/servers", {
      servers: [
        { id: "fake", label: "Fake Server", command: "bun", args: ["run.ts"], env: { A: "1" }, enabled: true },
        { id: "other", command: "bun", enabled: false, whitelist: ["echo"] },
      ],
    });
    expect(put.servers.map((s) => s.id)).toEqual(["fake", "other"]);
    expect(put.servers[0]).toMatchObject({ label: "Fake Server", enabled: true, whitelist: [], timeoutMs: 30_000 }); // 缺省归一
    expect(fake.instances.map((i) => i.serverId)).toEqual(["fake"]); // enabled 自动启动（PUT 全停 → 启用全部 enabled）

    const status = await sendJson<{ available: boolean; servers: Array<{ id: string; label?: string; enabled: boolean; running: boolean; toolCount: number; lastError?: string }> }>("GET", "/api/mcp/status");
    expect(status.available).toBe(true);
    const fakeStatus = status.servers.find((s) => s.id === "fake");
    const otherStatus = status.servers.find((s) => s.id === "other");
    expect(fakeStatus).toMatchObject({ label: "Fake Server", enabled: true, running: true, toolCount: 2 });
    expect(otherStatus).toMatchObject({ enabled: false, running: false });
    expect(fakeStatus?.lastError).toBeUndefined();

    // 聚合工具（仅运行中；白名单空 = 全部）
    const tools = await sendJson<Array<{ serverId: string; name: string; description: string; parameters: Record<string, unknown> }>>("GET", "/api/mcp/tools");
    expect(tools).toEqual([
      { serverId: "fake", name: "echo", description: "Echo the arguments", parameters: { type: "object" } },
      { serverId: "fake", name: "danger", description: "A dangerous tool", parameters: { type: "object" } },
    ]);

    // settings 持久化回读
    const settings = await sendJson<{ mcp: { servers: Array<{ id: string }> } }>("GET", "/api/settings");
    expect(settings.mcp.servers.map((s: { id: string }) => s.id)).toEqual(["fake", "other"]);

    // 启停：幂等 + 白名单过滤聚合 + 404
    const started = await sendJson<{ id: string; running: boolean; toolCount: number }>("POST", "/api/mcp/servers/other/start");
    expect(started).toMatchObject({ id: "other", running: true, toolCount: 2 });
    const again = await sendJson<{ running: boolean }>("POST", "/api/mcp/servers/other/start");
    expect(again.running).toBe(true);
    const toolsWithOther = await sendJson<Array<{ serverId: string; name: string }>>("GET", "/api/mcp/tools");
    expect(toolsWithOther.filter((t) => t.serverId === "other").map((t) => t.name)).toEqual(["echo"]); // 白名单 ["echo"] 过滤 danger
    const stopped = await sendJson<{ id: string; running: boolean }>("POST", "/api/mcp/servers/other/stop");
    expect(stopped).toEqual({ id: "other", running: false });
    const stopAgain = await sendJson<{ running: boolean }>("POST", "/api/mcp/servers/other/stop");
    expect(stopAgain.running).toBe(false);

    for (const path of ["/api/mcp/servers/ghost/start", "/api/mcp/servers/ghost/stop"]) {
      const res = await send("POST", path);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toContain("SERVER_NOT_FOUND");
    }
  });

  test("PUT 校验：非法 id / 缺 command / 重复 id / 非 JSON / 未知字段 → 400", async () => {
    for (const body of [
      { servers: [{ id: "Bad_ID", command: "bun" }] },
      { servers: [{ id: "ok", command: "" }] },
      { servers: [{ id: "dup", command: "bun" }, { id: "dup", command: "bun" }] },
      { servers: "not-an-array" },
      { servers: [{ id: "ok", command: "bun", timeoutMs: 10 }] },
    ]) {
      const res = await send("PUT", "/api/mcp/servers", body);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toContain("SETTINGS_INVALID");
    }
    const notJson = await fetch(`${base}/api/mcp/servers`, { method: "PUT", body: "not-json{{" });
    expect(notJson.status).toBe(400);
    // 清空（不污染后续用例）
    await sendJson("PUT", "/api/mcp/servers", { servers: [] });
    expect((await sendJson<{ servers: unknown[] }>("GET", "/api/mcp/servers")).servers).toEqual([]);
  });

  test("启动失败：PUT 不中断（错误进 lastError）；直接 start → 500 MCP_START_FAILED", async () => {
    const failing = createFakeModule(["boom"]);
    await handle.state.mcp.__setMcpHostForTests(failing.module);
    const put = await sendJson<{ servers: Array<{ id: string }> }>("PUT", "/api/mcp/servers", {
      servers: [{ id: "boom", command: "bun", enabled: true }],
    });
    expect(put.servers.map((s) => s.id)).toEqual(["boom"]); // PUT 本身成功（启动失败被记录）
    const status = await sendJson<{ servers: Array<{ id: string; running: boolean; lastError?: string }> }>("GET", "/api/mcp/status");
    expect(status.servers[0]).toMatchObject({ id: "boom", running: false });
    expect(status.servers[0]?.lastError).toContain("boom-start");

    const direct = await send("POST", "/api/mcp/servers/boom/start");
    expect(direct.status).toBe(500);
    expect(await errorOf(direct)).toContain("MCP_START_FAILED");
  });

  test("mergeTools E2E：mcp_<serverId>_<tool> 桥接 / 白名单拒绝 / mergeTools 关闭 → MCP_TOOL_UNAVAILABLE", async () => {
    const fake = createFakeModule();
    await handle.state.mcp.__setMcpHostForTests(fake.module);
    await sendJson("PUT", "/api/mcp/servers", { servers: [{ id: "fake", command: "bun", enabled: true, whitelist: ["echo"], timeoutMs: 1500 }] });
    await sendJson("PATCH", "/api/settings", { mcp: { mergeTools: true } });

    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "mcptest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "mcp_fake_echo", arguments: { msg: "hi" } }] }, { content: "桥接完成" }],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "MCP 桥接" });
      const run1 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "调用桥接工具" });
      await waitForRunDone(run1.runId);
      const record1 = await sendJson<{ messages: Array<{ runId?: string; toolCalls?: Array<{ name: string; status: string; resultSummary?: string }> }> }>("GET", `/api/sessions/${session.id}`);
      const trail1 = record1.messages.find((m) => m.runId === run1.runId)?.toolCalls ?? [];
      expect(trail1.map((t) => [t.name, t.status])).toEqual([["mcp_fake_echo", "ok"]]); // L3 默认 → mcp 类 allow，无确认
      expect(trail1[0]?.resultSummary).toContain('"server":"fake"'); // host.callTool 数据桥回
      expect(fake.instances[0]?.calls).toContain("call:echo");

      // 白名单拒绝（whitelist=["echo"]，换脚本调用 danger）
      process.env.VIDEOOS_PROVIDERS = JSON.stringify([
        {
          id: "mcptest",
          type: "manual",
          model: "m",
          script: [{ toolCalls: [{ id: "d1", name: "mcp_fake_danger", arguments: {} }] }, { content: "危险工具已试" }],
        },
      ]);
      const run2 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "再调用白名单外工具" });
      await waitForRunDone(run2.runId);
      const record2 = await sendJson<{ messages: Array<{ runId?: string; toolCalls?: Array<{ name: string; status: string; resultSummary?: string }> }> }>("GET", `/api/sessions/${session.id}`);
      const trail2 = record2.messages.find((m) => m.runId === run2.runId)?.toolCalls ?? [];
      expect(trail2[0]?.name).toBe("mcp_fake_danger");
      expect(trail2[0]?.status).toBe("error");
      expect(trail2[0]?.resultSummary).toContain("MCP_TOOL_NOT_WHITELISTED");
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
    }

    // mergeTools 关闭 → 工具不在桥内（调用得到 MCP_TOOL_UNAVAILABLE）
    const prevEnv2 = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "mcptest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "mcp_fake_echo", arguments: {} }] }, { content: "完成" }],
      },
    ]);
    try {
      await sendJson("PATCH", "/api/settings", { mcp: { mergeTools: false } });
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "MCP 关闭" });
      const run3 = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "关闭合并" });
      await waitForRunDone(run3.runId);
      const record3 = await sendJson<{ messages: Array<{ runId?: string; toolCalls?: Array<{ name: string; status: string; resultSummary?: string }> }> }>("GET", `/api/sessions/${session.id}`);
      const trail3 = record3.messages.find((m) => m.runId === run3.runId)?.toolCalls ?? [];
      expect(trail3[0]?.status).toBe("error");
      expect(trail3[0]?.resultSummary).toContain("MCP_TOOL_UNAVAILABLE");
    } finally {
      if (prevEnv2 === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv2;
      await sendJson("POST", "/api/settings/reset", { sections: ["mcp"] });
    }
  }, 90_000);
});

async function waitForRunDone(runId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${base}/api/events`);
    const events = ((await res.json()) as { events: Array<{ type: string; runId?: string }> }).events;
    if (events.some((e) => e.type === "agent-run-done" && e.runId === runId)) return;
    if (Date.now() > deadline) throw new Error(`waitFor run-done timeout: ${runId}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}
