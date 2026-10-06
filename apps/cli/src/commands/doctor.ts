// videoos doctor：环境体检（运行时 / ffmpeg / zod+canvas / 当前项目 / providers / GPU / 技能库 / MCP 宿主 / 热更新）
import process from "node:process";
import type { Command } from "commander";
import { detectFfmpeg, ffmpegVersion } from "@videoos/encode";
import { loadProviderConfig, ProviderError } from "@videoos/agent";
import { ProjectWorkspace } from "@videoos/workspace";
import { loadSkills } from "@videoos/server";
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

/** 技能库体检（Agent Kit P3 交付：42 内置技能；缺失不影响核心链路，黄牌提示） */
async function checkSkills(): Promise<CheckResult> {
  try {
    const skills = await loadSkills(null);
    if (skills.length === 0) {
      return { line: "skills     内置技能目录为空（skills/ 缺失或不可读 — 对话技能注入将退化为纯名单）", ok: false };
    }
    return { line: `skills     ${skills.length} 个内置技能（skills/ · videoos skills list 浏览）`, ok: true };
  } catch (err) {
    return { line: `skills     加载失败：${err instanceof Error ? err.message : String(err)}`, ok: false };
  }
}

/** MCP 宿主体检（Agent Kit P2 交付：@videoos/mcp-host — Studio/agent 对话的 MCP 工具桥） */
async function checkMcpHost(): Promise<CheckResult> {
  try {
    const host = await import("@videoos/mcp-host");
    const hasHost = typeof host.McpHost === "function" || typeof (host as { createHost?: unknown }).createHost === "function";
    if (!hasHost) {
      return { line: "mcp-host   已安装但导出形状不符（/api/mcp* 将 501 MCP_HOST_UNAVAILABLE）", ok: false };
    }
    return { line: "mcp-host   可用（@videoos/mcp-host · MCP 工具服务器桥接就绪）", ok: true };
  } catch {
    return { line: "mcp-host   未安装（MCP 工具路由将 501 — 供 agent 对话外接工具）", ok: true };
  }
}

/** 热更新体检（v0.4：安装形态 / 已装版本 / 最新版检查；离线只降级提示不判失败） */
async function checkUpdate(): Promise<CheckResult> {
  try {
    const { Updater, detectInstallMode } = await import("@videoos/updater");
    const mode = detectInstallMode();
    const modeLabel =
      mode === "source" ? "源码（git pull 更新）" : mode === "binary-managed" ? "受管二进制（可自动更新/回滚）" : "独立二进制";
    const updater = new Updater();
    const installed = updater.listInstalled();
    let line = `update     ${modeLabel}`;
    if (installed.length > 0) {
      line += ` · 已装 ${installed.map((v) => `v${v.version}${v.current ? "(current)" : ""}`).join(", ")}`;
    }
    try {
      const state = await updater.getUpdateState();
      line += state.available
        ? ` · 最新 v${state.latest} 可更新（videoos upgrade）`
        : ` · 已是最新 v${state.current}`;
    } catch {
      line += " · 在线检查不可用（离线/限流，非致命）";
    }
    return { line, ok: true };
  } catch (err) {
    return { line: `update     加载失败：${err instanceof Error ? err.message : String(err)}`, ok: false };
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
  checks.push(await checkSkills());
  checks.push(await checkMcpHost());
  checks.push(await checkUpdate());

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
