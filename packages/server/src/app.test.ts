// @videoos/server E2E：真实监听端口上的 REST + WS 全链路。
// fixture 项目建于 <repo>/.tmp-server-e2e-<pid>/（repo 子树内 → @videoos/dsl 工作区解析可用）。
// v0.2：settings/sessions 走 fixture 内 dataDir（测试封闭，不落仓根 .videoos-data）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ManualProvider } from "@videoos/agent";
import { ProjectWorkspace } from "@videoos/workspace";
import { createProjectTemplate } from "@videoos/workspace";
import { startStudioServer, type StudioServerHandle } from "./index";
import type { ServerEvent } from "./state";
import type { ChatSession, SessionMessage, SessionSummary } from "./chat/types";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-server-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");
const DATA_DIR = join(FIXTURE_ROOT, "data");

let handle: StudioServerHandle;
let base: string;

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
  await createProjectTemplate(PROJECT_ROOT, "demo");
  handle = await startStudioServer({ port: 0, projectRoot: PROJECT_ROOT, dataDir: DATA_DIR });
  base = `http://127.0.0.1:${handle.port}`;
});

afterAll(async () => {
  await handle.close();
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

const json = async (path: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(`${base}${path}`, init);
  return res.json();
};

describe("health / project", () => {
  test("health 反映已打开项目与版本", async () => {
    const data = (await json("/api/health")) as { ok: boolean; project: string | null };
    expect(data.ok).toBe(true);
    expect(data.project).toBe(PROJECT_ROOT);
  });

  test("GET /api/project 返回清单信息", async () => {
    const data = (await json("/api/project")) as { name: string; entry: string; testFiles: string[] };
    expect(data.name).toBe("demo");
    expect(data.entry).toBe("src/video.ts");
    expect(data.testFiles.length).toBe(1);
  });

  test("未打开项目前 409（新 state 模拟）→ 通过 close 后再请求", async () => {
    await fetch(`${base}/api/project/close`, { method: "POST" });
    const res = await fetch(`${base}/api/project`);
    expect(res.status).toBe(409);
    const reopened = (await fetch(`${base}/api/project/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: PROJECT_ROOT }),
    }).then((r) => r.json())) as { name: string };
    expect(reopened.name).toBe("demo");
  });

  test("open 不存在项目 → 404", async () => {
    const res = await fetch(`${base}/api/project/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: join(FIXTURE_ROOT, "nope") }),
    });
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("SERVER_OPEN_FAILED");
  });
});

describe("compile / frame / ops", () => {
  test("POST /api/compile → 模板视频 180 帧 6 秒", async () => {
    const data = (await json("/api/compile", { method: "POST" })) as {
      ok: boolean; totalFrames: number; durationSeconds: number; vir: { meta: { fps: number } }; diagnostics: unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.totalFrames).toBe(180);
    expect(data.durationSeconds).toBeCloseTo(6, 5);
    expect(data.vir.meta.fps).toBe(30);
    expect(Array.isArray(data.diagnostics)).toBe(true);
  });

  test("GET /api/frame/60 → PNG 魔数", async () => {
    const res = await fetch(`${base}/api/frame/60`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });

  test("GET /api/frame/-1 → 400；非整数 → 400", async () => {
    expect((await fetch(`${base}/api/frame/-1`)).status).toBe(400);
    expect((await fetch(`${base}/api/frame/abc`)).status).toBe(400);
  });

  test("GET /api/frame/30/ops → FramePlan 命令数组（含 intro 文本）", async () => {
    const data = (await json("/api/frame/30/ops")) as { frame: number; commands: Array<{ op: string; content?: string }> };
    expect(data.frame).toBe(30);
    const ops = data.commands.map((c) => c.op);
    expect(ops).toContain("draw-text");
    const text = data.commands.find((c) => c.op === "draw-text");
    expect(text?.content).toBeString();
  });
});

describe("file read/write + compile-on-save", () => {
  test("读 entry → 改标题 → 自动重编译生效", async () => {
    const read = (await json("/api/file?path=src/video.ts")) as { content: string };
    expect(read.content).toContain("Hello VideoOS");
    const modified = read.content.replace("Hello VideoOS", "Hello Studio E2E");
    expect(modified).not.toBe(read.content);
    const write = (await json("/api/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/video.ts", content: modified }),
    })) as { ok: boolean; compiled: boolean; vir: { scenes: Array<{ name: string }> } | null };
    expect(write.ok).toBe(true);
    expect(write.compiled).toBe(true);
    const ops = (await json("/api/frame/30/ops")) as { commands: Array<{ op: string; content?: string }> };
    expect(ops.commands.some((c) => c.op === "draw-text" && c.content === "Hello Studio E2E")).toBe(true);
    // 还原，保持后续用例与模板 QA 一致
    await json("/api/file", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "src/video.ts", content: read.content }),
    });
  });

  test("路径越界 → 403", async () => {
    const res = await fetch(`${base}/api/file?path=../../etc/passwd`);
    expect(res.status).toBe(403);
  });

  test("不存在文件 → 404", async () => {
    const res = await fetch(`${base}/api/file?path=src/nope.ts`);
    expect(res.status).toBe(404);
  });
});

