// videoos doctor：环境体检（运行时 / ffmpeg / zod+canvas / 当前项目 / providers / GPU）
import process from "node:process";
import type { Command } from "commander";
import { detectFfmpeg, ffmpegVersion } from "@videoos/encode";
import { loadProviderConfig, ProviderError } from "@videoos/agent";
import { ProjectWorkspace } from "@videoos/workspace";
import { color, ctxFor, withProjectOption } from "../util";

interface CheckResult {
  line: string;
  ok: boolean;
}

async function checkRuntime(): Promise<CheckResult> {
  const parts: string[] = [];
  const anyBun = (globalThis as { Bun?: { version: string } }).Bun;
  if (anyBun !== undefined) parts.push(`bun ${anyBun.version}`);
  parts.push(`node ${process.version}`);
  return { line: `运行时     ${parts.join(" / ")}`, ok: true };
}

async function checkFfmpeg(): Promise<CheckResult> {
  const bin = detectFfmpeg();
  if (bin === null) {
    return {
      line: "ffmpeg     未找到（安装 ffmpeg 或设置 FFMPEG_PATH；videoos render 需要它）",
      ok: false,
    };
  }
  const version = await ffmpegVersion(bin);
  return { line: `ffmpeg     ${version ?? bin}（${bin}）`, ok: true };
}

async function checkDeps(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    // zod 经 @videoos/agent 链路加载（CLI 自身不直接依赖 zod）
    const agent = await import("@videoos/agent");
    const schema = agent.zodToJsonSchema;
    results.push({ line: `zod        可用（@videoos/agent ${typeof schema === "function" ? "✓" : "?"}）`, ok: typeof schema === "function" });
  } catch (err) {
    results.push({ line: `zod        不可用：${err instanceof Error ? err.message : String(err)}`, ok: false });
  }
  try {
    await import("@napi-rs/canvas");
    results.push({ line: "canvas     可用（@napi-rs/canvas / Skia 参考渲染后端）", ok: true });
  } catch (err) {
    results.push({ line: `canvas     不可用：${err instanceof Error ? err.message : String(err)}`, ok: false });
  }
  return results;
}

async function checkProject(root: string): Promise<CheckResult[]> {
  if (!ProjectWorkspace.isProject(root)) {
    return [
      {
        line: `项目       ${root} 不是 VideoOS 项目（videoos init <name> 创建）`,
        ok: false,
      },
    ];
  }
  try {
    const project = await ProjectWorkspace.open(root);
    const ctx = await ctxFor(project);
    const result = await ctx.compile();
    const errors = result.diagnostics.filter((d) => d.level === "error").length;
    const line =
      `项目       ${project.manifest.name}（${result.vir.scenes.length} 场景 / ${result.semantic.totalFrames} 帧` +
      ` / ${errors} error 诊断）` +
      (errors > 0 ? " ← compile 冒烟失败" : " · compile 冒烟通过");
    return [{ line, ok: errors === 0 }];
  } catch (err) {
    return [{ line: `项目       打开/编译失败：${err instanceof Error ? err.message : String(err)}`, ok: false }];
  }
}

function checkProviders(): CheckResult {
  try {
    const configs = loadProviderConfig();
    if (configs.length === 0) {
      return {
        line: "providers  未配置（videoos agent exec 需要 VIDEOOS_PROVIDERS，黄色提示非致命）",
        ok: true,
      };
    }
    const detail = configs.map((c) => `${c.id}:${c.model}(${c.type})`).join(", ");
    return { line: `providers  ${configs.length} 个：${detail}`, ok: true };
  } catch (err) {
    if (err instanceof ProviderError) {
      return { line: `providers  配置错误：${err.message}`, ok: false };
    }
    return { line: `providers  检查失败：${String(err)}`, ok: false };
  }
}

export async function runDoctor(root: string): Promise<void> {
  console.log(color.bold("VideoOS doctor — 环境体检"));
  console.log("");
  const checks: CheckResult[] = [];
  checks.push(await checkRuntime());
  checks.push(await checkFfmpeg());
  checks.push(...(await checkDeps()));
  checks.push(...(await checkProject(root)));
  checks.push(checkProviders());

  for (const c of checks) {
    console.log(`${c.ok ? color.green("✓") : color.yellow("✗")} ${c.line}`);
  }
  console.log(`${color.gray("○")} GPU       留待 Phase 2`);
  console.log("");
  const failed = checks.filter((c) => !c.ok).length;
  if (failed === 0) {
    console.log(color.green("环境就绪。"));
  } else {
    console.log(color.yellow(`${failed} 项需要注意（不影响 compile/test；render 需要 ffmpeg）。`));
  }
}

export function registerDoctorCommand(program: Command): void {
  withProjectOption(
    program
      .command("doctor")
      .description("环境体检：运行时 / ffmpeg / zod+canvas / 当前项目（compile 冒烟） / providers"),
  ).action(async (opts: { project?: string }) => {
    const root = opts.project !== undefined ? opts.project : process.cwd();
    await runDoctor(root);
  });
}
