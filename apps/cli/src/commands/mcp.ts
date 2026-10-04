// videoos mcp [--standalone]：当前项目 → VapContext → 全量 VAP 工具 → MCP stdio server（SPEC §8）
// 非项目目录 → stderr 提示 + exit 1；--standalone（无项目仅非项目工具）v1 不支持，明确报错。
import process from "node:process";
import type { Command } from "commander";
import { ProjectWorkspace } from "@videoos/workspace";
import { startProjectMcpServer } from "@videoos/mcp";
import { color, fail, resolveProjectRoot, withProjectOption } from "../util";

export function registerMcpCommand(program: Command): void {
  withProjectOption(
    program
      .command("mcp")
      .description("启动 MCP stdio server（Claude Desktop / Codex / Cursor 直连 VAP 工具）")
      .option("--standalone", "无项目目录时仅暴露非项目工具（v1 需项目上下文，暂不支持）"),
  ).action(async (opts: { project?: string; standalone?: boolean }) => {
    const root = resolveProjectRoot(opts.project);
    if (!ProjectWorkspace.isProject(root)) {
      if (opts.standalone === true) {
        process.stderr.write(
          color.red("✗ --standalone 暂不支持：v1 的全部 VAP 工具都依赖项目上下文（entry/VIR/缓存）\n") +
            color.gray("  请 cd 到项目目录，或用 --project <path> 指定；M8 server 将提供无项目的全局工具\n"),
        );
      } else {
        process.stderr.write(
          color.red(`✗ ${root} 不是 VideoOS 项目（缺少 video.project.json）\n`) +
            color.gray("  请 cd 到项目目录或用 --project <path> 指定；先 videoos init 创建项目\n"),
        );
      }
      process.exitCode = 1;
      return;
    }

    process.stderr.write(color.gray(`[videoos/mcp] 项目 ${root}（stdio 就绪，等待 MCP 客户端连接…）\n`));
    try {
      await startProjectMcpServer(root, { serverName: "videoos" });
    } catch (err) {
      process.stderr.write(color.red(`✗ MCP server 启动失败：${err instanceof Error ? err.message : String(err)}\n`));
      process.exitCode = 1;
      return;
    }
    process.stderr.write(color.gray("[videoos/mcp] stdin 已关闭，server 退出\n"));
  });
}
