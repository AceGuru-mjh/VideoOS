// 核心集成测试（全部离线）：临时目录最小项目（DSL 1 场景 + qa 收集器测试文件）
// → createVapContext → compile.run → scene.list → scene.modify → 重编译 → compile.vir
// → render.preview → test.run → transaction.begin/rollback（文件恢复）→ check.overflow → render.final
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createVapContext, createDefaultTools, VapToolRegistry } from "./index";
import { createFixtureProject, defaultEntrySource, resolvePackageEntry } from "./testing";
import type { FixtureProject } from "./testing";
import type { VapContext, VapEvent } from "./session";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let fixture: FixtureProject;
let ctx: VapContext;
let registry: VapToolRegistry;
let receivedEvents: VapEvent[];

beforeAll(async () => {
  fixture = await createFixtureProject();
  receivedEvents = [];
  ctx = await createVapContext({
    workspace: fixture.workspace,
    onEvent: (e) => {
      receivedEvents.push(e);
    },
  });
  registry = new VapToolRegistry();
  for (const tool of createDefaultTools()) registry.register(tool);
});

afterAll(async () => {
  await fixture.dispose();
});

/** 调用工具并要求成功（失败抛错带原因） */
async function callOk<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await registry.call(name, args, ctx);
  if (!r.ok) throw new Error(`${name} unexpectedly failed: ${r.error}`);
  return r.data as T;
}

/** 调用工具并要求失败（成功抛错；返回 error 字符串） */
async function callErr(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const r = await registry.call(name, args, ctx);
  if (r.ok) throw new Error(`${name} unexpectedly succeeded`);
  return r.error as string;
}

