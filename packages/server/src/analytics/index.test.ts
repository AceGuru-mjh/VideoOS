// /api/analytics/* E2E：project（编译产物只读分析）/ health（进程与配置快照）/ usage（事件统计）三端点全链路。
// fixture 项目建于 <repo>/.tmp-analytics-e2e-<pid>/（repo 子树内 → @videoos/dsl 工作区解析可用）；
// 未编译 / 无项目 / 空事件路径用独立 server 实例覆盖；纯事件统计用 createStudioApp + app.request 精确控制环形缓冲。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VIDEOOS_VERSION } from "@videoos/core";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import type { Hono } from "hono";
import { createStudioApp } from "../app";
import { startStudioServer, type StudioServerHandle } from "../index";
import { ServerState } from "../state";
import type { HealthAnalyticsResponse, ProjectAnalyticsResponse, UsageAnalyticsResponse } from "./index";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-analytics-e2e-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");
const DATA_DIR = mkdtempSync(join(tmpdir(), "vos-analytics-"));
const BARE_DATA_DIR = mkdtempSync(join(tmpdir(), "vos-analytics-bare-"));
/** 纯事件统计用临时数据目录（每用例独立 → 计数精确） */
const usageDirs: string[] = [];

let handle: StudioServerHandle;
let base: string;
let bare: StudioServerHandle;
let bareBase: string;

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
  await createProjectTemplate(PROJECT_ROOT, "demo");
  handle = await startStudioServer({ port: 0, dataDir: DATA_DIR, projectRoot: PROJECT_ROOT });
  base = `http://127.0.0.1:${handle.port}`;
  bare = await startStudioServer({ port: 0, dataDir: BARE_DATA_DIR });
  bareBase = `http://127.0.0.1:${bare.port}`;
});

