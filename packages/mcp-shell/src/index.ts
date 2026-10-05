// @videoos/mcp-shell — 受限 Shell 执行 MCP 服务器（Issue #32）。
// 安全基线（SPEC §3.5）：
//   1) 解释器按平台固定（不接受调用方指定，防任意解释器注入）；
//   2) cwd 必须落在路径监狱内（env MCP_SHELL_ROOTS，POSIX ':' 或 ';' 分隔，Windows ';'），
//      缺省为第一个监狱根；越狱 → 业务失败 { ok: false, error }；
//   3) stdout/stderr 分开采集并封顶 maxOutput（超限 truncated: true，且继续排空防止管道阻塞）；
//   4) 超时整进程组 SIGKILL（POSIX）：本机 dash 不做单命令 exec 优化，只杀 sh 会留下孤儿
//      子进程（还占着 stdout 管道导致响应挂起），因此 POSIX 下用独立进程组 + 组击杀。
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";
import { createJail, parseRoots } from "./jail";

// ---------------------------------------------------------------------------
// 解释器常量（平台固定）
// ---------------------------------------------------------------------------

/** Windows 解释器：cmd /c（SPEC §3.5：固定解释器，不开放给调用方） */
const WINDOWS_INTERPRETER = "cmd /c";
/** POSIX 解释器：/bin/sh -c */
const POSIX_INTERPRETER = "/bin/sh -c";
/** 按平台选定的解释器命令前缀（split 成数组交给 Bun.spawn，不经二次 shell 解析） */
const INTERPRETER = (process.platform === "win32" ? WINDOWS_INTERPRETER : POSIX_INTERPRETER).split(" ");

/** POSIX 用独立进程组（可整组击杀，杜绝孤儿）；Windows 无进程组语义，直接单杀 */
const USE_PROCESS_GROUP = process.platform !== "win32";

/** 存活中的进程组组长 PID（服务器退出时兜底击杀，防止遗留孤儿） */
const ACTIVE_GROUPS = new Set<number>();
process.on("exit", () => {
  for (const pgid of ACTIVE_GROUPS) {
    try {
      process.kill(-pgid, 9);
    } catch {
      /* 组已消亡 */
    }
  }
});

const jail = createJail(parseRoots(process.env.MCP_SHELL_ROOTS, process.cwd()));

/** 工具统一失败出口：JailError（越狱）/ spawn 异常 → 业务失败 { ok: false, error }（不抛出） */
function toFailure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

// ---------------------------------------------------------------------------
// 输出采集：封顶 + 快照（流 EOF 可能被后台孤儿进程无限期占住，不能干等）
// ---------------------------------------------------------------------------

interface CappedOutput {
  /** 已采集文本（封顶 cap 个字符） */
  text(): string;
  /** 是否触顶截断 */
  truncated(): boolean;
  /** 流关闭（EOF）后完成；有孤儿占管道时可能长时间不完成 */
  done: Promise<void>;
}

/** 分开采集一条输出流并封顶 cap 个字符；超限后丢弃但继续排空（防止子进程写满管道阻塞） */
function collectCapped(stream: ReadableStream<Uint8Array>, cap: number): CappedOutput {
  const state = { text: "", truncated: false };
  // done 永不 reject：流被销毁/中断时按已采集内容收场
  const done = (async (): Promise<void> => {
    try {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        if (!state.truncated) {
          state.text += decoder.decode(chunk, { stream: true });
          if (state.text.length > cap) {
            state.truncated = true;
            state.text = state.text.slice(0, cap);
          }
        }
      }
    } catch {
      /* 流中断：保留已采集内容 */
    }
  })();
  return { text: () => state.text, truncated: () => state.truncated, done };
}

// ---------------------------------------------------------------------------
// shell.exec — 执行命令（cwd 限监狱、超时组击杀、输出封顶）
// ---------------------------------------------------------------------------

const execTool = defineTool({
  name: "shell.exec",
  description: "执行 shell 命令（解释器平台固定：Windows cmd /c、POSIX /bin/sh -c）；cwd 必须在监狱内（缺省第一个根）；超时 SIGKILL 后 exitCode=124",
  schema: z.object({
    command: z.string().min(1),
    cwd: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
    // 注：任务用例需要 maxOutput=1000，下限放开到 1（上限仍为 1_048_576）
    maxOutput: z.number().int().min(1).max(1_048_576).optional(),
  }),
  call: async (args) => {
    try {
      const cwd = jail.resolveIn(args.cwd ?? jail.roots[0]);
      const timeoutMs = args.timeoutMs ?? 20_000;
      const maxOutput = args.maxOutput ?? 65_536;
      const proc = Bun.spawn({
        cmd: [...INTERPRETER, args.command],
        cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        ...(USE_PROCESS_GROUP ? { detached: true } : {}),
      });
      if (USE_PROCESS_GROUP) ACTIVE_GROUPS.add(proc.pid);
      // 先挂上流读取再等退出，避免管道写满导致死锁
      const out = collectCapped(proc.stdout, maxOutput);
      const err = collectCapped(proc.stderr, maxOutput);
      const killTree = (): void => {
        if (USE_PROCESS_GROUP) {
          try {
            process.kill(-proc.pid, 9); // 整组击杀（sh + 其 fork 的子进程）
            return;
          } catch {
            /* 组已消亡，回退单杀 */
          }
        }
        try {
          proc.kill(9);
        } catch {
          /* 已退出 */
        }
      };
      const startedAt = Date.now();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);
      let exitCode = -1;
      try {
        exitCode = await proc.exited;
      } finally {
        clearTimeout(timer);
        ACTIVE_GROUPS.delete(proc.pid);
      }
      // 等输出流收尾，但最多再等 300ms：直接子进程已退出，只有后台孤儿还占着管道时不再等
      let streamsDone = false;
      await Promise.race([
        Promise.all([out.done, err.done]).then(() => {
          streamsDone = true;
        }),
        Bun.sleep(300),
      ]);
      if (!streamsDone) {
        void proc.stdout.cancel().catch(() => { /* ignore */ });
        void proc.stderr.cancel().catch(() => { /* ignore */ });
      }
      const durationMs = Date.now() - startedAt;
      const truncated = out.truncated() || err.truncated();
      if (timedOut) {
        return {
          ok: true,
          data: {
            exitCode: 124,
            stdout: out.text(),
            stderr: `${err.text()}\n[killed: timeout after ${timeoutMs}ms]`,
            truncated,
            durationMs,
            timedOut: true,
          },
        };
      }
      return {
        ok: true,
        data: { exitCode, stdout: out.text(), stderr: err.text(), truncated, durationMs },
      };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// shell.which — 在服务器 PATH 中查找可执行文件
// ---------------------------------------------------------------------------

const whichTool = defineTool({
  name: "shell.which",
  description: "在服务器进程的 PATH 中查找可执行文件（Bun.which），返回 found 与完整路径",
  schema: z.object({ command: z.string().min(1) }),
  call: (args) => {
    const path = Bun.which(args.command) ?? null;
    return { ok: true, data: { found: path !== null, path } };
  },
});

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

await runStdioServer([execTool, whichTool], { serverName: "mcp-shell", serverVersion: "0.1.0" });
