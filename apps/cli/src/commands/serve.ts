// videoos serve / preview：启动 Studio 本地服务器（REST + WS；SPEC §11）。
// serve  = 仅 API server；preview = server + 自动打开浏览器（studio dist 存在时直接服务 UI）。
import process from "node:process";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { startStudioServer } from "@videoos/server";
import { color, fail, resolveProjectRoot, withProjectOption } from "../util";

function openBrowser(url: string): void {
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, shell: false });
    child.unref();
  } catch {
    console.error(color.yellow(`（无法自动打开浏览器，请手动访问 ${url}）`));
  }
}

export function registerServeCommands(program: Command): void {
  withProjectOption(
    program
      .command("serve")
      .description("启动 Studio 本地 API 服务器（REST + WS，默认 127.0.0.1:4747）")
      .option("-p, --port <port>", "监听端口", "4747")
      .option("--no-open", "不自动打开浏览器（preview 行为，serve 默认不打开）"),
  ).action(async (opts: { project?: string; port: string; open: boolean }) => {
    const root = resolveProjectRoot(opts.project);
    await bootServer(root, Number.parseInt(opts.port, 10), false);
  });

  program
    .command("preview")
    .description("打开 VideoOS Studio（启动 server + 自动打开浏览器）")
    .option("-p, --port <port>", "监听端口", "4747")
    .option("--project <path>", "项目根目录（缺省 cwd）")
    .action(async (opts: { project?: string; port: string }) => {
      const root = resolveProjectRoot(opts.project);
      await bootServer(root, Number.parseInt(opts.port, 10), true);
    });
}

async function bootServer(root: string, port: number, open: boolean): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`--port 需为 1-65535 的整数，got ${String(port)}`);
    return;
  }
  const url = `http://127.0.0.1:${port}`;
  console.error(color.gray(`[videoos] Studio server 启动中…（${url}）`));
  try {
    const handle = await startStudioServer({
      port,
      projectRoot: root,
      ...(open ? {} : {}),
    });
    const line = [
      `Studio API  http://127.0.0.1:${handle.port}/api/health`,
      `WebSocket   ws://127.0.0.1:${handle.port}/ws`,
      handle.state.projectSession !== null
        ? `项目        ${handle.state.projectSession.project.root}`
        : `项目        （未打开 — POST /api/project/open）`,
      `MCP         videoos mcp（项目目录运行）`,
    ].join("\n  ");
    console.error(`\n  ${color.cyan("▶ VideoOS Studio server")}\n  ${line}\n`);
    if (open) openBrowser(url);
  } catch (err) {
    fail(`server 启动失败：${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  // 保持进程存活（serve 模式：server 事件循环已持有句柄；此处兜底 stdin 关闭退出）
  await new Promise<void>((resolve) => {
    process.stdin.on("close", () => resolve());
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
  console.error(color.gray("\n[videoos] server 退出"));
}
