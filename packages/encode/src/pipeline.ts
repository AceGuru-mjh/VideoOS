// 高层渲染管线：CompileResult → 逐帧（缓存优先）→ PNG 序列 → ffmpeg 编码
// VAP render.*（preview/range/final）与 CLI `videoos render` 的共同基础
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { secondsToFrames } from "@videoos/core";
import { BACKEND_VERSION, ContentStore, FrameCache, frameKey, virHash } from "@videoos/cache";
import { createRenderer } from "@videoos/render-canvas";
import type { Renderer } from "@videoos/render-canvas";
import type { CompileResult } from "@videoos/compiler";
import { detectFfmpeg, FfmpegEncoder } from "./ffmpeg";
import { EncodeError } from "./types";
import type { RenderFramePngInput, RenderPipelineInput, RenderPipelineResult, VideoCodec } from "./types";

function frameFileName(index: number): string {
  return `frame_${String(index).padStart(6, "0")}.png`;
}

/** 输出文件名：全量渲染 render-<virHash12>；范围/场景渲染附加 -f<from>-t<to>（同内容幂等覆盖） */
function outputFileName(vhash: string, from: number, to: number, full: boolean, codec: VideoCodec): string {
  const ext = codec === "vp9" ? "webm" : "mp4";
  return full ? `render-${vhash.slice(0, 12)}.${ext}` : `render-${vhash.slice(0, 12)}-f${from}-t${to}.${ext}`;
}

/** 默认缓存根：outputDir 同级的 cache（.video/renders → .video/cache） */
function defaultCacheRoot(outputDir: string): string {
  return resolve(outputDir, "..", "cache");
}

function requireCompileResult(compileResult: CompileResult): CompileResult {
  if (compileResult === undefined || compileResult === null || typeof compileResult !== "object" || compileResult.vir === undefined) {
    throw new EncodeError("ENCODE_INVALID_INPUT", "compileResult must be a CompileResult from @videoos/compiler compile()");
  }
  return compileResult;
}

/** 解析渲染帧区间 [from, to]（闭区间，已 clamp）；返回 null 表示空区间 */
function resolveFrameRange(input: RenderPipelineInput, totalFrames: number): { from: number; to: number } | null {
  if (input.frames !== undefined && input.scene !== undefined) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", "frames and scene are mutually exclusive; specify one");
  }
  let from = 0;
  let to = totalFrames - 1;
  if (input.scene !== undefined) {
    if (typeof input.scene !== "string" || input.scene.length === 0) {
      throw new EncodeError("ENCODE_INVALID_OPTIONS", "scene must be a non-empty string when provided");
    }
    const semantic = input.compileResult.semantic;
    const info = semantic.scenes.find((s) => s.id === input.scene || s.name === input.scene);
    if (info === undefined) {
      const available = semantic.scenes.map((s) => s.name).join(", ");
      throw new EncodeError("ENCODE_SCENE_NOT_FOUND", `Scene "${input.scene}" not found (available: ${available})`);
    }
    // frameEnd 为排他边界（语义索引契约）→ 转闭区间
    from = info.frameStart;
    to = info.frameEnd - 1;
  } else if (input.frames !== undefined) {
    const f = input.frames.from ?? 0;
    const t = input.frames.to ?? totalFrames - 1;
    if (typeof f !== "number" || !Number.isFinite(f) || typeof t !== "number" || !Number.isFinite(t)) {
      throw new EncodeError("ENCODE_INVALID_OPTIONS", "frames.from/to must be finite numbers");
    }
    from = Math.floor(f);
    to = Math.floor(t);
  }
  from = Math.max(0, Math.min(from, totalFrames - 1));
  to = Math.max(0, Math.min(to, totalFrames - 1));
  if (from > to) return null;
  return { from, to };
}

/**
 * 全量/范围/单场景渲染 → 视频文件。
 * 流程：createRenderer（惰性，首个缓存 miss 才创建）→ 逐帧 renderFrame→toPng（缓存优先，
 * miss 才渲染并写缓存）→ 临时 framesDir → FfmpegEncoder.encodePngSequence → 返回。
 * 同一 VIR 二次渲染全命中缓存（渲染阶段被跳过，直接从缓存读 PNG 写盘）。
 */
