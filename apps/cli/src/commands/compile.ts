// videoos compile：DSL → VIR + 诊断；场景表（name/duration/frames/beats）+ VIR 路径；error 诊断 → exit 1
import type { Command } from "commander";
import type { Diagnostic } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { SessionError } from "@videoos/agent";
import { color, ctxFor, fail, openProject, resolveProjectRoot, withProjectOption } from "../util";

function diagnosticLabel(level: Diagnostic["level"]): string {
  if (level === "error") return color.red("[error]");
  if (level === "warning") return color.yellow("[warning]");
  return color.gray("[info]");
}

export function printCompileSummary(result: CompileResult, virPath: string): number {
  const { vir, semantic, diagnostics } = result;

  // 场景表
  const nameWidth = Math.max(8, ...semantic.scenes.map((s) => s.name.length + 2));
  console.log(`场景（${semantic.scenes.length}）：`);
  console.log(`  ${"name".padEnd(nameWidth)}duration   frames   beats`);
  for (const scene of semantic.scenes) {
    const beats = scene.beats.map((b) => b.name).join(", ") || "-";
    console.log(
      `  ${scene.name.padEnd(nameWidth)}${`${scene.duration.toFixed(2)}s`.padEnd(10)}${`${scene.frameEnd - scene.frameStart}`.padEnd(9)}${beats}`,
    );
  }
  console.log(
    color.gray(
      `  合计：${semantic.totalDuration.toFixed(2)}s / ${semantic.totalFrames} 帧 / ${vir.meta.width}×${vir.meta.height} @ ${vir.meta.fps}fps`,
    ),
  );
  console.log("");

  // 诊断（分级着色）
  if (diagnostics.length === 0) {
    console.log(color.green("✓ 诊断：无（0 error / 0 warning）"));
  } else {
    console.log(`诊断（${diagnostics.length}）：`);
    for (const d of diagnostics) {
      const where = [d.scene, d.layer].filter((x) => x !== undefined).join("/");
      console.log(`  ${diagnosticLabel(d.level)} ${d.code}: ${d.message}${where.length > 0 ? color.gray(` （${where}）`) : ""}`);
    }
  }

  // VIR 路径 + 错误计数
  console.log(color.gray(`VIR → ${virPath}`));
  return diagnostics.filter((d) => d.level === "error").length;
}

export function registerCompileCommand(program: Command): void {
  withProjectOption(
    program
      .command("compile")
      .description("DSL → VIR（含诊断；产物写 .video/vir.json）"),
  ).action(async (opts: { project?: string }) => {
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;
    const ctx = await ctxFor(project);
    let result: CompileResult;
    try {
      result = await ctx.compile();
    } catch (err) {
      if (err instanceof SessionError && err.code === "SESSION_ENTRY_NOT_FOUND") {
        fail(`${err.message}（manifest.entry = ${JSON.stringify(project.manifest.entry)}）`);
      } else if (err instanceof SessionError) {
        fail(err.message);
      } else {
        fail(`编译失败：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }
    const errors = printCompileSummary(result, project.paths.vir);
    if (errors > 0) {
      fail(`编译完成但有 ${errors} 个 error 诊断`);
    }
  });
}
