// 权限矩阵 + 确认流测试（issue #54）：
// - 单元：resolvePermission（L1-L4 代表工具 / 显式覆盖 / mcp 类目与逐工具覆盖）
// - 单元：GatedRegistry（list 合并 mcp_ / deny / 危险模式硬拒 / allow 透传 / 确认流 allow-always-deny /
//   超时默认拒 / 停止即拒 / mcp 桥接与权限）
// - E2E（真实端口）：确认流全链路（agent-confirm 事件 → resolve → 继续）、always 持久化与免确认、
//   超时默认拒（短超时注入）+ 迟到 resolve 404、停止即拒、deny、危险模式、resolve 参数校验
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { VapContext, VapToolInfo, VapToolResult } from "@videoos/agent";
import { startStudioServer, type StudioServerHandle } from "../index";
import type { ServerEvent } from "../state";
import { SettingsStore } from "../settings/store";
import { ConfirmCenter, GatedRegistry, resolvePermission, type AgentGateSettings, type GatedRegistryOptions } from "./gate";
import type { McpToolSource } from "./mcp";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");

// ---------------------------------------------------------------- 单元：resolvePermission

const L = (autonomy: "L1" | "L2" | "L3" | "L4", extra: Partial<AgentGateSettings> = {}): AgentGateSettings => ({
  autonomy,
  toolPermissions: {},
  confirmRender: true,
  dangerousPatterns: [],
  ...extra,
});

describe("resolvePermission 单元（L1-L4 预设 + 覆盖）", () => {
  test("L1：纯检查 allow，其余全部 confirm（含 mcp_*）", () => {
    for (const tool of ["compile.diagnostics", "compile.vir", "scene.list", "scene.inspect", "layer.inspect", "asset.list", "audio.list", "render.status", "cache.stats", "test.results", "transaction.list", "inspect.frame", "diff.frames", "check.overflow", "check.missingAssets", "storyboard.plan"]) {
      expect(resolvePermission(tool, L("L1"))).toBe("allow");
    }
    for (const tool of ["compile.run", "render.preview", "render.final", "cache.clear", "scene.modify", "test.run", "transaction.begin", "storyboard.toScenes", "render.cancel"]) {
      expect(resolvePermission(tool, L("L1"))).toBe("confirm");
    }
    expect(resolvePermission("mcp_x_y", L("L1"))).toBe("confirm");
  });

  test("L2：纯检查 + 核心变更 allow；危险变更 confirm", () => {
    for (const tool of ["compile.run", "render.preview", "render.range", "render.cancel", "test.run", "transaction.begin", "transaction.commit", "transaction.rollback", "storyboard.toScenes"]) {
      expect(resolvePermission(tool, L("L2"))).toBe("allow");
    }
    for (const tool of ["scene.modify", "layer.modify", "audio.set", "asset.add", "render.final", "cache.clear"]) {
      expect(resolvePermission(tool, L("L2"))).toBe("confirm");
    }
    expect(resolvePermission("compile.vir", L("L2"))).toBe("allow");
    expect(resolvePermission("mcp_x_y", L("L2"))).toBe("confirm");
  });

  test("L3：全 allow 除 render.final（confirmRender 时 confirm）与 cache.clear（恒 confirm）", () => {
    for (const tool of ["compile.run", "render.preview", "scene.modify", "layer.modify", "test.run", "transaction.commit", "render.cancel", "storyboard.toScenes"]) {
      expect(resolvePermission(tool, L("L3"))).toBe("allow");
    }
    expect(resolvePermission("render.final", L("L3"))).toBe("confirm"); // confirmRender=true
    expect(resolvePermission("render.final", L("L3", { confirmRender: false }))).toBe("allow");
    expect(resolvePermission("cache.clear", L("L3"))).toBe("confirm");
    expect(resolvePermission("mcp_x_y", L("L3"))).toBe("allow");
  });

  test("L4：全部 allow（含 render.final / cache.clear / mcp）", () => {
    for (const tool of ["render.final", "cache.clear", "scene.modify", "mcp_x_y"]) {
      expect(resolvePermission(tool, L("L4"))).toBe("allow");
    }
  });

  test("显式覆盖最高优先：任意级别可放行/拒绝；mcp 类目覆盖与逐工具覆盖", () => {
    expect(resolvePermission("cache.clear", L("L1", { toolPermissions: { "cache.clear": "allow" } }))).toBe("allow");
    expect(resolvePermission("render.final", L("L4", { toolPermissions: { "render.final": "deny" } }))).toBe("deny");
    expect(resolvePermission("compile.run", L("L3", { toolPermissions: { "compile.run": "confirm" } }))).toBe("confirm");
    // mcp 类目（"mcp" 键）
    expect(resolvePermission("mcp_a_t", L("L3", { toolPermissions: { mcp: "deny" } }))).toBe("deny");
    expect(resolvePermission("mcp_a_t", L("L1", { toolPermissions: { mcp: "allow" } }))).toBe("allow");
    // 逐工具覆盖优先于类目
    expect(resolvePermission("mcp_a_t", L("L3", { toolPermissions: { mcp: "allow", "mcp_a_t": "confirm" } }))).toBe("confirm");
    // VAP 工具不受 "mcp" 类目影响
    expect(resolvePermission("cache.clear", L("L3", { toolPermissions: { mcp: "deny" } }))).toBe("confirm");
  });
});

