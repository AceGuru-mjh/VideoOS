// Compile 工具：compile.run / compile.diagnostics / compile.vir
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

export function createCompileTools(): VapTool[] {
  const compileRun: VapTool = {
    name: "compile.run",
    description: "重新加载 entry（src/video.ts）并编译 → VIR/FramePlan/诊断；写 .video/vir.json（键排序 + 2 空格）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const result = await session.compile();
      return {
        ok: true,
        data: {
          diagnostics: result.diagnostics.length,
          errors: result.diagnostics.filter((d) => d.level === "error").length,
          warnings: result.diagnostics.filter((d) => d.level === "warning").length,
          scenes: result.vir.scenes.length,
          duration: result.vir.meta.duration,
          totalFrames: result.semantic.totalFrames,
          virPath: session.virPath,
        },
      };
    },
  };

  const compileDiagnostics: VapTool = {
    name: "compile.diagnostics",
    description: "最近一次编译的诊断列表（error/warning/info）；未编译过则自动编译",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const result = await session.ensureCompiled();
      return {
        ok: true,
        data: {
          diagnostics: result.diagnostics,
          errors: result.diagnostics.filter((d) => d.level === "error").length,
          warnings: result.diagnostics.filter((d) => d.level === "warning").length,
        },
      };
    },
  };

  const compileVir: VapTool = {
    name: "compile.vir",
    description: "完整 VIR JSON + 语义摘要（每场景 name/duration/beats/layers 名列表；Agent 的世界模型数据源）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const result = await session.ensureCompiled();
      const virOnDisk = await readFile(session.virPath, "utf8").catch(() => null);
      return {
        ok: true,
        data: {
          vir: result.vir,
          scenes: result.vir.scenes.map((s) => ({
            name: s.name,
            duration: s.duration,
            start: s.start,
            beats: s.beats.map((b) => b.name),
            layers: s.layers.map((l) => l.name),
          })),
          virPath: session.virPath,
          ...(virOnDisk !== null ? { virJsonSize: virOnDisk.length } : {}),
        },
      };
    },
  };

  return [compileRun, compileDiagnostics, compileVir];
}