afterAll(async () => {
  await handle.close();
  await bare.close();
  for (const dir of usageDirs) await rm(dir, { recursive: true, force: true });
  await rm(DATA_DIR, { recursive: true, force: true });
  await rm(BARE_DATA_DIR, { recursive: true, force: true });
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

const json = async (path: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(`${base}${path}`, init);
  expect(res.status).toBe(200);
  return res.json();
};

/** 独立 state + app（无真实端口；app.request 直达 Hono 路由）→ 事件计数不受主 server 影响 */
function freshUsageApp(): { app: Hono; state: ServerState } {
  const dir = mkdtempSync(join(tmpdir(), "vos-analytics-usage-"));
  usageDirs.push(dir);
  const state = new ServerState(dir);
  return { app: createStudioApp(state), state };
}

const usageOf = async (app: Hono): Promise<UsageAnalyticsResponse> => {
  const res = await app.request("/api/analytics/usage");
  expect(res.status).toBe(200);
  return (await res.json()) as UsageAnalyticsResponse;
};

// ---------------------------------------------------------------- project（未编译）

describe("GET /api/analytics/project（无编译产物）", () => {
  test("项目已打开但从未编译 → {available: false}（单字段，不触发重编译）", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    expect(data.available).toBe(false);
    expect(Object.keys(data)).toEqual(["available"]);
  });

  test("无项目会话（bare server）→ {available: false}", async () => {
    const res = await fetch(`${bareBase}/api/analytics/project`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as ProjectAnalyticsResponse;
    expect(data.available).toBe(false);
  });
});

// ---------------------------------------------------------------- project（编译后）

describe("GET /api/analytics/project（模板项目编译后）", () => {
  test("available: true + project 清单信息（name/entry）", async () => {
    const compiled = (await json("/api/compile", { method: "POST" })) as { ok: boolean; totalFrames: number };
    expect(compiled.ok).toBe(true);
    expect(compiled.totalFrames).toBe(180);

    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    expect(data.available).toBe(true);
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.project).toEqual({ name: "demo", entry: "src/video.ts" });
  });

  test("summary：2 场景 / 3 图层 / 6 秒 / 最长场景 intro", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    // 模板：intro 3.5s + outro 3s − crossfade 0.5s = 6s；3 个 text 图层
    expect(data.summary.sceneCount).toBe(2);
    expect(data.summary.layerCount).toBe(3);
    expect(data.summary.durationSeconds).toBeCloseTo(6, 5);
    expect(data.summary.avgSceneDuration).toBeCloseTo(3.25, 5);
    expect(data.summary.longestScene).toEqual({ name: "intro", duration: 3.5 });
  });

  test("layerTypes：七类固定输出，text=3 / camera=1 / transition=1，计数非负", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.layerTypes.map((l) => l.type)).toEqual([
      "text", "rect", "ellipse", "image", "audio", "camera", "transition",
    ]);
    const byType = new Map(data.layerTypes.map((l) => [l.type, l.count] as const));
    expect(byType.get("text")).toBe(3);
    expect(byType.get("camera")).toBe(1);
    expect(byType.get("transition")).toBe(1);
    expect(byType.get("rect")).toBe(0);
    expect(byType.get("ellipse")).toBe(0);
    expect(byType.get("image")).toBe(0);
    expect(byType.get("audio")).toBe(0);
    expect(data.layerTypes.every((l) => Number.isInteger(l.count) && l.count >= 0)).toBe(true);
  });

  test("topColors：#rrggbb 归一 + 背景计入调色板（#0a0a12×2 / #ffffff×2 / #8b8ba7×1）", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.topColors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
    const counts = new Map(data.topColors.map((c) => [c.hex, c.count] as const));
    expect(counts.get("#0a0a12")).toBe(2); // meta.background + intro 场景背景
    expect(counts.get("#ffffff")).toBe(2); // title + repo 两个 text 图层
    expect(counts.get("#8b8ba7")).toBe(1); // subtitle
    expect(data.topColors.every((c) => c.count > 0)).toBe(true);
  });

  test("fontsUsed：模板全部默认字体 sans-serif ×3", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.fontsUsed).toEqual([{ font: "sans-serif", count: 3 }]);
  });

  test("complexity：score 0-100 整数 = 因子权重均值 ×25；四因子中文标签、权重 [0,1]", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.complexity.factors.map((f) => f.label)).toEqual([
      "场景数量", "图层密度", "转场密度", "动画密度",
    ]);
    expect(data.complexity.factors.every((f) => f.weight >= 0 && f.weight <= 1)).toBe(true);
    expect(Number.isInteger(data.complexity.score)).toBe(true);
    expect(data.complexity.score).toBeGreaterThanOrEqual(0);
    expect(data.complexity.score).toBeLessThanOrEqual(100);
    const expected = Math.round(25 * data.complexity.factors.reduce((sum, f) => sum + f.weight, 0));
    expect(data.complexity.score).toBe(Math.max(0, Math.min(100, expected)));
  });

  test("transitions：模板 1 个 crossfade", async () => {
    const data = (await json("/api/analytics/project")) as ProjectAnalyticsResponse;
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.transitions).toEqual({ count: 1, types: [{ type: "crossfade", count: 1 }] });
  });

  test("只读性：连续两次响应逐字节一致，且不产生新事件", async () => {
    const first = await fetch(`${base}/api/analytics/project`).then((r) => r.text());
    const second = await fetch(`${base}/api/analytics/project`).then((r) => r.text());
    expect(second).toBe(first);
    const usage = (await json("/api/analytics/usage")) as UsageAnalyticsResponse;
    // open(server) + vap:compile + compile 三条，无新增 → 证明 project 端点零副作用
    expect(usage.total).toBe(3);
  });
});

// ---------------------------------------------------------------- health