// ---------------------------------------------------------------- 单元：GatedRegistry

const unitRoot = mkdtempSync(join(tmpdir(), "vos-gate-"));
let storeSeq = 0;
const newStore = (): SettingsStore => new SettingsStore(join(unitRoot, `store-${storeSeq++}`));
const ctx = { __test: true } as unknown as VapContext; // 假注册表不消费 ctx

afterAll(async () => {
  rmSync(unitRoot, { recursive: true, force: true });
});

interface FakeRegistry {
  list(): VapToolInfo[];
  call(name: string, args: unknown, ctx: VapContext): Promise<VapToolResult>;
}

function fakeRegistry(): { registry: FakeRegistry; calls: Array<{ name: string; args: unknown }> } {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    registry: {
      list: () => [{ name: "compile.run", description: "Run compiler", parameters: { type: "object" } }],
      call: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, data: { echoed: name } };
      },
    },
  };
}

function fakeMcp(): { source: McpToolSource; calls: Array<{ prefixed: string; args: Record<string, unknown> }> } {
  const calls: Array<{ prefixed: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    source: {
      aggregatedTools: () => [
        { serverId: "fake", name: "echo", description: "Echo", parameters: { type: "object" } },
        { serverId: "fake", name: "danger", description: "Danger", parameters: { type: "object" } },
      ],
      callTool: async (prefixed, args) => {
        calls.push({ prefixed, args });
        return { ok: true, data: { bridged: prefixed } };
      },
    },
  };
}

function newGated(overrides: Partial<GatedRegistryOptions> = {}): {
  gate: GatedRegistry;
  registry: FakeRegistry;
  innerCalls: Array<{ name: string; args: unknown }>;
  confirms: ConfirmCenter;
  events: ServerEvent[];
  settings: SettingsStore;
} {
  const { registry, calls } = fakeRegistry();
  const confirms = new ConfirmCenter();
  const events: ServerEvent[] = [];
  const settings = newStore();
  const gate = new GatedRegistry({
    registry,
    agent: L("L3"),
    mcp: null,
    settings,
    confirms,
    emit: (e) => events.push(e),
    run: { sessionId: "s_gate", runId: "r_gate", isStopped: () => false },
    ...overrides,
  });
  return { gate, registry, innerCalls: calls, confirms, events, settings };
}

const confirmEventOf = (events: ServerEvent[]) => events.find((e): e is Extract<ServerEvent, { type: "agent-confirm" }> => e.type === "agent-confirm");