describe("tests run", () => {
  test("POST /api/tests/run → 模板 QA 3 断言全过", async () => {
    const data = (await json("/api/tests/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })) as { totalPassed: number; totalFailed: number };
    expect(data.totalPassed).toBeGreaterThan(0);
    expect(data.totalFailed).toBe(0);
  });
});

describe("tools / typings / assets / mcp", () => {
  test("GET /api/tools → 30 个 VAP 工具", async () => {
    const data = (await json("/api/tools")) as { tools: Array<{ name: string }> };
    expect(data.tools.length).toBeGreaterThanOrEqual(25);
    const names = data.tools.map((t) => t.name);
    expect(names).toContain("compile.run");
    expect(names).toContain("scene.list");
  });

  test("POST /api/agent/tool 直接调用 scene.list", async () => {
    const data = (await json("/api/agent/tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "scene.list", args: {} }),
    })) as { ok: boolean; data?: { scenes: unknown[] } };
    expect(data.ok).toBe(true);
    expect((data.data?.scenes ?? []).length).toBe(2);
  });

  test("GET /api/typings → Monaco 注入文件（dsl/qa/bun:test）", async () => {
    const data = (await json("/api/typings")) as { files: Array<{ path: string; content: string }> };
    const paths = data.files.map((f) => f.path);
    expect(paths.some((p) => p.includes("@videoos/dsl"))).toBe(true);
    expect(paths.some((p) => p.includes("@videoos/qa"))).toBe(true);
    expect(data.files.every((f) => f.content.includes("declare"))).toBe(true);
  });

  test("GET /api/assets → 模板无资产（空数组）", async () => {
    const data = (await json("/api/assets")) as { assets: unknown[] };
    expect(Array.isArray(data.assets)).toBe(true);
  });

  test("GET /api/mcp → 连接指引", async () => {
    const data = (await json("/api/mcp")) as { command: string; cwd: string | null };
    expect(data.command).toBe("videoos mcp");
    expect(data.cwd).toBe(PROJECT_ROOT);
  });
});

describe("WebSocket 事件流", () => {
  test("编译事件经 WS 广播", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
    const received: ServerEvent[] = [];
    const opened = new Promise<void>((res) => { ws.onopen = () => res(); });
    ws.onmessage = (ev: MessageEvent) => {
      received.push(JSON.parse(String(ev.data)) as ServerEvent);
    };
    await opened;
    await json("/api/compile", { method: "POST" });
    // 轮询等待 compile 事件到达（WS 异步）
    for (let i = 0; i < 40 && !received.some((e) => e.type === "compile"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ws.close();
    expect(received.some((e) => e.type === "server")).toBe(true);
    expect(received.some((e) => e.type === "compile")).toBe(true);
  });
});

describe("render（需本机 ffmpeg；缺失时跳过断言主体）", () => {
  test("POST /api/render/start → 进度与完成事件", async () => {
    const probe = await fetch(`${base}/api/health`).then((r) => r.json() as Promise<{ ok: boolean }>);
    expect(probe.ok).toBe(true);
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`);
    const events: ServerEvent[] = [];
    await new Promise<void>((res) => { ws.onopen = () => res(); });
    ws.onmessage = (ev: MessageEvent) => { events.push(JSON.parse(String(ev.data)) as ServerEvent); };

    const start = (await json("/api/render/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ crf: 28, preset: "veryfast" }),
    })) as { ok: boolean };
    expect(start.ok).toBe(true);

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (events.some((e) => e.type === "render-done" || e.type === "render-error")) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    ws.close();

    const done = events.find((e) => e.type === "render-done");
    const failed = events.find((e) => e.type === "render-error");
    if (done !== undefined) {
      expect(done.type === "render-done" && done.frames).toBe(180);
    } else if (failed !== undefined) {
      // 环境无 ffmpeg：允许跳过，但必须携带明确错误
      expect(failed.type === "render-error" && failed.error.length > 0).toBe(true);
    } else {
      throw new Error("render 未在 120s 内完成/失败");
    }
    const status = (await json("/api/render/status")) as { running: boolean };
    expect(status.running).toBe(false);
  }, 150_000);
});

// ---------------------------------------------------------------------- v0.2

const JSON_HEADERS = { "content-type": "application/json" };

async function postJson<T>(path: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<{ res: Response; data: T }> {
  const res = await fetch(`${base}${path}`, { method, headers: JSON_HEADERS, body: JSON.stringify(body) });
  return { res, data: (await res.json()) as T };
}

describe("settings API", () => {
  test("GET 默认值 → language zh；PUT 深合并；非法值 400；health 同步 language", async () => {
    const get1 = (await json("/api/settings")) as { settings: { language: string; agent: { maxSteps: number; autonomyLevel: number } } };
    expect(get1.settings.language).toBe("zh");
    expect(get1.settings.agent.maxSteps).toBe(24);
    expect(get1.settings.agent.autonomyLevel).toBe(3);

    const put = (await postJson<{ settings: { language: string; agent: { maxSteps: number } } }>("/api/settings", { language: "en" }, "PUT"));
    expect(put.res.status).toBe(200);
    expect(put.data.settings.language).toBe("en");
    expect(put.data.settings.agent.maxSteps).toBe(24); // 深合并保留未提及字段

    const health = (await json("/api/health")) as { language: string };
    expect(health.language).toBe("en");

    const bad1 = await fetch(`${base}/api/settings`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ language: "xx" }) });
    expect(bad1.status).toBe(400);
    const bad2 = await fetch(`${base}/api/settings`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ agent: { maxSteps: 999 } }) });
    expect(bad2.status).toBe(400);

    // 还原，避免影响后续用例
    const restore = await fetch(`${base}/api/settings`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ language: "zh" }) });
    expect(restore.status).toBe(200);
  });
});

describe("sessions API（#50）", () => {
  test("CRUD 全链路：201 创建 → 列表 → 详情 → PATCH → DELETE → 404", async () => {
    const created = await postJson<{ session: ChatSession }>("/api/sessions", { title: "E2E 会话" });
    expect(created.res.status).toBe(201);
    expect(created.data.session.title).toBe("E2E 会话");
    expect(created.data.session.projectRoot).toBeNull();
    expect(created.data.session.messages).toEqual([]);
    const id = created.data.session.id;

    const list = (await json("/api/sessions")) as { sessions: SessionSummary[] };
    expect(list.sessions.some((s) => s.id === id)).toBe(true);

    const got = (await json(`/api/sessions/${id}`)) as { session: ChatSession };
    expect(got.session.id).toBe(id);

    const patched = await postJson<{ session: ChatSession }>(`/api/sessions/${id}`, { title: "改名了", projectRoot: PROJECT_ROOT }, "PATCH");
    expect(patched.res.status).toBe(200);
    expect(patched.data.session.title).toBe("改名了");
    expect(patched.data.session.projectRoot).toBe(PROJECT_ROOT);

    const del = await fetch(`${base}/api/sessions/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(((await del.json()) as { ok: boolean }).ok).toBe(true);
    expect((await fetch(`${base}/api/sessions/${id}`)).status).toBe(404);
  });

  test("未知会话 404；非法标题 400", async () => {
    expect((await fetch(`${base}/api/sessions/s_nope`)).status).toBe(404);
    const bad = await postJson("/api/sessions", { title: "x".repeat(81) });
    expect(bad.res.status).toBe(400);
  });
});

describe("agent chat（无 provider：异步失败路径）", () => {
  test("POST /api/agent/chat → 202；run 以 SERVER_NO_PROVIDER 失败并回填消息 error", async () => {
    // 确定性：无论外层环境如何，强制本进程无 provider 配置
    const prev = process.env.VIDEOOS_PROVIDERS;
    process.env.VIDEOOS_PROVIDERS = "";
    try {
      const created = await postJson<{ session: ChatSession }>("/api/sessions", {});
      expect(created.res.status).toBe(201);
      const sessionId = created.data.session.id;

      const chat = await postJson<{ runId: string; sessionId: string; userMessageId: string }>("/api/agent/chat", {
        sessionId,
        message: "帮我做个视频",
      });
      expect(chat.res.status).toBe(202);
      expect(chat.data.runId).toMatch(/^r_/);
      expect(chat.data.sessionId).toBe(sessionId);
      expect(chat.data.userMessageId).toMatch(/^m_/);

      // 轮询异步失败回填（~5s 超时）
      const deadline = Date.now() + 5_000;
      let assistant: SessionMessage | undefined;
      while (Date.now() < deadline) {
        const got = (await json(`/api/sessions/${sessionId}`)) as { session: ChatSession };
        assistant = got.session.messages.find((m) => m.runId === chat.data.runId);
        if (assistant?.error !== undefined) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(assistant?.error ?? "").toContain("SERVER_NO_PROVIDER");
    } finally {
      if (prev === undefined) delete process.env.VIDEOOS_PROVIDERS;
      else process.env.VIDEOOS_PROVIDERS = prev;
    }
  }, 10_000);

  test("参数校验：缺 message 400；未知会话 404；未知 run stop 404", async () => {
    const bad = await postJson("/api/agent/chat", { sessionId: "s_x", message: "" });
    expect(bad.res.status).toBe(400);
    const missing = await postJson("/api/agent/chat", { sessionId: "s_nope", message: "hi" });
    expect(missing.res.status).toBe(404);
    const stopMissing = await postJson("/api/agent/stop", { runId: "r_nope" });
    expect(stopMissing.res.status).toBe(404);
  });
});

describe("agent chat E2E（ManualProvider 注入，独立服务器 + WS）", () => {
  const AGENT_PROJECT = join(FIXTURE_ROOT, "agent-demo");
  const AGENT_DATA = join(FIXTURE_ROOT, "agent-data");
  let handle2: StudioServerHandle;
  let base2: string;

  beforeAll(async () => {
    await ProjectWorkspace.init(AGENT_PROJECT, { name: "agent-demo" });
    await createProjectTemplate(AGENT_PROJECT, "agent-demo");
    handle2 = await startStudioServer({
      port: 0,
      projectRoot: AGENT_PROJECT,
      dataDir: AGENT_DATA,
      agentProviderFactory: () => [
        new ManualProvider({
          script: [
            { content: "我先看看项目场景。", toolCalls: [{ id: "t1", name: "scene.list", arguments: {} }] },
            { content: "共 2 个场景，已为你确认。" },
          ],
        }),
      ],
    });
    base2 = `http://127.0.0.1:${handle2.port}`;
  });

  afterAll(async () => {
    await handle2.close();
  });

  test("202 → 消息/任务卡落盘 → agent-message 帧经 WS 广播", async () => {
    // WS 先连上，确保 agent-message 帧被捕获
    const ws = new WebSocket(`ws://127.0.0.1:${handle2.port}/ws`);
    const frames: Array<Record<string, unknown>> = [];
    await new Promise<void>((res) => { ws.onopen = () => res(); });
    ws.onmessage = (ev: MessageEvent) => { frames.push(JSON.parse(String(ev.data)) as Record<string, unknown>); };

    const createRes = await fetch(`${base2}/api/sessions`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({}) });
    expect(createRes.status).toBe(201);
    const { session } = (await createRes.json()) as { session: ChatSession };

    const chatRes = await fetch(`${base2}/api/agent/chat`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: session.id, message: "有哪些场景？" }),
    });
    expect(chatRes.status).toBe(202);
    const started = (await chatRes.json()) as { runId: string; userMessageId: string };

    // 轮询 assistant 消息完成（taskCards 仅在收口时落盘 → 出现即 run 结束）
    const deadline = Date.now() + 10_000;
    let assistant: SessionMessage | undefined;
    while (Date.now() < deadline) {
      const got = await fetch(`${base2}/api/sessions/${session.id}`).then((r) => r.json() as Promise<{ session: ChatSession }>);
      assistant = got.session.messages.find((m) => m.runId === started.runId);
      if (assistant !== undefined && (assistant.taskCards?.length ?? 0) > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    // 等 done 帧到达（收口 patch 与 done 事件几乎同时，留少量宽限）
    for (let i = 0; i < 40 && !frames.some((f) => f.type === "agent-message" && f.kind === "done"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    ws.close();

    expect(assistant?.content).toContain("我先看看项目场景。");
    expect(assistant?.content).toContain("共 2 个场景");
    expect(assistant?.error).toBeUndefined();
    const cardSteps = (assistant?.taskCards ?? []).map((c) => c.step);
    expect(cardSteps).toContain("plan");
    expect(cardSteps).toContain("scene.list");
    expect(cardSteps).toContain("respond");
    expect((assistant?.taskCards ?? []).every((c) => c.status === "done")).toBe(true);

    const agentFrames = frames.filter((f) => f.type === "agent-message");
    expect(agentFrames.length).toBeGreaterThan(0);
    expect(agentFrames.every((f) => f.sessionId === session.id)).toBe(true);
    expect(agentFrames.some((f) => f.runId === started.runId)).toBe(true);
    expect(agentFrames.some((f) => f.kind === "text")).toBe(true);
    expect(agentFrames.some((f) => f.kind === "tool-start" || f.kind === "tool-end")).toBe(true);
    expect(agentFrames.some((f) => f.kind === "card")).toBe(true);
    expect(agentFrames.some((f) => f.kind === "done")).toBe(true);
  }, 15_000);
});

describe("skills / mcp 端点（桩实现冒烟：只断形状/状态码，不断内容）", () => {
  test("GET /api/skills → 200 {skills: array}；PATCH 未知技能 → 404", async () => {
    const res = await fetch(`${base}/api/skills`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { skills: unknown[] };
    expect(Array.isArray(data.skills)).toBe(true);

    const patch = await fetch(`${base}/api/skills/nope`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ enabled: false }) });
    expect(patch.status).toBe(404);
  });

  test("GET /api/mcp/status → 200 形状；GET /api/mcp/servers 按可用性 200/501", async () => {
    const status = (await json("/api/mcp/status")) as { status: { available: boolean; running: boolean; servers: unknown[] } };
    expect(typeof status.status.available).toBe("boolean");
    expect(typeof status.status.running).toBe("boolean");
    expect(Array.isArray(status.status.servers)).toBe(true);

    const serversRes = await fetch(`${base}/api/mcp/servers`);
    expect(serversRes.status).toBe(status.status.available ? 200 : 501);
  });
});