export async function renderToVideo(input: RenderPipelineInput): Promise<RenderPipelineResult> {
  const compileResult = requireCompileResult(input.compileResult);
  const vir = compileResult.vir;
  const backend = input.backend ?? "canvas";
  if (backend !== "canvas") {
    throw new EncodeError("ENCODE_BACKEND_UNSUPPORTED", `backend "${backend}" is not supported in v1 (only "canvas")`);
  }
  if (typeof input.outputDir !== "string" || input.outputDir.length === 0) {
    throw new EncodeError("ENCODE_INVALID_INPUT", "outputDir must be a non-empty string");
  }

  const totalFrames = Math.max(0, secondsToFrames(vir.meta.duration, vir.meta.fps));
  const range = resolveFrameRange(input, totalFrames);
  if (range === null) {
    throw new EncodeError("ENCODE_INVALID_FRAME_RANGE", `Empty frame range (totalFrames=${totalFrames}); check frames/scene bounds`);
  }
  const { from, to } = range;
  const count = to - from + 1;

  // 编码器先就位（渲染前快速失败：无 ffmpeg 时不必浪费整段渲染）
  const codec: VideoCodec = input.encoder?.codec ?? "h264";
  const bin = input.encoder?.bin ?? detectFfmpeg();
  if (bin === null) {
    throw new EncodeError(
      "ENCODE_FFMPEG_NOT_FOUND",
      "ffmpeg not found on this system; install ffmpeg or set FFMPEG_PATH, then run `videoos doctor` to diagnose the environment",
    );
  }
  const encoder = new FfmpegEncoder(bin);
  encoder.ensureAvailable();

  const vhash = virHash(vir);
  const cacheRoot = input.cacheRoot ?? defaultCacheRoot(input.outputDir);
  const store = new ContentStore(cacheRoot);
  const frameCache = new FrameCache(store);

  input.onProgress?.({
    phase: "compile", frame: from, totalFrames: count, cacheHits: 0, cacheMisses: 0,
    message: `VIR ready (${vir.scenes.length} scenes, virHash ${vhash.slice(0, 8)})`,
  });

  const framesDir = await mkdtemp(join(tmpdir(), "videoos-frames-"));
  try {
    await mkdir(input.outputDir, { recursive: true });
    // 惰性创建渲染器：全命中时零渲染成本（createRenderer 含字体/图像预热 ~100ms+）
    let renderer: Renderer | null = null;
    let index = 0;
    for (let frame = from; frame <= to; frame++, index++) {
      const key = frameKey({
        virHash: vhash,
        backendId: backend,
        backendVersion: BACKEND_VERSION,
        frame,
        width: vir.meta.width,
        height: vir.meta.height,
      });
      const cached = await frameCache.getFrame(key);
      let png: Buffer;
      let hit: boolean;
      if (cached !== null) {
        png = cached;
        hit = true;
      } else {
        if (renderer === null) {
          renderer = createRenderer(compileResult, { fonts: input.fonts, assetRoot: input.assetRoot });
        }
        png = renderer.renderFrame(frame).toPng();
        await frameCache.putFrame(key, png);
        hit = false;
      }
      await writeFile(join(framesDir, frameFileName(index)), png);
      input.onProgress?.({
        phase: "render", frame, totalFrames: count,
        cacheHits: frameCache.hits, cacheMisses: frameCache.misses,
        message: hit ? "cache hit" : "rendered",
      });
    }

    const output = join(input.outputDir, outputFileName(vhash, from, to, from === 0 && to === totalFrames - 1, codec));
    const encodeResult = await encoder.encodePngSequence(framesDir, output, {
      fps: vir.meta.fps,
      width: vir.meta.width,
      height: vir.meta.height,
      codec,
      crf: input.encoder?.crf,
      preset: input.encoder?.preset,
      audio: input.audio,
      onProgress: (framesEncoded) => input.onProgress?.({
        phase: "encode", frame: framesEncoded, totalFrames: count,
        cacheHits: frameCache.hits, cacheMisses: frameCache.misses,
        message: `encoding ${codec}`,
      }),
    });

    return {
      video: encodeResult.output,
      frames: count,
      durationSeconds: count / vir.meta.fps,
      cacheHits: frameCache.hits,
      cacheMisses: frameCache.misses,
      encodeResult,
    };
  } finally {
    await rm(framesDir, { recursive: true, force: true });
  }
}

/**
 * 单帧 PNG（preview / QA 用）：先查帧缓存，命中直接返回（零渲染器创建成本）；
 * miss 才 createRenderer 渲染并回填缓存。
 */
export async function renderFramePng(input: RenderFramePngInput): Promise<Buffer> {
  const compileResult = requireCompileResult(input.compileResult);
  const vir = compileResult.vir;
  const backend = input.backend ?? "canvas";
  if (backend !== "canvas") {
    throw new EncodeError("ENCODE_BACKEND_UNSUPPORTED", `backend "${backend}" is not supported in v1 (only "canvas")`);
  }
  if (typeof input.frame !== "number" || !Number.isFinite(input.frame)) {
    throw new EncodeError("ENCODE_INVALID_FRAME", `frame must be a finite number, got: ${String(input.frame)}`);
  }

  const totalFrames = Math.max(0, secondsToFrames(vir.meta.duration, vir.meta.fps));
  const frame = Math.floor(Math.max(0, Math.min(input.frame, totalFrames - 1))); // 与 renderer.renderFrame 同语义 clamp

  const cacheRoot = input.cacheRoot ?? defaultCacheRoot(input.outputDir);
  const store = new ContentStore(cacheRoot);
  const frameCache = new FrameCache(store);
  const key = frameKey({
    virHash: virHash(vir),
    backendId: backend,
    backendVersion: BACKEND_VERSION,
    frame,
    width: vir.meta.width,
    height: vir.meta.height,
  });

  const cached = await frameCache.getFrame(key);
  if (cached !== null) return cached;

  const renderer = createRenderer(compileResult, { fonts: input.fonts, assetRoot: input.assetRoot });
  const png = renderer.renderFrame(frame).toPng();
  await frameCache.putFrame(key, png);
  return png;
}