describe("VAP 全链路（fixture 项目）", () => {
  it("默认工具 31 个 + 全部注册成功", () => {
    const names = registry.names();
    expect(names.length).toBeGreaterThanOrEqual(30);
    for (const expected of [
      "compile.run", "compile.diagnostics", "compile.vir",
      "scene.list", "scene.inspect", "scene.modify", "layer.inspect", "layer.modify",
      "asset.list", "asset.add", "audio.list", "audio.set",
      "render.preview", "render.range", "render.final", "render.status", "render.cancel",
      "cache.stats", "cache.clear",
      "test.run", "test.results",
      "transaction.begin", "transaction.commit", "transaction.rollback", "transaction.list",
      "inspect.frame", "diff.frames", "check.overflow", "check.missingAssets",
      "storyboard.plan", "storyboard.toScenes",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("compile.run：编译 + .video/vir.json（键字典序 + 2 空格缩进）", async () => {
    interface CompileRunData { scenes: number; duration: number; diagnostics: number; virPath: string }
    const data = await callOk<CompileRunData>("compile.run");
    expect(data.scenes).toBe(1);
    expect(data.duration).toBe(1);
    expect(data.virPath).toBe(join(fixture.root, ".video", "vir.json"));
    const virText = readFileSync(data.virPath, "utf8");
    expect(virText.startsWith('{\n  "assets": [')).toBe(true); // 键排序：assets 第一个
    expect(virText).toContain('\n  "audio": []'); // 2 空格缩进
    const parsed = JSON.parse(virText) as { scenes: Array<{ layers: Array<{ name: string }> }> };
    expect(parsed.scenes[0]!.layers[0]!.name).toBe("greeting");
  });

  it("scene.list / scene.inspect：语义摘要与帧边界", async () => {
    interface SceneListData { scenes: Array<{ name: string; duration: number; layers: string[]; beats: string[] }>; totalFrames: number }
    const list = await callOk<SceneListData>("scene.list");
    expect(list.scenes).toHaveLength(1);
    expect(list.scenes[0]!.name).toBe("intro");
    expect(list.scenes[0]!.layers).toContain("greeting");
    expect(list.scenes[0]!.beats).toContain("title");
    expect(list.totalFrames).toBe(12);

    interface InspectData {
      semantic: { frameStart: number; frameEnd: number; beats: Array<{ name: string }> };
      vir: { layers: Array<{ text: { content: string } }> };
    }
    const inspect = await callOk<InspectData>("scene.inspect", { scene: "intro" });
    expect(inspect.semantic.frameStart).toBe(0);
    expect(inspect.semantic.frameEnd).toBe(12); // 1s @ 12fps（排他边界）
    expect(inspect.semantic.beats[0]!.name).toBe("title");
    expect(inspect.vir.layers[0]!.text.content).toBe("Hello");
  });

  it("scene.modify replace_text：Hello → VideoOS，写回源码并自动重编译（模块缓存破坏）", async () => {
    interface ModifyData { edits: string[] }
    const data = await callOk<ModifyData>("scene.modify", {
      scene: "intro",
      operation: "replace_text",
      layer: "greeting",
      value: "VideoOS",
    });
    expect(data.edits).toHaveLength(1);
    const source = await fixture.readEntry();
    expect(source).toContain('"VideoOS"');
    expect(source).not.toContain('"Hello"');

    // 模块缓存破坏验证：compile.vir 读到新内容（freshImport 重新求值 entry 副本）
    interface VirData { vir: { scenes: Array<{ layers: Array<{ text: { content: string } }> }> } }
    const vir = await callOk<VirData>("compile.vir");
    const layer = vir.vir.scenes[0]!.layers[0]!;
    expect(layer.text.content).toBe("VideoOS");
  });

  it("scene.modify 未知场景 → SCENE_NOT_FOUND；schema 错误被 registry 拦截", async () => {
    await expect(callErr("scene.modify", { scene: "ghost", operation: "set_duration", value: 2 })).resolves.toMatch(/SCENE_NOT_FOUND/);
    await expect(callErr("scene.modify", { scene: "intro", operation: "replace_text", layer: "greeting" })).resolves.toMatch(/^SCHEMA:/);
  });

  it("render.preview：PNG 非空；scene+beat 语义定位；越界 clamp", async () => {
    interface PreviewData { frame: number; totalFrames: number; pngBase64: string; pngPath: string }
    const preview = await callOk<PreviewData>("render.preview", { frame: 6 });
    expect(preview.frame).toBe(6);
    expect(preview.totalFrames).toBe(12);
    const buf = Buffer.from(preview.pngBase64, "base64");
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(existsSync(preview.pngPath)).toBe(true);

    // beat "title" at 0.1s @ 12fps → 帧 1
    const viaBeat = await callOk<PreviewData>("render.preview", { scene: "intro", beat: "title" });
    expect(viaBeat.frame).toBe(1);
    expect(existsSync(viaBeat.pngPath)).toBe(true);

    const clamped = await callOk<PreviewData>("render.preview", { frame: 999 });
    expect(clamped.frame).toBe(11);
  });

  it("render.range：帧范围 PNG 路径数组；from>to 与超限报错", async () => {
    interface RangeData { frames: number; paths: string[] }
    const range = await callOk<RangeData>("render.range", { from: 0, to: 3 });
    expect(range.frames).toBe(4);
    for (const p of range.paths) expect(existsSync(p)).toBe(true);
    await expect(callErr("render.range", { from: 5, to: 2 })).resolves.toMatch(/INVALID_RANGE/);
    await expect(callErr("render.range", { from: 0, to: 10000 })).resolves.toMatch(/RANGE_TOO_LARGE/);
  });

  it("test.run：qa 收集器 4 用例全过（文案已改 → toContainText VideoOS 通过）", async () => {
    interface TestRunData {
      totalPassed: number; totalFailed: number; allPassed: boolean; virHash: string;
      suites: Array<{ results: Array<{ name: string; status: string }> }>;
    }
    const run = await callOk<TestRunData>("test.run");
    expect(run.totalPassed).toBe(4);
    expect(run.totalFailed).toBe(0);
    expect(run.allPassed).toBe(true);
    expect(run.virHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.suites[0]!.results.map((r) => r.status)).toEqual(["pass", "pass", "pass", "pass"]);

    const again = await callOk<TestRunData>("test.results");
    expect(again.totalPassed).toBe(4);
  });

  it("inspect.frame / diff.frames / check.missingAssets / asset.*", async () => {
    interface FrameData { scene: { name: string }; commands: Array<{ op: string }> }
    const frame = await callOk<FrameData>("inspect.frame", { frame: 6 });
    expect(frame.scene.name).toBe("intro");
    expect(frame.commands.some((c) => c.op === "draw-text")).toBe(true);

    interface DiffData { similarity: number }
    const diff = await callOk<DiffData>("diff.frames", { a: 6, b: 7 });
    expect(diff.similarity).toBeGreaterThan(0.99); // 静止段两帧一致

    interface MissingData { missing: unknown[] }
    const missing = await callOk<MissingData>("check.missingAssets");
    expect(missing.missing).toEqual([]); // 字体条目（font:family）跳过

    interface AssetListData { virAssets: unknown[] }
    const assets = await callOk<AssetListData>("asset.list");
    expect(assets.virAssets.length).toBeGreaterThan(0);

    interface AssetAddData { path: string }
    const added = await callOk<AssetAddData>("asset.add", {
      path: "images/dot.png",
      kind: "image",
      contentBase64: Buffer.from("fake-png-bytes").toString("base64"),
    });
    expect(existsSync(added.path)).toBe(true);
    await expect(callErr("asset.add", { path: "images/ghost.png", kind: "image" })).resolves.toMatch(/ASSET_NOT_FOUND/);
    await expect(callErr("asset.add", { path: "../escape.png", kind: "image", contentBase64: "" })).resolves.toMatch(/INVALID_VALUE/);
  });

  it("事务闭环：begin → modify → rollback 后源码与 VIR 恢复", async () => {
    const before = await fixture.readEntry();
    interface BeginData { id: string; status: string }
    const begin = await callOk<BeginData>("transaction.begin", { description: "改文案" });
    expect(begin.status).toBe("active");

    await callOk("scene.modify", { scene: "intro", operation: "replace_text", layer: "greeting", value: "Bonjour VideoOS" });
    expect(await fixture.readEntry()).toContain("Bonjour VideoOS");

    interface RollbackData { id: string; status: string; recompiled: boolean }
    const rollback = await callOk<RollbackData>("transaction.rollback");
    expect(rollback.status).toBe("rolled-back");
    expect(await fixture.readEntry()).toBe(before); // 文件字节级恢复

    // 回滚后自动重编译，VIR 回到 VideoOS
    interface VirData { vir: { scenes: Array<{ layers: Array<{ text: { content: string } }> }> } }
    const vir = await callOk<VirData>("compile.vir");
    expect(vir.vir.scenes[0]!.layers[0]!.text.content).toBe("VideoOS");

    await expect(callErr("transaction.commit")).resolves.toMatch(/NO_ACTIVE_TRANSACTION/); // 已回滚不能再 commit

    interface TxListData { count: number }
    const list = await callOk<TxListData>("transaction.list");
    expect(list.count).toBeGreaterThanOrEqual(1);
  });

  it("事务提交路径：begin → modify → commit 保留修改", async () => {
    await callOk("transaction.begin", { description: "改颜色" });
    await callOk("scene.modify", { scene: "intro", operation: "set_color", layer: "greeting", value: "#ffcc00" });
    const commit = await callOk<{ id: string; status: string }>("transaction.commit");
    expect(commit.status).toBe("committed");
    expect(await fixture.readEntry()).toContain('color: "#ffcc00"');
  });

  it("check.overflow：构造溢出（size 300）检出；回滚后干净", async () => {
    interface OverflowData { violations: Array<{ scene: string; layer: string; measuredWidth: number }> }
    const clean = await callOk<OverflowData>("check.overflow");
    expect(clean.violations).toEqual([]);

    await callOk("transaction.begin", { description: "压测溢出" });
    await callOk("layer.modify", { scene: "intro", layer: "greeting", property: "size", value: 300 });
    const overflow = await callOk<OverflowData>("check.overflow");
    expect(overflow.violations).toHaveLength(1);
    expect(overflow.violations[0]!.layer).toBe("greeting");
    expect(overflow.violations[0]!.measuredWidth).toBeGreaterThan(608);

    await callOk("transaction.rollback");
    const cleanAgain = await callOk<OverflowData>("check.overflow");
    expect(cleanAgain.violations).toEqual([]);
  });

  it("audio.list / audio.set（fixture 无音轨 → CLIP_NOT_FOUND）", async () => {
    const list = await callOk<{ clips: unknown[] }>("audio.list");
    expect(list.clips).toEqual([]);
    await expect(callErr("audio.set", { clip: "bgm", volume: 0.5 })).resolves.toMatch(/CLIP_NOT_FOUND/);
  });

  it("render.final + render.status + cache.stats/clear（无 ffmpeg 环境自动跳过）", async () => {
    interface FinalData { video: string; frames: number; durationSeconds: number }
    const final = await registry.call("render.final", {}, ctx);
    if (!final.ok) {
      if (/ENCODE_FFMPEG_NOT_FOUND/.test(final.error ?? "")) return; // 环境无 ffmpeg：跳过
      throw new Error(final.error);
    }
    const data = final.data as FinalData;
    expect(data.frames).toBe(12);
    expect(data.durationSeconds).toBeCloseTo(1, 5);
    expect(existsSync(data.video)).toBe(true);
    expect(data.video.endsWith(".mp4")).toBe(true);

    const status = await callOk<{ rendered: boolean; video: string }>("render.status");
    expect(status.rendered).toBe(true);
    expect(status.video).toBe(data.video);

    const stats = await callOk<{ entries: number }>("cache.stats");
    expect(stats.entries).toBeGreaterThan(0);
    await callOk("cache.clear");
    const statsAfter = await callOk<{ entries: number }>("cache.stats");
    expect(statsAfter.entries).toBe(0);

    const cancel = await callOk<{ cancelled: boolean; note: string }>("render.cancel");
    expect(cancel).toEqual({ cancelled: false, note: "v1 同步渲染，用进程取消" });
  });

  it("storyboard → 重写 entry → 编译通过（Engineer 工作流）", async () => {
    interface PlanData { shots: unknown[] }
    const plan = await callOk<PlanData>("storyboard.plan", { intent: "VideoOS 发布", durationSeconds: 6, style: "tech" });
    const toScenes = await callOk<{ code: string }>("storyboard.toScenes", { shots: plan.shots });
    expect(toScenes.code).toContain("defineVideo");
    // 夹具项目的 DSL import 需绝对路径；storyboard 代码用包名 → 替换后写入
    const code = toScenes.code.replace('from "@videoos/dsl"', `from ${JSON.stringify(resolvePackageEntry("@videoos/dsl"))}`);
    await fixture.writeEntry(code);
    const compiled = await callOk<{ scenes: number }>("compile.run");
    expect(compiled.scenes).toBe(4);
    const list = await callOk<{ scenes: Array<{ name: string }> }>("scene.list");
    expect(list.scenes.map((s) => s.name)).toEqual(["hook-1", "problem-2", "solution-3", "cta-4"]);
  });

  it("事件审计：tool-call/tool-result/compile/render/test/transaction 全出现", () => {
    const kinds = new Set(receivedEvents.map((e) => e.kind));
    for (const kind of ["tool-call", "tool-result", "compile", "render", "test", "transaction"] as const) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(receivedEvents.filter((e) => e.kind === "tool-call").length).toBeGreaterThan(20);
    expect(receivedEvents.every((e) => typeof e.at === "string" && e.at.includes("T"))).toBe(true);
  });

  it("runTests 重复执行不累积（qa 收集器清空语义）", async () => {
    // 恢复默认项目（storyboard 测试改写了 entry）；文案回到 VideoOS 使 qa 断言通过
    await fixture.writeEntry(defaultEntrySource().replace('"Hello"', '"VideoOS"'));
    interface TestRunData { totalPassed: number; suites: unknown[] }
    const run1 = await callOk<TestRunData>("test.run");
    expect(run1.totalPassed).toBe(4);
    const run2 = await callOk<TestRunData>("test.run");
    expect(run2.totalPassed).toBe(4); // 仍为 4 而非 8
    expect(run2.suites).toHaveLength(1);
  });
});

describe("createVapContext 参数校验", () => {
  it("workspace 必填", () => {
    expect(createVapContext({ workspace: undefined as unknown as never })).rejects.toThrow(/SESSION_INVALID_WORKSPACE/);
  });

  it("entry 不存在 → SESSION_ENTRY_NOT_FOUND", async () => {
    const fixture2 = await createFixtureProject();
    try {
      const ctx2 = await createVapContext({
        workspace: fixture2.workspace,
        entryPath: join(fixture2.root, "src", "missing.ts"),
      });
      let message = "";
      try {
        await ctx2.compile();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/SESSION_ENTRY_NOT_FOUND/);
    } finally {
      await fixture2.dispose();
    }
  });

  it("entry 无默认导出 → SESSION_ENTRY_INVALID", async () => {
    const fixture2 = await createFixtureProject({
      entrySource: "export const notAVideo = 1;\n",
      testSource: null,
    });
    try {
      const ctx2 = await createVapContext({ workspace: fixture2.workspace });
      let message = "";
      try {
        await ctx2.compile();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/SESSION_ENTRY_INVALID/);
    } finally {
      await fixture2.dispose();
    }
  });
});