describe("GET /api/analytics/health", () => {
  test("基础字段：status ok / 版本一致 / uptime 非负 / 内存与运行时数值合法", async () => {
    const data = (await json("/api/analytics/health")) as HealthAnalyticsResponse;
    expect(data.status).toBe("ok");
    expect(data.version).toBe(VIDEOOS_VERSION);
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(data.memoryMB.rss).toBeGreaterThan(0);
    expect(data.memoryMB.heapUsed).toBeGreaterThan(0);
    // heapTotal 与 heapUsed 为运行时近似值（Bun/JSC 下允许瞬时倒挂），只断言非负有限
    expect(data.memoryMB.heapTotal).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(data.memoryMB.rss)).toBe(true);
    expect(data.runtime.version.startsWith("v")).toBe(true);
    expect(data.runtime.bun === null || typeof data.runtime.bun === "string").toBe(true);
  });

  test("计数字段：全新数据目录 → WS 0 / 会话 0 / Provider 0 / MCP 0", async () => {
    const data = (await json("/api/analytics/health")) as HealthAnalyticsResponse;
    expect(data.wsConnections).toBe(0);
    expect(data.sessions).toEqual({ count: 0 });
    expect(data.providers).toEqual({ count: 0, configured: 0 });
    expect(data.mcp).toEqual({ servers: 0, enabled: 0 });
  });

  test("skills 快照：来自 skillsSnapshot（total ≥ 5 且默认全部启用）", async () => {
    const data = (await json("/api/analytics/health")) as HealthAnalyticsResponse;
    expect(data.skills).not.toBeNull();
    if (data.skills === null) throw new Error("expected skills snapshot");
    expect(data.skills.total).toBeGreaterThanOrEqual(5);
    expect(data.skills.enabled).toBe(data.skills.total);
  });

  test("render 摘要：空闲态全空；setRender 后即时反映", async () => {
    const idle = (await json("/api/analytics/health")) as HealthAnalyticsResponse;
    expect(idle.render).toEqual({ running: false, startedAt: null, scene: null, progress: null, error: null });

    handle.state.setRender({
      running: true,
      startedAt: "2024-05-01T08:00:00.000Z",
      scene: "intro",
      progress: { phase: "render", frame: 5, totalFrames: 180 },
      error: null,
    });
    const busy = (await json("/api/analytics/health")) as HealthAnalyticsResponse;
    expect(busy.render.running).toBe(true);
    expect(busy.render.scene).toBe("intro");
    expect(busy.render.progress).toEqual({ phase: "render", frame: 5, totalFrames: 180 });
    // 还原，避免影响后续断言
    handle.state.setRender({ running: false, startedAt: null, scene: null, progress: null, error: null });
  });
});

// ---------------------------------------------------------------- usage

