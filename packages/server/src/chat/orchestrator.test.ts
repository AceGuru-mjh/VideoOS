// ChatOrchestrator E2E（issue #49，真实端口，全离线）：
// - 演示模式（settings manual 条目 → 内置演示脚本）对 examples/product-promo 全链路
// - OpenAI 兼容桩：usage 累计、多轮历史映射（工具执行记录注记）、tool 消息形状、系统提示组装
// - 停止（慢桩响应期间 stop → STOPPED + trailing toolCalls stopped）
// - 409（PROVIDER_NONE / SESSION_NO_PROJECT / CHAT_RUN_ACTIVE）与 maxSteps 封顶
// fixture：product-promo 复制到 packages/.tmp-demo/chat-e2e-<pid>/（repo 子树内 → @videoos/dsl 可解析）
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { startStudioServer, type StudioServerHandle } from "../index";
import type { ChatStreamEvent, ServerEvent } from "../state";
import type { ChatMessageRecord, ChatToolCallRecord, SessionRecord } from "./sessions";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", ".."); // 仓库根（本文件位于 packages/server/src/chat/）
const FIXTURE_ROOT = join(REPO_ROOT, ".tmp-demo", `chat-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "product-promo");
const OTHER_ROOT = join(FIXTURE_ROOT, "other");

let handle: StudioServerHandle;
let base: string;

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  // 复制示例项目（排除 .video 运行产物，保持用例间冷启动一致）
  cpSync(join(REPO_ROOT, "examples", "product-promo"), PROJECT_ROOT, {
    recursive: true,
    filter: (src) => !src.includes(`${join(PROJECT_ROOT, ".video")}`),
  });
  await ProjectWorkspace.init(OTHER_ROOT, { name: "other" });
  await createProjectTemplate(OTHER_ROOT, "other");
  handle = await startStudioServer({ port: 0, dataDir: mkdtempSync(join(tmpdir(), "vos-chat-")), projectRoot: PROJECT_ROOT });
  base = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 助手

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

/** 恢复 providers 节为默认（隔离用例间供应商状态） */
const resetProviders = (): Promise<unknown> => sendJson("POST", "/api/settings/reset", { sections: ["providers"] });

const addProvider = (entry: Record<string, unknown>): Promise<unknown> => sendJson("POST", "/api/providers", { entry });
const addDemoProvider = (): Promise<unknown> =>
  addProvider({ id: "demo", type: "manual", label: "演示", baseUrl: "", model: "demo" });

const createSession = (body: Record<string, unknown> = {}): Promise<SessionRecord> => sendJson("POST", "/api/sessions", body);

const startChat = (sessionId: string, message: string, maxSteps?: number): Promise<{ runId: string }> =>
  sendJson("POST", "/api/agent/chat", { sessionId, message, ...(maxSteps !== undefined ? { maxSteps } : {}) });

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 30_000, what = "condition"): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** 环形缓冲回放（GET /api/events） */
async function fetchEvents(): Promise<ServerEvent[]> {
  const res = await fetch(`${base}/api/events`);
  return ((await res.json()) as { events: ServerEvent[] }).events;
}

function isChatEvent(e: ServerEvent): e is ChatStreamEvent {
  return e.type === "agent-run-start" || e.type === "agent-text" || e.type === "agent-tool" || e.type === "agent-run-done";
}

/** 某 run 的全部 chat 事件（经环形缓冲） */
async function chatEventsOf(runId: string): Promise<ChatStreamEvent[]> {
  return (await fetchEvents()).filter(isChatEvent).filter((e) => e.runId === runId);
}

/** 等待某 run 的 run-done 到达并取回该 run 的全部 chat 事件 */
async function awaitRunDone(runId: string, timeoutMs = 30_000): Promise<ChatStreamEvent[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await chatEventsOf(runId);
    if (events.some((e) => e.type === "agent-run-done")) return events;
    if (Date.now() > deadline) throw new Error(`waitFor run-done timeout: ${runId}`);
    await new Promise((r) => setTimeout(r, 60));
  }
}

/** WS 事件收集器（模式同 app.test.ts：先等 open 再触发动作） */
function openEventSocket(): { events: ServerEvent[]; opened: Promise<void>; close(): void } {
  const events: ServerEvent[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
  const opened = new Promise<void>((res) => {
    ws.onopen = () => res();
  });
  ws.onmessage = (ev: MessageEvent) => {
    events.push(JSON.parse(String(ev.data)) as ServerEvent);
  };
  return { events, opened, close: () => ws.close() };
}

// ---------------------------------------------------------------- 本地 OpenAI 兼容桩（离线）

interface StubHandle {
  port: number;
  close(): Promise<void>;
}

async function startStub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<StubHandle> {
  const server: Server = createServer(handler);
  const sockets = new Set<{ destroy(): void }>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () => {
      for (const s of sockets) s.destroy();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk as string));
    req.on("end", () => resolveBody(data));
  });
}

/** OpenAI chat/completions wire 响应 */
function wire(body: {
  content: string;
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}): string {
  return JSON.stringify({
    choices: [
      {
        message: {
          content: body.content,
          ...(body.toolCalls !== undefined
            ? {
                tool_calls: body.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                })),
              }
            : {}),
        },
      },
    ],
    ...(body.usage !== undefined ? { usage: body.usage } : {}),
  });
}

/** 按序返回脚本响应（耗尽重复最后一个）；记录命中体；可注入延迟（慢响应/停止路径） */
function openaiStub(plan: { responses: string[]; delayMs?: number; hits?: string[] }): Promise<StubHandle> {
  return startStub((req, res) => {
    if (req.method === "POST" && (req.url ?? "") === "/v1/chat/completions") {
      void readBody(req).then((body) => {
        plan.hits?.push(body);
        const index = (plan.hits?.length ?? 1) - 1;
        const payload = plan.responses[Math.min(index, plan.responses.length - 1)] ?? wire({ content: "done" });
        const respond = (): void => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(payload);
        };
        if (plan.delayMs !== undefined) setTimeout(respond, plan.delayMs);
        else respond();
      });
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
}

// ================================================================= E2E

describe("ChatOrchestrator E2E（demo / 桩 / 停止 / 409 / maxSteps）", () => {
  test("演示模式全链路：manual demo 条目 → 规划 → compile.run → render.preview → 总结（WS 实时 + 落库 + 回放）", async () => {
    await resetProviders();
    await addDemoProvider();
    const session = await createSession({ title: "演示会话" });
    expect(session.projectRoot).toBe(PROJECT_ROOT);

    const ws = openEventSocket();
    await ws.opened;
    const { runId } = await startChat(session.id, "做一个产品介绍视频");
    expect(runId).toMatch(/^r_/);

    await waitFor(
      () => ws.events.filter(isChatEvent).some((e) => e.type === "agent-run-done" && e.runId === runId),
      30_000,
      "demo run-done over ws",
    );
    ws.close();

    const events = ws.events.filter(isChatEvent).filter((e) => e.runId === runId);
    const types = events.map((e) => e.type);
    // 事件序列：run-start → 文本（规划，与工具调用同回）→ compile.run start/ok → render.preview start/ok → 文本（总结）→ run-done
    expect(types[0]).toBe("agent-run-start");
    expect(types[types.length - 1]).toBe("agent-run-done");
    expect(types.filter((t) => t === "agent-text")).toHaveLength(2);
    expect(types).toEqual([
      "agent-run-start",
      "agent-text",
      "agent-tool",
      "agent-tool",
      "agent-tool",
      "agent-tool",
      "agent-text",
      "agent-run-done",
    ]);
    const toolEvents = events.filter((e): e is Extract<ChatStreamEvent, { type: "agent-tool" }> => e.type === "agent-tool");
    expect(toolEvents.map((e) => [e.name, e.status])).toEqual([
      ["compile.run", "start"],
      ["compile.run", "ok"],
      ["render.preview", "start"],
      ["render.preview", "ok"],
    ]);
    const previewOk = toolEvents.find((e) => e.name === "render.preview" && e.status === "ok");
    expect(previewOk?.frame).toBe(30); // product-promo 330 帧 → frame 30 不被 clamp
    expect(previewOk?.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof previewOk?.resultSummary).toBe("string");
    const done = events.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
    expect(done?.ok).toBe(true);
    expect(done?.steps).toBe(3);
    expect(done?.usage).toBeUndefined(); // ManualProvider 无 usage
    expect(done?.error).toBeUndefined();

    // 落库：user + assistant（runId + 完整工具轨迹 + 最终文本）
    const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
    expect(record.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const user = record.messages[0] as ChatMessageRecord;
    expect(user.content).toBe("做一个产品介绍视频");
    const assistant = record.messages[1] as ChatMessageRecord;
    expect(assistant.runId).toBe(runId);
    expect(assistant.content).toContain("演示流程完成");
    expect(assistant.usage).toBeUndefined();
    const trail = (assistant.toolCalls ?? []) as ChatToolCallRecord[];
    expect(trail.map((t) => [t.name, t.status])).toEqual([
      ["compile.run", "ok"],
      ["render.preview", "ok"],
    ]);
    expect(trail[1]?.frame).toBe(30);
    expect(typeof trail[0]?.resultSummary).toBe("string");

    // 活跃运行已清空 + 环形缓冲可回放（重连 backfill）
    expect(await sendJson<unknown>("GET", "/api/agent/run/active")).toBeNull();
    const ring = await fetchEvents();
    expect(ring.filter(isChatEvent).some((e) => e.type === "agent-run-done" && e.runId === runId)).toBe(true);
  }, 60_000);

  test("OpenAI 桩：usage 跨步累计 + tool 消息形状 + 多轮历史映射 + 系统提示组装（项目上下文 / 技能 / 步数）", async () => {
    const hits: string[] = [];
    const stub = await openaiStub({
      hits,
      responses: [
        wire({
          content: "我先看看场景结构",
          toolCalls: [{ id: "call_1", name: "scene.list", args: {} }],
          usage: { prompt_tokens: 40, completion_tokens: 10 },
        }),
        wire({ content: "场景确认完毕，可以开始制作。", usage: { prompt_tokens: 60, completion_tokens: 25 } }),
        wire({ content: "第二轮收到。", usage: { prompt_tokens: 7, completion_tokens: 3 } }),
      ],
    });
    try {
      await resetProviders();
      await addProvider({ id: "stub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${stub.port}/v1`, model: "gpt-test" });
      const session = await createSession({ title: "桩会话" });

      // 第一轮：工具调用 → 最终回答
      const { runId } = await startChat(session.id, "帮我看看这个项目");
      const events = await awaitRunDone(runId);
      const done = events.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
      expect(done?.ok).toBe(true);
      expect(done?.steps).toBe(2);
      expect(done?.usage).toEqual({ promptTokens: 100, completionTokens: 35 }); // 40+10 / 60+25 累计
      const toolEvents = events.filter((e): e is Extract<ChatStreamEvent, { type: "agent-tool" }> => e.type === "agent-tool");
      expect(toolEvents.map((e) => [e.name, e.status])).toEqual([
        ["scene.list", "start"],
        ["scene.list", "ok"],
      ]);

      // 第二个请求体：assistant 携带 tool_calls + tool 消息带 tool_call_id/name（provider 契约形状）
      const second = JSON.parse(hits[1] ?? "{}") as { messages?: Array<Record<string, unknown>> };
      const secondMessages = second.messages ?? [];
      expect(secondMessages.some((m) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
      expect(secondMessages.some((m) => m.role === "tool" && m.tool_call_id === "call_1" && m.name === "scene.list")).toBe(true);

      // 落库：content=最终回合文本，usage=累计值，toolCalls 轨迹
      const record1 = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
      const assistant1 = record1.messages.find((m) => m.runId === runId) as ChatMessageRecord;
      expect(assistant1.content).toBe("场景确认完毕，可以开始制作。");
      expect(assistant1.usage).toEqual({ promptTokens: 100, completionTokens: 35 });
      expect((assistant1.toolCalls ?? []).map((t) => t.name)).toEqual(["scene.list"]);

      // 第二轮：历史映射（user + assistant 正文 + 工具执行记录注记）
      const { runId: runId2 } = await startChat(session.id, "再来一次");
      await awaitRunDone(runId2);
      const third = JSON.parse(hits[2] ?? "{}") as { messages?: Array<{ role: string; content: string }> };
      const thirdMessages = third.messages ?? [];
      expect(thirdMessages[0]?.role).toBe("system");
      const system = thirdMessages[0]?.content ?? "";
      expect(system).toContain("VideoOS 视频创作 Agent");
      // v0.2.1 弱模型脚手架引擎：四大新段与新工具指引
      expect(system).toContain("# 工作方式（脚手架优先）");
      expect(system).toContain("# DSL 速查（引擎事实，违反即翻车）");
      expect(system).toContain("# 修复循环纪律");
      expect(system).toContain("template.list");
      expect(system).toContain("pattern.search");
      expect(system).toContain("skill.read");
      expect(system).toContain("dsl.reference");
      expect(system).toContain("# 当前项目");
      expect(system).toContain("product-promo");
      expect(system).toContain("场景数：3"); // VIR 摘要（best-effort 编译）
      expect(system).toContain("# 可用技能");
      expect(system).toContain("product-demo"); // skills/*/SKILL.md frontmatter 注入
      expect(system).toContain("本轮最多");
      // 历史：user1 + assistant1（含工具执行记录注记）+ user2
      expect(thirdMessages.some((m) => m.role === "user" && m.content === "帮我看看这个项目")).toBe(true);
      const assistantHistory = thirdMessages.find((m) => m.role === "assistant");
      expect(assistantHistory?.content).toContain("场景确认完毕，可以开始制作。");
      expect(assistantHistory?.content).toContain("[工具执行记录] scene.list ok");
      expect(thirdMessages[thirdMessages.length - 1]?.role).toBe("user");
      expect(thirdMessages[thirdMessages.length - 1]?.content).toBe("再来一次");
    } finally {
      await stub.close();
    }
  }, 60_000);

  test("工具消息宽额（v0.2.1）：skill.read 长文（>6000 字符）完整到达 LLM；resultSummary 展示摘要仍紧凑 ≤300", async () => {
    const hits: string[] = [];
    const stub = await openaiStub({
      hits,
      responses: [
        wire({
          content: "我先读一下 data-dashboard 技能全文",
          toolCalls: [{ id: "call_read", name: "skill.read", args: { name: "data-dashboard" } }],
          usage: { prompt_tokens: 30, completion_tokens: 10 },
        }),
        wire({ content: "读完了，开始照配方做。", usage: { prompt_tokens: 50, completion_tokens: 20 } }),
      ],
    });
    try {
      await resetProviders();
      await addProvider({ id: "stub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${stub.port}/v1`, model: "gpt-test" });
      const session = await createSession({ title: "宽额会话" });
      const { runId } = await startChat(session.id, "帮我做个数据大盘");
      const events = await awaitRunDone(runId);
      const done = events.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
      expect(done?.ok).toBe(true);

      // 第二跳请求体里的 tool 消息：data-dashboard 正文 >6000 字符且 <8000 → 原样到达（未被 512 截断摧毁）
      const second = JSON.parse(hits[1] ?? "{}") as { messages?: Array<{ role: string; content?: string; tool_call_id?: string }> };
      const toolMsg = (second.messages ?? []).find((m) => m.role === "tool" && m.tool_call_id === "call_read");
      expect(toolMsg).toBeDefined();
      const content = toolMsg?.content ?? "";
      expect(content).toContain('{"tool":"skill.read","ok":true');
      expect(content.length).toBeGreaterThan(6_000); // >6000 字符的技能全文完整回填
      expect(content).not.toContain("已截断"); // 单字符串未触及 8000 截断阈
      expect(content).toContain("every number finishes before its scene's final 0.8s."); // 正文尾句在场（未被 512 门槛截断）

      // 展示路径不受影响：resultSummary 紧凑 ≤300（事件与落库同源）
      const toolEvents = events.filter((e): e is Extract<ChatStreamEvent, { type: "agent-tool" }> => e.type === "agent-tool");
      const okEvent = toolEvents.find((e) => e.name === "skill.read" && e.status === "ok");
      expect(okEvent?.resultSummary !== undefined).toBe(true);
      expect((okEvent?.resultSummary ?? "").length).toBeLessThanOrEqual(300);
      expect((okEvent?.resultSummary ?? "").startsWith('{"tool":"skill.read"')).toBe(true);
      const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
      const assistant = record.messages.filter((m) => m.runId === runId)[0] as ChatMessageRecord;
      const summary = ((assistant.toolCalls ?? []) as ChatToolCallRecord[]).find((t) => t.name === "skill.read")?.resultSummary ?? "";
      expect(summary.length).toBeLessThanOrEqual(300);
      expect(summary.endsWith("…")).toBe(true); // 外层 300 截断生效（正文首段都进不来，更别说全文）
      expect(summary).not.toContain("every number finishes"); // 长正文绝不进展示摘要（与 LLM 宽额路径形成对照）
    } finally {
      await stub.close();
    }
  }, 60_000);

  test("maxSteps：请求 50 封顶 30 → MAX_STEPS 收尾；maxSteps=1 单步即停（env manual 长脚本）", async () => {
    await resetProviders();
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    // 35 步脚本（每步一个 cache.stats 工具调用），env 回退路径装配（settings 已清空）
    process.env.VIDEOOS_PROVIDERS = JSON.stringify([
      {
        id: "loopy",
        type: "manual",
        model: "loop",
        script: Array.from({ length: 35 }, (_, i) => ({ toolCalls: [{ id: `c${i}`, name: "cache.stats", arguments: {} }] })),
      },
    ]);
    try {
      const session = await createSession({ title: "循环" });
      const first = await startChat(session.id, "跑满上限", 50);
      const events1 = await awaitRunDone(first.runId, 60_000);
      const done1 = events1.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
      expect(done1?.ok).toBe(false);
      expect(done1?.error).toBe("MAX_STEPS");
      expect(done1?.steps).toBe(30); // 50 → 封顶 30
      const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
      const assistant = record.messages.filter((m) => m.runId === first.runId)[0] as ChatMessageRecord;
      expect(assistant.content).toContain("已达到最大步数 30");
      expect((assistant.toolCalls ?? []).length).toBe(30);
      expect((assistant.toolCalls ?? []).every((t) => t.status === "ok" && t.name === "cache.stats")).toBe(true);

      // maxSteps=1：单步（含工具调用）后即收尾
      const second = await startChat(session.id, "单步", 1);
      await awaitRunDone(second.runId);
      const record2 = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
      const assistant2 = record2.messages.filter((m) => m.runId === second.runId)[0] as ChatMessageRecord;
      expect((assistant2.toolCalls ?? []).length).toBe(1);
      expect(assistant2.content).toContain("已达到最大步数 1");
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
    }
  }, 120_000);

  test("停止：慢桩响应期间 stop → STOPPED + 未执行工具标记 stopped + run/active 恢复探测", async () => {
    const hits: string[] = [];
    const stub = await openaiStub({
      hits,
      delayMs: 500, // 第一跳慢响应：为 stop 留出确定窗口
      responses: [
        wire({
          content: "让我先查一下缓存统计",
          toolCalls: [{ id: "call_stop", name: "cache.stats", args: {} }],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        }),
      ],
    });
    try {
      await resetProviders();
      await addProvider({ id: "slowstub", type: "openai-compatible", baseUrl: `http://127.0.0.1:${stub.port}/v1`, model: "gpt-test" });
      const session = await createSession({ title: "停止会话" });
      const { runId } = await startChat(session.id, "查一下缓存然后继续分析");

      // 桩收到第一跳请求（循环已过步骤间检查、正在等模型响应）→ 此时 stop 必命中「工具调用前」检查
      await waitFor(() => hits.length >= 1, 10_000, "stub first hit");
      const active = await sendJson<{ runId: string; sessionId: string }>("GET", "/api/agent/run/active");
      expect(active).toEqual({ runId, sessionId: session.id });

      const stopped = await sendJson<{ stopped: boolean }>("POST", "/api/agent/stop", { runId });
      expect(stopped).toEqual({ stopped: true });

      const events = await awaitRunDone(runId);
      const done = events.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
      expect(done?.ok).toBe(false);
      expect(done?.error).toBe("STOPPED");
      expect(done?.steps).toBe(1);
      expect(done?.usage).toEqual({ promptTokens: 20, completionTokens: 5 });
      // 中止于首次工具调用前：无 agent-tool 事件，但文本已流出
      expect(events.some((e) => e.type === "agent-tool")).toBe(false);
      expect(events.some((e) => e.type === "agent-text" && e.text === "让我先查一下缓存统计")).toBe(true);

      const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
      const assistant = record.messages.filter((m) => m.runId === runId)[0] as ChatMessageRecord;
      expect(assistant.content).toBe("让我先查一下缓存统计"); // content so far
      expect(assistant.toolCalls).toEqual([{ name: "cache.stats", args: {}, status: "stopped", durationMs: 0 }]);
      expect(assistant.usage).toEqual({ promptTokens: 20, completionTokens: 5 });

      // 运行结束 → active 清空；stop 幂等 404
      expect(await sendJson<unknown>("GET", "/api/agent/run/active")).toBeNull();
      const again = await send("POST", "/api/agent/stop", { runId });
      expect(again.status).toBe(404);
      expect(await errorOf(again)).toContain("RUN_NOT_FOUND");
      const noActive = await send("POST", "/api/agent/stop", {});
      expect(noActive.status).toBe(404);
    } finally {
      await stub.close();
    }
  }, 60_000);

  test("409：PROVIDER_NONE（清空设置 + 无 env）/ SESSION_NO_PROJECT（未绑定项目）/ CHAT_RUN_ACTIVE（并发第二跑）", async () => {
    // PROVIDER_NONE
    await resetProviders();
    const prevEnv = process.env.VIDEOOS_PROVIDERS;
    delete process.env.VIDEOOS_PROVIDERS;
    try {
      const session = await createSession({ title: "无供应商" });
      const res = await send("POST", "/api/agent/chat", { sessionId: session.id, message: "你好" });
      expect(res.status).toBe(409);
      expect(await errorOf(res)).toContain("PROVIDER_NONE");

      // SESSION_NO_PROJECT（显式 null 创建未绑定会话）
      await addDemoProvider();
      const unbound = await createSession({ projectRoot: null });
      expect(unbound.projectRoot).toBeNull();
      const noProject = await send("POST", "/api/agent/chat", { sessionId: unbound.id, message: "做视频" });
      expect(noProject.status).toBe(409);
      expect(await errorOf(noProject)).toContain("SESSION_NO_PROJECT");

      // CHAT_RUN_ACTIVE：慢桩单跳运行期间并发第二跑（重置供应商 → 仅 busy，确保选中的是慢桩而非 demo）
      const busyHits: string[] = [];
      const stub = await openaiStub({ hits: busyHits, delayMs: 400, responses: [wire({ content: "第一次完成" })] });
      try {
        await resetProviders();
        await addProvider({ id: "busy", type: "openai-compatible", baseUrl: `http://127.0.0.1:${stub.port}/v1`, model: "gpt-test" });
        const session2 = await createSession({ title: "并发" });
        const first = await startChat(session2.id, "第一次");
        // 等第一跳请求到达桩（此刻运行必然 in-flight：模型响应被 400ms 延迟挂起）→ 第二跑必命中运行锁
        await waitFor(() => busyHits.length >= 1, 10_000, "busy stub first hit");
        const second = await send("POST", "/api/agent/chat", { sessionId: session2.id, message: "第二次" });
        expect(second.status).toBe(409);
        expect(await errorOf(second)).toContain("CHAT_RUN_ACTIVE");
        await awaitRunDone(first.runId);
        // 运行自然结束后锁释放 → 可再次启动
        const third = await startChat(session2.id, "第三次");
        await awaitRunDone(third.runId);
        const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session2.id}`);
        expect(record.messages.filter((m) => m.role === "assistant")).toHaveLength(2); // 两次运行各一条
      } finally {
        await stub.close();
      }
    } finally {
      if (prevEnv === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prevEnv;
    }
  }, 90_000);

  test("会话绑定不同项目 → 运行时自动切换打开（单 ProjectSession 复用模型）", async () => {
    await resetProviders();
    await addDemoProvider();
    expect(existsSync(join(OTHER_ROOT, "video.project.json"))).toBe(true);
    const session = await createSession({ title: "切换项目", projectRoot: OTHER_ROOT });
    const { runId } = await startChat(session.id, "在这个项目里演示一下");
    const events = await awaitRunDone(runId);
    const done = events.find((e): e is Extract<ChatStreamEvent, { type: "agent-run-done" }> => e.type === "agent-run-done");
    expect(done?.ok).toBe(true);
    const health = await sendJson<{ project: string | null }>("GET", "/api/health");
    expect(health.project).toBe(OTHER_ROOT);
    const record = await sendJson<SessionRecord>("GET", `/api/sessions/${session.id}`);
    const assistant = record.messages.filter((m) => m.runId === runId)[0] as ChatMessageRecord;
    expect((assistant.toolCalls ?? []).map((t) => t.name)).toEqual(["compile.run", "render.preview"]);
  }, 60_000);

  test("错误输入：未知会话 404 / 缺 message 400 / 非法 maxSteps 400 / 非 JSON 400", async () => {
    const missing = await send("POST", "/api/agent/chat", { sessionId: "s_ghost", message: "hi" });
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toContain("SESSION_NOT_FOUND");
    const session = await createSession({ title: "参数" });
    await resetProviders();
    await addDemoProvider();
    const noMessage = await send("POST", "/api/agent/chat", { sessionId: session.id });
    expect(noMessage.status).toBe(400);
    const badSteps = await send("POST", "/api/agent/chat", { sessionId: session.id, message: "hi", maxSteps: 0 });
    expect(badSteps.status).toBe(400);
    const notJson = await fetch(`${base}/api/agent/chat`, { method: "POST", body: "not-json{{" });
    expect(notJson.status).toBe(400);
  });
});
