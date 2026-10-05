// @videoos/mcp-shell —— 命令执行服务器（stdio MCP）：cwd 被锁进 MCP_SHELL_ROOTS 监狱的 shell.exec + shell.which。
// 关键设计：spawn(shell, [shellArg, command], { shell: false }) 参数数组直传（不嵌套 shell，杜绝注入拼接）；
// win32 走 cmd /c + taskkill /PID /T /F 杀进程树，posix 走 /bin/sh -c + detached + kill(-pid) 杀整进程组；
// stdout/stderr 各自按 maxOutput 截断（UTF-8 字节安全）；超时返回 TIMEOUT 结构化错误而非挂死。
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { defineTool, jailFromEnv, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

const jail = await jailFromEnv("MCP_SHELL_ROOTS");

const IS_WIN = process.platform === "win32";
const STREAM_GRACE_MS = 800; // 进程退出后等流收尾的宽限期

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 平台 shell：win32 = cmd /c（写死 ComSpec 缺省 cmd.exe），posix = /bin/sh -c */
function shellSpec(): { shell: string; arg: string } {
  return IS_WIN ? { shell: process.env.ComSpec ?? "cmd.exe", arg: "/c" } : { shell: "/bin/sh", arg: "-c" };
}

/** 杀整棵进程树（超时用）：posix 杀进程组；win32 taskkill /T /F */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill();
    return;
  }
  if (IS_WIN) {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill());
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

interface Captured {
  text: string;
  cut: boolean;
}

/** 收集一个输出流，封顶 cap 字节；settle(graceMs) 在流结束或宽限期到时返回已有内容 */
function collectStream(stream: NodeJS.ReadableStream, cap: number): { settle(graceMs: number): Promise<Captured> } {
  const parts: Buffer[] = [];
  let size = 0;
  let cut = false;
  let settled = false;
  let resolve!: (value: Captured) => void;
  const promise = new Promise<Captured>((res) => {
    resolve = (value: Captured) => {
      if (settled) return;
      settled = true;
      res(value);
    };
  });
  const snapshot = (): Captured => ({
    text: cut ? `${Buffer.concat(parts).toString("utf8")}\n…[truncated at ${cap} bytes]` : Buffer.concat(parts).toString("utf8"),
    cut,
  });
  stream.on("data", (chunk: Buffer) => {
    if (size >= cap) {
      cut = true;
      return;
    }
    const remain = cap - size;
    const piece = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
    parts.push(piece);
    size += piece.length;
    if (chunk.length > remain) cut = true;
  });
  stream.on("end", () => resolve(snapshot()));
  stream.on("close", () => resolve(snapshot()));
  stream.on("error", () => resolve(snapshot()));
  return {
    settle(graceMs: number): Promise<Captured> {
      setTimeout(() => resolve(snapshot()), graceMs);
      return promise;
    },
  };
}

/** 等进程退出（close 优先；exit 后最多再等 400ms 流收尾；spawn 失败也结束） */
function waitExit(child: ChildProcess): Promise<{ code: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      if (grace !== undefined) clearTimeout(grace);
      resolve({ code, signal });
    };
    child.once("close", (code, signal) => finish(code, signal));
    child.once("exit", (code, signal) => {
      grace = setTimeout(() => finish(code, signal), 400);
    });
    child.once("error", () => finish(null, null));
  });
}

const tools = [
  defineTool(
    "shell.exec",
    "Run a shell command line (cmd /c on Windows, /bin/sh -c elsewhere) with cwd confined to the allowed roots; returns exit code, stdout/stderr and duration.",
    z.object({
      command: z.string().min(1).describe("command line to execute, e.g. \"echo hello\""),
      cwd: z.string().optional().describe("working directory (absolute, or relative to the first allowed root; default: first root)"),
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(60_000)
        .default(20_000)
        .describe("kill the process tree after this many ms (default 20000)"),
      maxOutput: z
        .number()
        .int()
        .min(64)
        .max(1_048_576)
        .default(65_536)
        .describe("per-stream output cap in bytes (default 65536)"),
    }),
    async ({ command, cwd, timeoutMs, maxOutput }) => {
      const cwdAbs = cwd !== undefined ? await jail.resolve(cwd) : jail.roots[0];
      if (cwdAbs === undefined) throw new ToolError("E_JAIL", "shell jail has no roots (set MCP_SHELL_ROOTS)");
      const { shell, arg } = shellSpec();
      const child = spawn(shell, [arg, command], {
        cwd: cwdAbs,
        detached: !IS_WIN, // posix：独立进程组，便于 kill(-pid) 杀整组
        stdio: ["ignore", "pipe", "pipe"],
        shell: false, // 参数数组直传，绝不嵌套第二层 shell
        windowsHide: true,
      });
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      const out = collectStream(child.stdout, maxOutput);
      const errStream = collectStream(child.stderr, maxOutput);
      const started = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child);
      }, timeoutMs);
      const exit = await waitExit(child);
      const [stdout, stderr] = await Promise.all([out.settle(STREAM_GRACE_MS), errStream.settle(STREAM_GRACE_MS)]);
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (timedOut) {
        throw new ToolError("TIMEOUT", `command killed after ${timeoutMs}ms: ${command.slice(0, 200)}`);
      }
      if (spawnError !== undefined) {
        throw new ToolError("E_SHELL", `failed to start ${shell}: ${spawnError.message} (cwd missing or shell unavailable)`);
      }
      return ok({
        command,
        exitCode: exit.code,
        ...(exit.signal !== null ? { signal: exit.signal } : {}),
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.cut || stderr.cut,
        durationMs,
      });
    },
  ),

  defineTool(
    "shell.which",
    "Locate an executable on PATH (where on Windows, which elsewhere); returns found:false instead of an error when missing.",
    z.object({
      command: z.string().min(1).describe('executable name to look up, e.g. "ffmpeg" or "bun"'),
    }),
    async ({ command }) => {
      if (command.includes("\0")) throw new ToolError("E_ARGS", "command must not contain null bytes");
      const finder = IS_WIN ? "where" : "which";
      const captured = await new Promise<{ error: Error | null; stdout: string }>((resolve) => {
        execFile(
          finder,
          [command],
          { timeout: 10_000, maxBuffer: 65_536, windowsHide: true },
          (error, stdout) => resolve({ error, stdout: String(stdout ?? "") }),
        );
      });
      const firstLine = captured.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (captured.error === null && firstLine !== undefined) {
        return ok({ found: true, command, path: firstLine });
      }
      return ok({ found: false, command });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-shell", serverVersion: "0.1.0" });