describe("GET /api/analytics/usage", () => {
  test("空事件（bare server）→ 全零/空数组", async () => {
    const res = await fetch(`${bareBase}/api/analytics/usage`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as UsageAnalyticsResponse;
    expect(data).toEqual({ total: 0, byType: [], recent: [], compileCount: 0, renderEvents: 0, testRuns: 0 });
  });

  test("编译后：open/compile/vap:compile 三类齐备，compileCount=2，recent 按时间序", async () => {
    const data = (await json("/api/analytics/usage")) as UsageAnalyticsResponse;
    expect(data.total).toBe(3);
    const types = new Map(data.byType.map((t) => [t.type, t.count] as const));
    expect(types.get("server")).toBe(1);
    expect(types.get("compile")).toBe(1);
    expect(types.get("vap:compile")).toBe(1);
    expect(data.compileCount).toBe(2);
    expect(data.renderEvents).toBe(0);
    expect(data.testRuns).toBe(0);
    // 时间顺序：server(open) → vap:compile → compile
    expect(data.recent.map((r) => r.type)).toEqual(["server", "vap:compile", "compile"]);
    expect(data.recent[0]?.summary).toContain("project opened");
    expect(data.recent[1]?.summary).toContain("编译完成");
    expect(data.recent[2]?.summary).toContain("编译成功");
    // at：vap 事件携带 ISO 时间戳；server 合成事件无时间戳 → null
    expect(data.recent[0]?.at).toBeNull();
    expect(typeof data.recent[1]?.at === "string" && Date.parse(data.recent[1]!.at as string)).not.toBeNaN();
  });

  test("recent 截断至最近 20 条（旧事件滑出窗口）", async () => {
    const { app, state } = freshUsageApp();
    for (let i = 0; i < 25; i++) state.hub.emit({ type: "server", message: `msg-${i}` });
    const data = await usageOf(app);
    expect(data.total).toBe(25);
    expect(data.recent.length).toBe(20);
    expect(data.recent[0]?.summary).toContain("msg-5");
    expect(data.recent[19]?.summary).toContain("msg-24");
    expect(data.byType).toEqual([{ type: "server", count: 25 }]);
  });

  test("vap 事件：分类键 vap:<kind> + at 透传 + 摘要含工具名", async () => {
    const { app, state } = freshUsageApp();
    state.hub.emit({ type: "vap", event: { at: "2024-05-01T08:30:00.000Z", kind: "tool-call", tool: "compile.run" } });
    const data = await usageOf(app);
    expect(data.total).toBe(1);
    expect(data.byType).toEqual([{ type: "vap:tool-call", count: 1 }]);
    expect(data.recent[0]?.type).toBe("vap:tool-call");
    expect(data.recent[0]?.at).toBe("2024-05-01T08:30:00.000Z");
    expect(data.recent[0]?.summary).toContain("compile.run");
  });

  test("renderEvents / testRuns 分类计数（render 三类 + vap:render / test-done + vap:test）", async () => {
    const { app, state } = freshUsageApp();
    state.hub.emit({ type: "render-progress", phase: "render", frame: 10, totalFrames: 180 });
    state.hub.emit({ type: "render-progress", phase: "encode", frame: 20, totalFrames: 180 });
    state.hub.emit({ type: "render-done", video: "out.mp4", frames: 180, cacheHits: 170, cacheMisses: 10 });
    state.hub.emit({ type: "render-error", error: "ffmpeg missing" });
    state.hub.emit({ type: "vap", event: { at: "2024-05-01T08:31:00.000Z", kind: "render", detail: { video: "out.mp4" } } });
    state.hub.emit({ type: "test-done", totalPassed: 3, totalFailed: 0 });
    state.hub.emit({ type: "vap", event: { at: "2024-05-01T08:32:00.000Z", kind: "test", detail: { totalPassed: 3, totalFailed: 0 } } });
    const data = await usageOf(app);
    expect(data.total).toBe(7);
    expect(data.renderEvents).toBe(5);
    expect(data.testRuns).toBe(2);
    expect(data.compileCount).toBe(0);
    expect(data.recent.length).toBe(7);
    expect(data.recent[4]?.summary).toContain("渲染完成");
    expect(data.recent[6]?.summary).toContain("测试完成");
  });

  test("byType 排序确定性：count 降序，同计数按 type 升序；计数均为正整数", async () => {
    const { app, state } = freshUsageApp();
    for (let i = 0; i < 3; i++) state.hub.emit({ type: "compile", ok: true, totalFrames: 180, durationSeconds: 6 });
    for (let i = 0; i < 2; i++) state.hub.emit({ type: "server", message: "hi" });
    for (let i = 0; i < 2; i++) state.hub.emit({ type: "agent-text", sessionId: "s_1", runId: "r_1", text: "思考中" });
    const data = await usageOf(app);
    expect(data.byType.map((t) => t.type)).toEqual(["compile", "agent-text", "server"]);
    expect(data.byType.every((t) => Number.isInteger(t.count) && t.count > 0)).toBe(true);
    expect(data.compileCount).toBe(3);
  });

  test("agent 系事件摘要全分支（run-start/text/tool/run-done/confirm/resolved + agent-done）", async () => {
    const { app, state } = freshUsageApp();
    state.hub.emit({ type: "agent-run-start", sessionId: "s_1", runId: "r_1" });
    state.hub.emit({ type: "agent-text", sessionId: "s_1", runId: "r_1", text: "我先看一下项目结构。" });
    state.hub.emit({
      type: "agent-tool", sessionId: "s_1", runId: "r_1", name: "scene.list", args: {},
      status: "ok", durationMs: 12, resultSummary: "2 scenes",
    });
    state.hub.emit({ type: "agent-run-done", sessionId: "s_1", runId: "r_1", ok: true, steps: 3 });
    state.hub.emit({ type: "agent-confirm", sessionId: "s_1", runId: "r_1", confirmId: "c_1", tool: { name: "render.start", args: {} } });
    state.hub.emit({ type: "agent-resolved", confirmId: "c_1", decision: "allow" });
    state.hub.emit({ type: "agent-done", ok: true, toolCallCount: 1, summary: "done" });
    const data = await usageOf(app);
    expect(data.total).toBe(7);
    // byType 排序：count 全并列 → 按类型码点升序（不依赖 locale）
    expect(data.byType.map((t) => t.type)).toEqual([
      "agent-confirm", "agent-done", "agent-resolved", "agent-run-done", "agent-run-start", "agent-text", "agent-tool",
    ]);
    // recent 保持时间顺序（发射顺序）
    expect(data.recent.map((r) => r.type)).toEqual([
      "agent-run-start", "agent-text", "agent-tool", "agent-run-done", "agent-confirm", "agent-resolved", "agent-done",
    ]);
    expect(data.recent.every((r) => r.at === null)).toBe(true); // 合成事件无时间戳
    expect(data.recent[0]?.summary).toContain("对话运行开始");
    expect(data.recent[1]?.summary).toContain("模型输出");
    expect(data.recent[2]?.summary).toContain("scene.list");
    expect(data.recent[3]?.summary).toContain("3 步");
    expect(data.recent[4]?.summary).toContain("render.start");
    expect(data.recent[5]?.summary).toContain("allow");
    expect(data.recent[6]?.summary).toContain("1 次工具调用");
  });
});

// ---------------------------------------------------------------- project（多类型富项目）

/** 富项目：全图层类型 + 运镜 + cut 转场 + 音频 + 双字体 + 14 个独立颜色矩形（调色板截断用） */
const RICH_ROOT = join(FIXTURE_ROOT, "rich");

const richColorRects = Array.from({ length: 14 }, (_, i) =>
  `      s.rect("c${String(i + 1).padStart(2, "0")}", { width: 8, height: 8, fill: "#${(0x100000 + i + 1).toString(16)}", at: { x: "${5 + i * 3}%", y: "10%" } });`,
).join("\n");

const RICH_ENTRY = `import { defineVideo } from "@videoos/dsl";

export default defineVideo(
  {
    title: "rich",
    width: 1280,
    height: 720,
    fps: 30,
    background: "#101010",
    seed: 7,
  },
  (v) => {
    v.scene("s1", { duration: 2 }, (s) => {
      s.text("t1", "A", { size: 40, color: "#ff0000", font: "Serif", at: { x: "10%", y: "20%" } });
      s.text("t2", "B", { size: 40, color: "#00ff00", font: "Mono", at: { x: "10%", y: "40%" } });
      s.rect("r1", { width: 100, height: 50, fill: "#0000ff", at: { x: "10%", y: "60%" } });
      s.ellipse("e1", { width: 80, height: 80, fill: "#ffff00", at: { x: "10%", y: "80%" } });
      s.image("i1", "assets/images/dot.png", { at: { x: "50%", y: "50%" } });
      s.camera("pan", { dx: 10 });
    });

    v.scene("s2", { duration: 2 }, (s) => {
      s.text("t3", "C", { size: 40, color: "#ff00ff" });
      s.rect("r2", { width: 60, height: 60, fill: "#ff0000" });
${richColorRects}
    });

    v.transition("cut", { duration: 0.2, between: ["s1", "s2"] });
    v.audio("bgm", "assets/audio/beat.ogg", { start: 0, volume: 0.5 });
  },
);
`;

describe("GET /api/analytics/project（全类型富项目）", () => {
  beforeAll(async () => {
    // 在 bare server 上打开富项目（其「无项目/空事件」断言已在前面 describe 完成）
    await ProjectWorkspace.init(RICH_ROOT, { name: "rich" });
    await mkdirSync(join(RICH_ROOT, "src"), { recursive: true });
    await writeFile(join(RICH_ROOT, "src", "video.ts"), RICH_ENTRY, "utf8");
    await mkdirSync(join(RICH_ROOT, "assets", "images"), { recursive: true });
    await mkdirSync(join(RICH_ROOT, "assets", "audio"), { recursive: true });
    await writeFile(join(RICH_ROOT, "assets", "images", "dot.png"), "", "utf8");
    await writeFile(join(RICH_ROOT, "assets", "audio", "beat.ogg"), "", "utf8");
    const opened = await fetch(`${bareBase}/api/project/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ root: RICH_ROOT }),
    });
    expect(opened.status).toBe(200);
    const compiled = await fetch(`${bareBase}/api/compile`, { method: "POST" });
    expect(compiled.status).toBe(200);
    const body = (await compiled.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  const richJson = async (): Promise<ProjectAnalyticsResponse> => {
    const res = await fetch(`${bareBase}/api/analytics/project`);
    expect(res.status).toBe(200);
    return (await res.json()) as ProjectAnalyticsResponse;
  };

  test("layerTypes 全七类非零：text=3 / rect=16 / ellipse=1 / image=1 / audio=1 / camera=1 / transition=1", async () => {
    const data = await richJson();
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.project).toEqual({ name: "rich", entry: "src/video.ts" });
    const counts = new Map(data.layerTypes.map((l) => [l.type, l.count] as const));
    expect(counts.get("text")).toBe(3);
    expect(counts.get("rect")).toBe(16); // r1 + r2 + 14 调色板矩形
    expect(counts.get("ellipse")).toBe(1);
    expect(counts.get("image")).toBe(1);
    expect(counts.get("audio")).toBe(1); // 音频剪辑计数（非图层）
    expect(counts.get("camera")).toBe(1);
    expect(counts.get("transition")).toBe(1);
    expect(data.summary.layerCount).toBe(21); // 仅图层（text+rect+ellipse+image）
  });

  test("summary：cut 转场不重叠 → 总时长 4s；并列最长场景取首个（s1）", async () => {
    const data = await richJson();
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.summary.sceneCount).toBe(2);
    expect(data.summary.durationSeconds).toBeCloseTo(4, 5);
    expect(data.summary.avgSceneDuration).toBeCloseTo(2, 5);
    expect(data.summary.longestScene).toEqual({ name: "s1", duration: 2 });
  });

  test("topColors 截断至 12：#ff0000（×2）居首，同计数按 hex 升序、超出丢弃", async () => {
    const data = await richJson();
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.topColors.length).toBe(12);
    expect(data.topColors[0]).toEqual({ hex: "#ff0000", count: 2 }); // t1 + r2 同色聚合
    // 20 个不同颜色中保留 count 降序 + hex 升序前 12：#100009 在界内、#10000a 被截断
    const hexes = data.topColors.map((c) => c.hex);
    expect(hexes).toContain("#0000ff");
    expect(hexes).toContain("#100009");
    expect(hexes).not.toContain("#10000a");
    expect(hexes).not.toContain("#ffff00");
    expect(data.topColors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex) && c.count >= 1)).toBe(true);
  });

  test("fontsUsed 三种字体（count 并列按名称升序）", async () => {
    const data = await richJson();
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.fontsUsed).toEqual([
      { font: "Mono", count: 1 },
      { font: "Serif", count: 1 },
      { font: "sans-serif", count: 1 },
    ]);
  });

  test("transitions 类型为 cut；complexity 分值界内且因子恒四项", async () => {
    const data = await richJson();
    if (data.available !== true) throw new Error("expected available: true");
    expect(data.transitions).toEqual({ count: 1, types: [{ type: "cut", count: 1 }] });
    expect(data.complexity.factors.length).toBe(4);
    expect(data.complexity.score).toBeGreaterThanOrEqual(0);
    expect(data.complexity.score).toBeLessThanOrEqual(100);
  });
});