describe("GatedRegistry 单元", () => {
  test("list()：VAP 全量 + mergeTools 时 mcp_<serverId>_<tool>（描述加 [MCP/<id>] 前缀）", () => {
    const mcp = fakeMcp();
    const withMcp = newGated({ mcp: mcp.source });
    const names = withMcp.gate.list().map((t) => t.name);
    expect(names).toContain("compile.run");
    expect(names).toContain("mcp_fake_echo");
    const info = withMcp.gate.list().find((t) => t.name === "mcp_fake_danger");
    expect(info?.description).toBe("[MCP/fake] Danger");

    const withoutMcp = newGated({ mcp: null });
    expect(withoutMcp.gate.list().some((t) => t.name.startsWith("mcp_"))).toBe(false);
  });

  test("deny：PERMISSION_DENIED，不触达注册表，不发确认事件", async () => {
    const g = newGated({ agent: L("L4", { toolPermissions: { "compile.run": "deny" } }) });
    const result = await g.gate.call("compile.run", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
    expect(g.innerCalls).toHaveLength(0);
    expect(confirmEventOf(g.events)).toBeUndefined();
  });

  test("allow：透传（结果/参数原样）", async () => {
    const g = newGated();
    const result = await g.gate.call("compile.run", { x: 1 }, ctx);
    expect(result).toEqual({ ok: true, data: { echoed: "compile.run" } });
    expect(g.innerCalls).toEqual([{ name: "compile.run", args: { x: 1 } }]);
  });

  test("危险模式：命中 → 硬拒绝（优先于 allow/confirm）；非法正则跳过不炸", async () => {
    const g = newGated({ agent: L("L4", { dangerousPatterns: ["\"frame\"\\s*:\\s*999", "no-match-here"] }) });
    const hit = await g.gate.call("render.preview", { frame: 999 }, ctx); // L4 本应 allow
    expect(hit).toEqual({ ok: false, error: 'DANGER_PATTERN_MATCHED: "frame"\\s*:\\s*999' });
    expect(g.innerCalls).toHaveLength(0);

    const invalid = newGated({ agent: L("L4", { dangerousPatterns: ["[invalid-regex", "9999"] }) });
    const pass = await invalid.gate.call("render.preview", { frame: 30 }, ctx); // 非法正则跳过；9999 不命中
    expect(pass.ok).toBe(true);
    expect(invalid.innerCalls).toHaveLength(1);
  });

  test("确认流 allow：agent-confirm 事件 → resolve allow → 放行", async () => {
    const g = newGated({ agent: L("L1") }); // compile.run → confirm
    const promise = g.gate.call("compile.run", { a: 1 }, ctx);
    const confirm = confirmEventOf(g.events);
    expect(confirm).toMatchObject({ sessionId: "s_gate", runId: "r_gate", tool: { name: "compile.run", args: { a: 1 } } });
    expect(confirm?.confirmId).toMatch(/^cf_/);
    expect(g.confirms.resolve(confirm!.confirmId, "allow")).toBe(true);
    expect(await promise).toEqual({ ok: true, data: { echoed: "compile.run" } });
    // 已裁决 → 重复 resolve false
    expect(g.confirms.resolve(confirm!.confirmId, "deny")).toBe(false);
  });

  test("确认流 always：放行 + toolPermissions 持久化 + 本运行后续免确认", async () => {
    const g = newGated({ agent: L("L1") });
    const first = g.gate.call("compile.run", {}, ctx);
    const confirm1 = confirmEventOf(g.events);
    g.confirms.resolve(confirm1!.confirmId, "always");
    expect(await first).toEqual({ ok: true, data: { echoed: "compile.run" } });
    expect(g.settings.get().agent.toolPermissions["compile.run"]).toBe("allow"); // 持久化
    // 同一 gate（同一运行快照）再调用 → 不再确认
    const second = await g.gate.call("compile.run", {}, ctx);
    expect(second.ok).toBe(true);
    expect(g.events.filter((e) => e.type === "agent-confirm")).toHaveLength(1);
  });

  test("确认流 deny：用户拒绝 → PERMISSION_DENIED 且不触达注册表", async () => {
    const g = newGated({ agent: L("L1") });
    const promise = g.gate.call("compile.run", {}, ctx);
    g.confirms.resolve(confirmEventOf(g.events)!.confirmId, "deny");
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
    expect(g.innerCalls).toHaveLength(0);
  });

  test("确认流超时：默认拒（短超时注入）；迟到 resolve → false", async () => {
    const g = newGated({ agent: L("L1"), confirmTimeoutMs: 120 });
    const startedAt = Date.now();
    const promise = g.gate.call("compile.run", {}, ctx);
    const result = await promise;
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
    expect(g.innerCalls).toHaveLength(0);
    expect(g.confirms.resolve(confirmEventOf(g.events)!.confirmId, "allow")).toBe(false); // 已被超时清位
  });

  test("确认挂起中停止：立即拒（isStopped 轮询胜出）", async () => {
    let stopped = false;
    const g = newGated({ agent: L("L1"), run: { sessionId: "s", runId: "r", isStopped: () => stopped } });
    const promise = g.gate.call("compile.run", {}, ctx);
    setTimeout(() => {
      stopped = true;
    }, 60);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("PERMISSION_DENIED");
    expect(g.innerCalls).toHaveLength(0);
  });

  test("mcp 桥接：L3 allow 直连；类目 deny / 逐工具 confirm 生效；无源 → MCP_TOOL_UNAVAILABLE", async () => {
    const mcp = fakeMcp();
    const g = newGated({ mcp: mcp.source });
    const ok = await g.gate.call("mcp_fake_echo", { x: 1 }, ctx);
    expect(ok).toEqual({ ok: true, data: { bridged: "mcp_fake_echo" } });
    expect(mcp.calls).toEqual([{ prefixed: "mcp_fake_echo", args: { x: 1 } }]);

    const denied = newGated({ mcp: mcp.source, agent: L("L3", { toolPermissions: { mcp: "deny" } }) });
    const deniedResult = await denied.gate.call("mcp_fake_echo", {}, ctx);
    expect(deniedResult.ok).toBe(false);
    expect(deniedResult.error).toContain("PERMISSION_DENIED");

    const confirmGate = newGated({ mcp: mcp.source, agent: L("L3", { toolPermissions: { mcp: "allow", "mcp_fake_echo": "confirm" } }) });
    const promise = confirmGate.gate.call("mcp_fake_echo", {}, ctx);
    expect(confirmEventOf(confirmGate.events)?.tool.name).toBe("mcp_fake_echo");
    confirmGate.confirms.resolve(confirmEventOf(confirmGate.events)!.confirmId, "allow");
    expect((await promise).ok).toBe(true);

    const noSource = newGated({ mcp: null });
    const unavailable = await noSource.gate.call("mcp_fake_echo", {}, ctx);
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error).toContain("MCP_TOOL_UNAVAILABLE");
  });
});

