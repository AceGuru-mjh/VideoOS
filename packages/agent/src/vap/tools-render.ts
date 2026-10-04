// Render / Cache 工具：render.preview / render.range / render.final / render.status / render.cancel / cache.stats / cache.clear
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

const MAX_RANGE_FRAMES = 1000;

function frameFileName(index: number): string {
  return `frame_${String(index).padStart(6, "0")}.png`;
}

/** frame/scene/beat → 全局帧号（语义索引：scene→frameStart，scene+beat→frameOf） */
function resolveFrameArg(ctx: VapContext, args: { frame?: number; scene?: string; beat?: string }): { frame: number } | { error: string } {
  const session = asVapSession(ctx);
  const semantic = session.lastCompile?.semantic;
  if (semantic === undefined) return { error: "NOT_COMPILED: 请先 compile.run" };
  if (args.frame !== undefined) {
    if (typeof args.frame !== "number" || !Number.isFinite(args.frame)) {
      return { error: `INVALID_VALUE: frame 需要有限数字，got ${String(args.frame)}` };
    }
    return { frame: Math.floor(args.frame) };
  }
  if (args.scene !== undefined) {
    const info = semantic.scenes.find((s) => s.name === args.scene || s.id === args.scene);
    if (info === undefined) {
      return { error: `SCENE_NOT_FOUND: ${JSON.stringify(args.scene)} (available: ${semantic.scenes.map((s) => s.name).join(", ") || "<none>"})` };
    }
    if (args.beat !== undefined) {
      const beat = info.beats.find((b) => b.name === args.beat);
      if (beat === undefined) {
        return { error: `BEAT_NOT_FOUND: ${JSON.stringify(args.beat)} in scene "${info.name}" (available: ${info.beats.map((b) => b.name).join(", ") || "<none>"})` };
      }
      return { frame: semantic.frameOf(info.name, beat.name) };
    }
    return { frame: info.frameStart };
  }
  return { frame: 0 };
}

export function createRenderTools(): VapTool[] {
  const renderPreview: VapTool = {
    name: "render.preview",
    description:
      "渲染单帧 PNG（缓存优先，命中 <5ms）→ 写 .video/diagnostics/preview_<n>.png。" +
      "frame=全局帧号；scene=场景起始帧；scene+beat=节拍帧（语义索引定位）；缺省帧 0。返回 base64 + 路径",
    schema: z.object({
      frame: z.number().optional().describe("全局帧号（0 起）"),
      scene: z.string().optional().describe("场景名或 id"),
      beat: z.string().optional().describe("节拍名（需与 scene 同用）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.ensureCompiled();
      const resolved = resolveFrameArg(ctx, {
        ...(args.frame !== undefined ? { frame: Number(args.frame) } : {}),
        ...(args.scene !== undefined ? { scene: String(args.scene) } : {}),
        ...(args.beat !== undefined ? { beat: String(args.beat) } : {}),
      });
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const total = session.lastCompile?.semantic.totalFrames ?? 0;
      const frame = Math.max(0, Math.min(resolved.frame, Math.max(0, total - 1))); // 与 renderPreviewPng 同语义 clamp
      const png = await session.renderPreviewPng(frame);
      await mkdir(session.diagnosticsDir, { recursive: true });
      const pngPath = join(session.diagnosticsDir, `preview_${frame}.png`);
      await writeFile(pngPath, png);
      return {
        ok: true,
        data: {
          frame,
          totalFrames: total,
          pngPath,
          pngBase64: png.toString("base64"),
          bytes: png.length,
        },
      };
    },
  };

  const renderRange: VapTool = {
    name: "render.range",
    description: `渲染闭区间帧范围 [from, to]（自动 clamp）→ 每帧 PNG 写 .video/diagnostics/frames/，返回路径数组；上限 ${MAX_RANGE_FRAMES} 帧`,
    schema: z.object({
      from: z.number().describe("起始帧（含）"),
      to: z.number().describe("结束帧（含）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const total = compileResult.semantic.totalFrames;
      // 先按原始请求检查范围大小（防止外部传入超大范围导致海量 PNG 写盘），再 clamp
      const rawFrom = Math.floor(Number(args.from));
      const rawTo = Math.floor(Number(args.to));
      if (rawTo - rawFrom + 1 > MAX_RANGE_FRAMES) {
        return { ok: false, error: `RANGE_TOO_LARGE: ${rawTo - rawFrom + 1} 帧 > 上限 ${MAX_RANGE_FRAMES}；请分段渲染` };
      }
      const from = Math.floor(Math.max(0, Math.min(rawFrom, total - 1)));
      const to = Math.floor(Math.max(0, Math.min(rawTo, total - 1)));
      if (from > to) return { ok: false, error: `INVALID_RANGE: from(${from}) > to(${to})（totalFrames=${total}）` };
      const dir = join(session.diagnosticsDir, "frames");
      await mkdir(dir, { recursive: true });
      const paths: string[] = [];
      for (let f = from; f <= to; f++) {
        const png = await session.renderPreviewPng(f);
        const path = join(dir, frameFileName(f));
        await writeFile(path, png);
        paths.push(path);
      }
      return { ok: true, data: { from, to, frames: paths.length, paths } };
    },
  };

  const renderFinal: VapTool = {
    name: "render.final",
    description: "最终渲染 → ffmpeg 编码 MP4（outputDir=.video/renders，帧缓存全命中时接近瞬时）；scene 可只渲染单场景。需本机 ffmpeg",
    schema: z.object({
      scene: z.string().optional().describe("只渲染该场景（缺省全片）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      try {
        const result = await session.renderFinal(
          args.scene !== undefined ? { scene: String(args.scene) } : {},
        );
        return {
          ok: true,
          data: {
            video: result.video,
            frames: result.frames,
            cacheHits: result.cacheHits,
            cacheMisses: result.cacheMisses,
            durationSeconds: result.durationSeconds,
          },
        };
      } catch (err) {
        return { ok: false, error: `RENDER_FAILED: ${(err as Error).message}` };
      }
    },
  };

  const renderStatus: VapTool = {
    name: "render.status",
    description: "最近一次 render.final 摘要（视频路径/帧数/缓存命中/耗时）；未渲染过返回 rendered: false",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      if (session.lastRender === null) {
        return { ok: true, data: { rendered: false, note: "尚未执行 render.final" } };
      }
      const r = session.lastRender;
      return {
        ok: true,
        data: {
          rendered: true,
          video: r.video,
          frames: r.frames,
          cacheHits: r.cacheHits,
          cacheMisses: r.cacheMisses,
          durationSeconds: r.durationSeconds,
        },
      };
    },
  };

  const renderCancel: VapTool = {
    name: "render.cancel",
    description: "取消渲染（v1 为同步渲染，不支持进程内取消）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, _ctx: VapContext): Promise<VapToolResult> {
      return { ok: true, data: { cancelled: false, note: "v1 同步渲染，用进程取消" } };
    },
  };

  const cacheStats: VapTool = {
    name: "cache.stats",
    description: "内容寻址缓存统计（.video/cache：entries/bytes/按命名空间细分）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const stats = await session.cacheStore.stats();
      return { ok: true, data: stats };
    },
  };

  const cacheClear: VapTool = {
    name: "cache.clear",
    description: "清空内容寻址缓存（.video/cache 整目录删除）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.cacheStore.clear();
      return { ok: true, data: { cleared: true, cacheRoot: session.cacheRoot } };
    },
  };

  return [renderPreview, renderRange, renderFinal, renderStatus, renderCancel, cacheStats, cacheClear];
}
