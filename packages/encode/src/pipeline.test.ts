// 渲染管线端到端测试：renderToVideo（首渲/缓存二次命中/场景/范围渲染）+ renderFramePng + 错误路径
// 样例：两场景 1.5s@24fps = 36 帧（main 0.8s + outro 0.7s，cut 过渡）960×540
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import { compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { defineVideo } from "@videoos/dsl";
import { ContentStore } from "@videoos/cache";
import { createRenderer } from "@videoos/render-canvas";
import { detectFfmpeg } from "./ffmpeg";
import { renderFramePng, renderToVideo } from "./pipeline";
import { EncodeError } from "./types";
import type { RenderProgress } from "./types";

const BIN = detectFfmpeg() ?? "/usr/bin/ffmpeg";

/** E2E 样例定义（独立函数以便二次编译验证内容寻址跨实例生效） */
function buildE2EDefinition() {
  return defineVideo(
    { title: "PipelineE2E", width: 960, height: 540, fps: 24, seed: 7, background: "#101020" },
    (v) => {
      v.scene("main", { duration: 0.8, background: "#101020" }, (s) => {
        s.beat("reveal", { at: 0.1, description: "入场" });
        s.rect("bar", { width: 240, height: 72, fill: "#22d3ee", at: { x: "50%", y: "38%" }, enter: { effect: "slide-up", duration: 0.4 } });
        s.text("title", "Hello Cache", { size: 56, weight: 700, at: { x: "50%", y: "60%" }, enter: { effect: "fade", duration: 0.3 } });
        s.camera("push-in", { from: 1, to: 1.05 });
      });
      v.scene("outro", { duration: 0.7 }, (s) => {
        s.image("logo", "assets/images/logo.png", { width: 120, height: 120, at: { x: "70%", y: "50%" }, enter: { effect: "scale-pop", duration: 0.3 } });
        s.text("bye", "bye", { size: 36, at: { x: "30%", y: "50%" }, exit: { effect: "fade", duration: 0.3 } });
      });
      v.transition("cut", { between: ["main", "outro"] });
    },
  );
}

let fixtureRoot: string;
let outputDir: string;
let cacheRoot: string;
let compiled: CompileResult;
let totalFrames: number;
/** 首渲耗时（缓存命中测试的对照基线） */
let firstRenderMs = Number.POSITIVE_INFINITY;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "videoos-encode-pipeline-"));
  // 图像 fixture：256×256 纯品红 PNG（outro 场景 logo 图层）
  const img = createCanvas(256, 256);
  const ictx = img.getContext("2d");
  ictx.fillStyle = "#ff00ff";
  ictx.fillRect(0, 0, 256, 256);
  const logoDir = join(fixtureRoot, "assets", "images");
  mkdirSync(logoDir, { recursive: true });
  writeFileSync(join(logoDir, "logo.png"), img.toBuffer("image/png"));

  outputDir = join(fixtureRoot, ".video", "renders");
  cacheRoot = join(fixtureRoot, ".video", "cache");

  compiled = compile(buildE2EDefinition(), { assetRoot: fixtureRoot });
  totalFrames = compiled.semantic.totalFrames; // 1.5s × 24fps = 36
  expect(totalFrames).toBe(36);
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** ffmpeg -i 解析容器时长（秒）；无输出时 ffmpeg 退出码非 0 属正常，读 stderr */
function probeDuration(file: string): number {
  const res = spawnSync(BIN, ["-i", file], { shell: false, encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr ?? "");
  if (m === null) throw new Error(`No Duration in ffmpeg -i output: ${(res.stderr ?? "").slice(0, 400)}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

describe("renderToVideo 端到端", () => {
  test("首次渲染：36 帧全部 miss → mp4 > 10KB、容器时长 ≥ 0.9s", async () => {
    const progress: RenderProgress[] = [];
    const started = performance.now();
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      onProgress: (p) => progress.push(p),
    });
    firstRenderMs = performance.now() - started;

    // 产物
    expect(result.video.endsWith(".mp4")).toBe(true);
    expect(result.video.startsWith(outputDir)).toBe(true);
    expect(existsSync(result.video)).toBe(true);
    expect(statSync(result.video).size).toBeGreaterThan(10_000);
    expect(result.frames).toBe(totalFrames);
    expect(result.durationSeconds).toBeCloseTo(1.5, 6);
    expect(probeDuration(result.video)).toBeGreaterThanOrEqual(0.9);

    // 缓存语义：首次全 miss
    expect(result.cacheHits).toBe(0);
    expect(result.cacheMisses).toBe(totalFrames);
    expect(result.encodeResult.frames).toBe(totalFrames);

    // 进度事件：compile 起始 → render 逐帧（绝对帧号）→ encode
    expect(progress[0]!.phase).toBe("compile");
    const renderEvents = progress.filter((p) => p.phase === "render");
    expect(renderEvents).toHaveLength(totalFrames);
    expect(renderEvents.map((p) => p.frame)).toEqual(Array.from({ length: totalFrames }, (_, i) => i));
    expect(progress.filter((p) => p.phase === "encode").length).toBeGreaterThan(0);
    expect(progress.every((p) => p.totalFrames === totalFrames)).toBe(true);
    expect(renderEvents[totalFrames - 1]!.cacheMisses).toBe(totalFrames);

    console.log(`[pipeline] first render (36 frames @960x540, incl. ffmpeg): ${firstRenderMs.toFixed(0)}ms`);
  });

  test("二次渲染（重新编译、新管线实例）：全命中缓存且显著更快", async () => {
    // 重新编译证明内容寻址跨实例生效（M1 契约：编译确定性 → 同 virHash → 同 frameKey）
    const recompiled = compile(buildE2EDefinition(), { assetRoot: fixtureRoot });
    const started = performance.now();
    const result = await renderToVideo({
      compileResult: recompiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
    });
    const secondRenderMs = performance.now() - started;

    expect(result.cacheHits).toBe(totalFrames);
    expect(result.cacheMisses).toBe(0);
    expect(result.frames).toBe(totalFrames);
    expect(existsSync(result.video)).toBe(true);
    expect(result.durationSeconds).toBeCloseTo(1.5, 6);

    const store = new ContentStore(cacheRoot);
    const stats = await store.stats();
    expect(stats.entries).toBeGreaterThanOrEqual(totalFrames);
    expect(stats.namespaces["frames"]!.entries).toBeGreaterThanOrEqual(totalFrames);
    expect(stats.namespaces["frames"]!.bytes).toBeGreaterThan(0);

    console.log(`[pipeline] second render (all ${totalFrames} cache hits): ${secondRenderMs.toFixed(0)}ms`);
    // 显著更短：缓存路径无渲染器创建 / renderFrame / toPng（仅缓存读取 + ffmpeg 编码）
    expect(secondRenderMs).toBeLessThan(firstRenderMs);
  });

  test("同一输出幂等：二次渲染产物路径一致（内容寻址命名）", async () => {
    const a = await renderToVideo({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot });
    const b = await renderToVideo({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot });
    expect(a.video).toBe(b.video);
  });
});

describe("renderToVideo 范围/场景渲染", () => {
  test("frames 范围渲染：[2, 8] → 7 帧视频", async () => {
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      frames: { from: 2, to: 8 },
    });
    expect(result.frames).toBe(7);
    expect(result.durationSeconds).toBeCloseTo(7 / 24, 6);
    expect(result.video).toContain("-f2-t8");
    expect(existsSync(result.video)).toBe(true);
  });

  test("frames 越界 clamp：from -5 / to 999 → 全量 36 帧", async () => {
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      frames: { from: -5, to: 999 },
    });
    expect(result.frames).toBe(totalFrames);
  });

  test("scene 渲染（语义索引定位）：outro → [frameStart, frameEnd) 帧数", async () => {
    const outro = compiled.semantic.scenes.find((s) => s.name === "outro")!;
    const expected = outro.frameEnd - outro.frameStart; // 0.7s@24fps → 17 帧
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      scene: "outro",
    });
    expect(result.frames).toBe(expected);
    expect(expected).toBe(17);
    expect(result.cacheHits + result.cacheMisses).toBe(expected);
    expect(existsSync(result.video)).toBe(true);
  });

  test("scene 按 id 亦可定位", async () => {
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      scene: "scene_outro",
    });
    expect(result.frames).toBe(17);
  });

  test("错误路径：frames 与 scene 互斥 / 未知场景 / 非法 backend", async () => {
    const base = { compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot };
    await expect(renderToVideo({ ...base, frames: { from: 0, to: 5 }, scene: "main" })).rejects.toThrow(/ENCODE_INVALID_OPTIONS/);
    await expect(renderToVideo({ ...base, scene: "nope" })).rejects.toThrow(/ENCODE_SCENE_NOT_FOUND/);
    await expect(renderToVideo({ ...base, backend: "svg" as "canvas" })).rejects.toThrow(/ENCODE_BACKEND_UNSUPPORTED/);
  });

  test("错误路径：from > to → ENCODE_INVALID_FRAME_RANGE", async () => {
    await expect(renderToVideo({
      compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot,
      frames: { from: 10, to: 3 },
    })).rejects.toThrow(/ENCODE_INVALID_FRAME_RANGE/);
  });
});

describe("renderFramePng 单帧接口", () => {
  test("管线写入缓存的帧与直接渲染字节级一致（确定性契约）", async () => {
    const png = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot, frame: 11 });
    // 独立渲染器直接渲染同帧 → 必须与缓存内容一致
    const renderer = createRenderer(compiled, { assetRoot: fixtureRoot });
    const direct = renderer.renderFrame(11).toPng();
    expect(Buffer.compare(png, direct)).toBe(0);
    expect(png.readUInt32BE(16)).toBe(960); // IHDR width
    expect(png.readUInt32BE(20)).toBe(540); // IHDR height
  });

  test("全新缓存根：miss 渲染并回填（entries === 1），二次读取命中且不重复写", async () => {
    const freshRoot = join(fixtureRoot, ".video", "cache-fresh");
    const png1 = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot: freshRoot, assetRoot: fixtureRoot, frame: 3 });
    const store = new ContentStore(freshRoot);
    let stats = await store.stats();
    expect(stats.namespaces["frames"]!.entries).toBe(1);
    const png2 = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot: freshRoot, assetRoot: fixtureRoot, frame: 3 });
    expect(Buffer.compare(png1, png2)).toBe(0);
    stats = await store.stats();
    expect(stats.namespaces["frames"]!.entries).toBe(1);
  });

  test("非法帧号抛错；越界帧 clamp（与 renderer.renderFrame 语义一致）", async () => {
    await expect(renderFramePng({
      compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot, frame: Number.NaN,
    })).rejects.toThrow(/ENCODE_INVALID_FRAME/);
    const clamped = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot, frame: 99999 });
    const last = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot, frame: totalFrames - 1 });
    expect(Buffer.compare(clamped, last)).toBe(0);
  });
});

describe("管线 × 编码器配置透传", () => {
  test("codec vp9 → webm 输出", async () => {
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      frames: { from: 0, to: 5 },
      encoder: { codec: "vp9" },
    });
    expect(result.video.endsWith(".webm")).toBe(true);
    expect(result.encodeResult.command).toContain("libvpx-vp9");
    expect(existsSync(result.video)).toBe(true);
  });

  test("自定义 crf/preset 透传到命令行", async () => {
    const result = await renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      frames: { from: 0, to: 4 },
      encoder: { crf: 23, preset: "fast" },
    });
    expect(result.encodeResult.command).toContain("-crf 23");
    expect(result.encodeResult.command).toContain("-preset fast");
  });
});

describe("无 ffmpeg 环境（FFMPEG_PATH 指向不存在路径 → detectFfmpeg 为 null）", () => {
  test("renderToVideo 在渲染前抛 EncodeError（ENCODE_FFMPEG_NOT_FOUND + videoos doctor 提示）", async () => {
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(fixtureRoot, "no-such-ffmpeg");
    try {
      const store = new ContentStore(cacheRoot);
      const statsBefore = await store.stats();
      let progressed = 0;
      try {
        await renderToVideo({
          compileResult: compiled,
          outputDir,
          cacheRoot,
          assetRoot: fixtureRoot,
          onProgress: () => {
            progressed++;
          },
        });
        throw new Error("should have thrown ENCODE_FFMPEG_NOT_FOUND");
      } catch (err) {
        expect(err).toBeInstanceOf(EncodeError);
        const e = err as EncodeError;
        expect(e.code).toBe("ENCODE_FFMPEG_NOT_FOUND");
        expect(e.message).toContain("videoos doctor");
      }
      // 快速失败契约：渲染阶段被完全跳过（无进度事件、无新缓存写入）
      expect(progressed).toBe(0);
      const statsAfter = await store.stats();
      expect(statsAfter.entries).toBe(statsBefore.entries);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });

  test("显式传入不存在的 encoder.bin 同样在渲染前失败", async () => {
    await expect(renderToVideo({
      compileResult: compiled,
      outputDir,
      cacheRoot,
      assetRoot: fixtureRoot,
      encoder: { bin: "/definitely/not/ffmpeg" },
    })).rejects.toThrow(/ENCODE_FFMPEG_NOT_FOUND/);
  });

  test("renderFramePng 不依赖 ffmpeg，正常返回 PNG", async () => {
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(fixtureRoot, "no-such-ffmpeg");
    try {
      const png = await renderFramePng({ compileResult: compiled, outputDir, cacheRoot, assetRoot: fixtureRoot, frame: 20 });
      expect(png.readUInt32BE(16)).toBe(960);
      expect(png.readUInt32BE(20)).toBe(540);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });
});