// ---------------------------------------------------------------- E2E（真实端口）

const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-demo", `gate-e2e-${process.pid}`);
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

const resetAgentSettings = (): Promise<unknown> => sendJson("POST", "/api/settings/reset", { sections: ["agent"] });

const resetProviders = (): Promise<unknown> => sendJson("POST", "/api/settings/reset", { sections: ["providers"] });

async function fetchEvents(): Promise<ServerEvent[]> {
  const res = await fetch(`${base}/api/events`);
  return ((await res.json()) as { events: ServerEvent[] }).events;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 30_000, what = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function awaitRunDone(runId: string, timeoutMs = 30_000): Promise<Extract<ServerEvent, { type: "agent-run-done" }>> {
  await waitFor(async () => (await fetchEvents()).some((e) => e.type === "agent-run-done" && e.runId === runId), timeoutMs, `run-done ${runId}`);
  return (await fetchEvents()).find((e): e is Extract<ServerEvent, { type: "agent-run-done" }> => e.type === "agent-run-done" && e.runId === runId)!;
}

/** 等 agent-confirm 到达（环形缓冲轮询）并返回之 */
async function awaitConfirm(runId: string, timeoutMs = 30_000): Promise<Extract<ServerEvent, { type: "agent-confirm" }>> {
  await waitFor(
    async () => (await fetchEvents()).some((e) => e.type === "agent-confirm" && e.runId === runId),
    timeoutMs,
    `agent-confirm ${runId}`,
  );
  return (await fetchEvents()).find((e): e is Extract<ServerEvent, { type: "agent-confirm" }> => e.type === "agent-confirm" && e.runId === runId)!;
}

interface SessionRecordShape {
  messages: Array<{ runId?: string; content: string; toolCalls?: Array<{ name: string; status: string; resultSummary?: string; args?: unknown }> }>;
}

async function trailOfSession(sessionId: string, runId: string): Promise<Array<{ name: string; status: string; resultSummary?: string }>> {
  const record = await sendJson<SessionRecordShape>("GET", `/api/sessions/${sessionId}`);
  return record.messages.find((m) => m.runId === runId)?.toolCalls ?? [];
}

describe("权限门 + 确认流 E2E", () => {
  beforeAll(async () => {
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
    mkdirSync(FIXTURE_ROOT, { recursive: true });
    cpSync(join(REPO_ROOT, "examples", "product-promo"), PROJECT_ROOT, {
      recursive: true,
      filter: (src) => !src.includes(`${join(PROJECT_ROOT, ".video")}`),
    });
    handle = await startStudioServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "vos-gate-api-")), projectRoot: PROJECT_ROOT });
    base = `http://127.0.0.1:${handle.port}`;
  });

  afterAll(async () => {
    handle.state.chat.__setGateOptionsForTests(null);
    await handle.close();
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("确认流 allow：L1 下 cache.clear 挂起 → agent-confirm 事件 → resolve allow → 工具执行 → run 完成", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { autonomy: "L1" } });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "cache.clear", arguments: {} }] }, { content: "缓存已清理" }],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "确认 allow" });
      const { runId } = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "清理缓存" });
      const confirm = await awaitConfirm(runId);
      expect(confirm.tool).toEqual({ name: "cache.clear", args: {} });
      expect(confirm.sessionId).toBe(session.id);

      const resolved = await sendJson<{ resolved: boolean }>("POST", "/api/agent/resolve", { confirmId: confirm.confirmId, decision: "allow" });
      expect(resolved).toEqual({ resolved: true });

      const done = await awaitRunDone(runId);
      expect(done.ok).toBe(true);
      const trail = await trailOfSession(session.id, runId);
      expect(trail.map((t) => [t.name, t.status])).toEqual([["cache.clear", "ok"]]); // 允许后真实执行
      // agent-resolved 事件（UI 同步）
      expect((await fetchEvents()).some((e) => e.type === "agent-resolved" && e.confirmId === confirm.confirmId)).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }
  }, 60_000);

  test("确认流 always：放行 + toolPermissions 持久化；第二次运行免确认直通", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { autonomy: "L1" } });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "cache.clear", arguments: {} }] }, { content: "再次清理" }],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "确认 always" });
      const first = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "清理缓存" });
      const confirm = await awaitConfirm(first.runId);
      await sendJson("POST", "/api/agent/resolve", { confirmId: confirm.confirmId, decision: "always" });
      const done1 = await awaitRunDone(first.runId);
      expect(done1.ok).toBe(true);
      expect((await trailOfSession(session.id, first.runId))[0]?.status).toBe("ok");

      // 持久化：settings.agent.toolPermissions.cache.clear = allow
      const settings = await sendJson<{ agent: { toolPermissions: Record<string, string> } }>("GET", "/api/settings");
      expect(settings.agent.toolPermissions["cache.clear"]).toBe("allow");

      // 第二次运行：无确认事件，工具直通
      const second = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "再清一次" });
      const done2 = await awaitRunDone(second.runId);
      expect(done2.ok).toBe(true);
      expect((await trailOfSession(session.id, second.runId))[0]?.status).toBe("ok");
      expect((await fetchEvents()).some((e) => e.type === "agent-confirm" && e.runId === second.runId)).toBe(false);
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }
  }, 60_000);

  test("确认超时：默认拒（短超时注入）→ 工具 error PERMISSION_DENIED → 迟到 resolve 404", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { autonomy: "L1" } });
    handle.state.chat.__setGateOptionsForTests({ confirmTimeoutMs: 300 });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "cache.clear", arguments: {} }] }, { content: "超时后的回答" }],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "确认超时" });
      const { runId } = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "清理缓存" });
      const confirm = await awaitConfirm(runId);
      const done = await awaitRunDone(runId);
      expect(done.ok).toBe(true); // manual 脚本继续走完（LLM 读到拒绝错误）
      const trail = await trailOfSession(session.id, runId);
      expect(trail[0]?.status).toBe("error");
      expect(trail[0]?.resultSummary).toContain("PERMISSION_DENIED");
      // 挂起已被超时清位 → 迟到 resolve 404
      const late = await send("POST", "/api/agent/resolve", { confirmId: confirm.confirmId, decision: "allow" });
      expect(late.status).toBe(404);
      expect(await errorOf(late)).toContain("CONFIRM_NOT_FOUND");
      // 设置未被污染
      const settings = await sendJson<{ agent: { toolPermissions: Record<string, string> } }>("GET", "/api/settings");
      expect(settings.agent.toolPermissions["cache.clear"]).toBeUndefined();
    } finally {
      handle.state.chat.__setGateOptionsForTests(null);
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }
  }, 60_000);

  test("停止：确认挂起期间 stop → 立即拒 + run STOPPED 收尾", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { autonomy: "L1" } });
    handle.state.chat.__setGateOptionsForTests({ confirmTimeoutMs: 30_000 });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [{ toolCalls: [{ id: "c1", name: "cache.clear", arguments: {} }] }, { content: "不应到达" }],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "确认停止" });
      const { runId } = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "清理缓存" });
      await awaitConfirm(runId);
      await sendJson("POST", "/api/agent/stop", { runId });
      const done = await awaitRunDone(runId);
      expect(done.ok).toBe(false);
      expect(done.error).toBe("STOPPED");
      const trail = await trailOfSession(session.id, runId);
      expect(trail[0]?.status).toBe("error"); // 停止即拒（LLM 不再消费）
      expect(trail[0]?.resultSummary).toContain("PERMISSION_DENIED");
    } finally {
      handle.state.chat.__setGateOptionsForTests(null);
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }
  }, 60_000);

  test("deny 与危险模式：无确认事件直拒；L3 演示工具不受影响", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { toolPermissions: { "cache.clear": "deny" }, dangerousPatterns: ["frame"] } });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [
          { toolCalls: [{ id: "c1", name: "cache.clear", arguments: {} }] },
          { toolCalls: [{ id: "c2", name: "render.preview", arguments: { frame: 30 } }] },
          { content: "两个都被拒绝" },
        ],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "deny 模式" });
      const { runId } = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "危险操作" });
      const done = await awaitRunDone(runId);
      expect(done.ok).toBe(true);
      const trail = await trailOfSession(session.id, runId);
      expect(trail.map((t) => t.name)).toEqual(["cache.clear", "render.preview"]);
      expect(trail[0]?.status).toBe("error");
      expect(trail[0]?.resultSummary).toContain("PERMISSION_DENIED"); // deny 覆盖（L3 本应 confirm）
      expect(trail[1]?.status).toBe("error");
      expect(trail[1]?.resultSummary).toContain("DANGER_PATTERN_MATCHED: frame"); // 危险模式优先于 L3 allow
      // 全程无确认事件
      expect((await fetchEvents()).some((e) => e.type === "agent-confirm" && e.runId === runId)).toBe(false);
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }
  }, 60_000);

  test("L4 + confirmRender=false：render.final / cache.clear 全直通（无确认）；resolve 参数校验", async () => {
    await resetAgentSettings();
    await resetProviders();
    await sendJson("PATCH", "/api/settings", { agent: { autonomy: "L4", confirmRender: false } });
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "gatetest",
        type: "manual",
        model: "m",
        script: [
          { toolCalls: [{ id: "c1", name: "cache.stats", arguments: {} }, { id: "c2", name: "cache.clear", arguments: {} }] },
          { content: "全自动完成" },
        ],
      },
    ]);
    try {
      const session = await sendJson<{ id: string }>("POST", "/api/sessions", { title: "L4 全自动" });
      const { runId } = await sendJson<{ runId: string }>("POST", "/api/agent/chat", { sessionId: session.id, message: "全自动跑" });
      const done = await awaitRunDone(runId);
      expect(done.ok).toBe(true);
      const trail = await trailOfSession(session.id, runId);
      expect(trail.map((t) => t.status)).toEqual(["ok", "ok"]); // cache.stats + cache.clear 全直通
      expect((await fetchEvents()).some((e) => e.type === "agent-confirm" && e.runId === runId)).toBe(false);
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
      await resetAgentSettings();
    }

    // resolve 参数校验（无挂起也可校验）
    const bogus = await send("POST", "/api/agent/resolve", { confirmId: "cf_bogus", decision: "allow" });
    expect(bogus.status).toBe(404);
    expect(await errorOf(bogus)).toContain("CONFIRM_NOT_FOUND");
    const badDecision = await send("POST", "/api/agent/resolve", { confirmId: "cf_x", decision: "maybe" });
    expect(badDecision.status).toBe(400);
    const missingId = await send("POST", "/api/agent/resolve", { decision: "allow" });
    expect(missingId.status).toBe(400);
  }, 60_000);
});
