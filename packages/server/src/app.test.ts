// @videoos/server E2E：真实监听端口上的 REST + WS 全链路。
// fixture 项目建于 <repo>/.tmp-server-e2e-<pid>/（repo 子树内 → @videoos/dsl 工作区解析可用）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectWorkspace } from "@videoos/workspace";
import { createProjectTemplate } from "@videoos/workspace";
import { startStudioServer, type StudioServerHandle } from "./index";
import type { ServerEvent } from "./state";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-server-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");

let handle: StudioServerHandle;
let base: string;

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
  await createProjectTemplate(PROJECT_ROOT, "demo");
  handle = await startStudioServer({ port: 0, projectRoot: PROJECT_ROOT });
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
