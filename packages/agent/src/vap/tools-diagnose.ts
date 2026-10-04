// Diagnose 工具：inspect.frame / diff.frames / check.overflow / check.missingAssets
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { loadImageDataSync, compareImages } from "@videoos/qa";
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

export function createDiagnoseTools(): VapTool[] {
  const inspectFrame: VapTool = {
    name: "inspect.frame",
    description: "单帧执行计划（FramePlan）：场景/背景/相机/全部绘制命令（layerId + 已解析几何与样式）+ 所属场景",
    schema: z.object({ frame: z.number().describe("全局帧号（自动 clamp 到 [0, totalFrames-1]）") }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const total = compileResult.semantic.totalFrames;
      const frame = Math.floor(Math.max(0, Math.min(Number(args.frame), total - 1)));
      const plan = compileResult.framePlan(frame);
      const scene = compileResult.vir.scenes.find((s) => s.id === plan.sceneId) ?? null;
      return {
        ok: true,
        data: {
          frame: plan.frame,
          time: plan.time,
          scene: scene === null ? null : { name: scene.name, id: scene.id },
          background: plan.background,
          camera: plan.camera,
          ...(plan.transition !== undefined ? { transition: plan.transition } : {}),
          commands: plan.commands,
          totalFrames: total,
        },
      };
    },
  };

  const diffFrames: VapTool = {
    name: "diff.frames",
    description: "渲染两帧 → PNG 落盘 .video/diagnostics/ → 逐像素相似度（@videoos/qa compareImages，容差 ±6/255）",
    schema: z.object({
      a: z.number().describe("帧 A（全局帧号）"),
      b: z.number().describe("帧 B（全局帧号）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.ensureCompiled();
      const a = Math.floor(Number(args.a));
      const b = Math.floor(Number(args.b));
      const pngA = await session.renderPreviewPng(a);
      const pngB = await session.renderPreviewPng(b);
      await mkdir(session.diagnosticsDir, { recursive: true });
      const pathA = join(session.diagnosticsDir, `diff_a_${a}.png`);
      const pathB = join(session.diagnosticsDir, `diff_b_${b}.png`);
      await writeFile(pathA, pngA);
      await writeFile(pathB, pngB);
      const imageA = loadImageDataSync(pathA);
      const imageB = loadImageDataSync(pathB);
      const diff = compareImages(imageA, imageB);
      return {
        ok: true,
        data: { a, b, pngPaths: [pathA, pathB], similarity: diff.similarity, width: diff.width, height: diff.height },
      };
    },
  };

  const checkOverflow: VapTool = {
    name: "check.overflow",
    description: "对全部场景 text 图层用 renderer.measureText 实测宽度（含 letterSpacing）vs maxWidth ?? width-32 → 违规列表",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const renderer = await session.getRenderer();
      const defaultLimit = compileResult.vir.meta.width - 32;
      const violations: Array<Record<string, unknown>> = [];
      let checked = 0;
      for (const scene of compileResult.vir.scenes) {
        for (const layer of scene.layers) {
          if (layer.type !== "text") continue;
          checked++;
          const metrics = renderer.measureText(layer);
          const limit = layer.text.maxWidth ?? defaultLimit;
          if (metrics.width > limit) {
            violations.push({
              scene: scene.name,
              layer: layer.name,
              content: layer.text.content,
              measuredWidth: Math.round(metrics.width * 10) / 10,
              limit,
              overflowBy: Math.round((metrics.width - limit) * 10) / 10,
            });
          }
        }
      }
      return { ok: true, data: { checked, violations, ok: violations.length === 0 } };
    },
  };

  const checkMissingAssets: VapTool = {
    name: "check.missingAssets",
    description: "VIR 资产注册表对照文件系统（assetRoot=项目根；字体条目 src=font:family 跳过）→ 缺失文件列表",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const missing: Array<Record<string, unknown>> = [];
      let checked = 0;
      for (const asset of compileResult.vir.assets) {
        if (asset.type === "font") continue; // src = font:family（非文件路径）
        checked++;
        const path = isAbsolute(asset.src) ? asset.src : join(session.workspace.root, asset.src);
        if (!existsSync(path)) {
          missing.push({ id: asset.id, type: asset.type, src: asset.src, path });
        }
      }
      return { ok: true, data: { checked, missing, ok: missing.length === 0 } };
    },
  };

  return [inspectFrame, diffFrames, checkOverflow, checkMissingAssets];
}
