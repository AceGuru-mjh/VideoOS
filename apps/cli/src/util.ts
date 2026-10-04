// CLI 公共工具：项目打开 / VapContext 装配 / ANSI 颜色（NO_COLOR 与非 TTY 自动降级）/ 格式化
import { join, resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { createVapContext } from "@videoos/agent";
import type { VapContext, VapEvent } from "@videoos/agent";
import { ProjectWorkspace, WorkspaceError } from "@videoos/workspace";
import type { ProjectWorkspace as Project } from "@videoos/workspace";
import { projectToWorkspace } from "@videoos/mcp";

// ---------------------------------------------------------------------------
// 颜色（ANSI）
// ---------------------------------------------------------------------------

const colorEnabled = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

function wrap(code: string): (text: string) => string {
  return (text: string): string => (colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text);
}

/** 颜色辅助：NO_COLOR 环境变量或非 TTY 输出（管道/测试）时全部退化为原样输出 */
export const color = {
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  gray: wrap("90"),
  cyan: wrap("36"),
  bold: wrap("1"),
};

/** 输出到管道/测试时为 false（进度条等交互式输出的开关） */
export const isInteractive = process.stdout.isTTY === true;

// ---------------------------------------------------------------------------
// 项目 / 上下文
// ---------------------------------------------------------------------------

/**
 * 打开项目：WorkspaceError（WORKSPACE_NOT_FOUND / WORKSPACE_MANIFEST_INVALID）→ 友好提示 + exitCode 1 + 返回 null。
 */
export async function openProject(root: string): Promise<Project | null> {
  try {
    return await ProjectWorkspace.open(root);
  } catch (err) {
    if (err instanceof WorkspaceError) {
      console.error(color.red(`✗ ${err.message}`));
      if (err.code === "WORKSPACE_NOT_FOUND") {
        console.error(color.gray("  提示：先 `videoos init <name>` 创建项目，或用 --project 指定已有项目目录"));
      } else {
        console.error(color.gray("  提示：video.project.json 损坏；修复字段或重新 init"));
      }
    } else {
      console.error(color.red(`✗ 打开项目失败：${err instanceof Error ? err.message : String(err)}`));
    }
    process.exitCode = 1;
    return null;
  }
}

/**
 * 装配 VapContext：entryPath 取 manifest.entry（相对项目根解析）；onEvent 可旁路审计事件（agent 命令实时打印）。
 */
export async function ctxFor(
  project: Project,
  onEvent?: (e: VapEvent) => void,
): Promise<VapContext> {
  return createVapContext({
    workspace: projectToWorkspace(project),
    entryPath: join(project.root, project.manifest.entry),
    ...(onEvent !== undefined ? { onEvent } : {}),
  });
}

/** --project <path> 的默认解析（缺省 cwd） */
export function resolveProjectRoot(projectPath: string | undefined): string {
  return resolve(projectPath ?? ".");
}

/** 运行失败统一出口：红色消息 + exitCode（默认 1），不抛异常（action 内 return） */
export function fail(message: string, code = 1): void {
  console.error(color.red(`✗ ${message}`));
  if ((process.exitCode ?? 0) === 0) process.exitCode = code;
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 单行截断（事件/参数摘要打印） */
export function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------------------------------------------------------------------------
// commander 公共选项
// ---------------------------------------------------------------------------

/** 公共 --project <path> 选项（缺省当前目录；action 内经 resolveProjectRoot 解析） */
export function withProjectOption(cmd: Command): Command {
  return cmd.option("--project <path>", "项目目录（默认当前目录）");
}
