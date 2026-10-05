// mcp-host E2E 用的夹具服务器：由测试通过 FIXTURE_MODE 环境变量切换行为。
//   echo（默认）  : 工具 echo / ping —— 常规聚合与调用
//   extra        : 工具 extra —— 无冲突的多服务器聚合
//   dup          : 工具 shared / echo —— 两个 dup 服务器制造同名冲突
//   slow         : 工具 slow-echo（延迟 800ms）/ ping —— call 超时分支
//   crash        : 工具 boom（调用即 process.exit(1)）/ ping —— 崩溃重启
//   crash-on-start: 启动即退出 —— 重启频控 → unhealthy
// FIXTURE_PID_FILE 设置时把自身 PID 写入该文件（测试用其断言 stop() 后无孤儿）。
import { z } from "zod/v4";
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { writeFileSync } from "node:fs";

const mode = process.env.FIXTURE_MODE ?? "echo";
const pidFile = process.env.FIXTURE_PID_FILE;

if (pidFile !== undefined && pidFile.length > 0) {
  try {
    writeFileSync(pidFile, `${process.pid}\n`);
  } catch {
    // ignore
  }
}

if (mode === "crash-on-start") {
  process.exit(1);
}

const ping = defineTool({
  name: "ping",
  description: "returns pong",
  schema: z.object({}),
  call: () => ({ ok: true, data: { pong: true } }),
});

const echo = defineTool({
  name: "echo",
  description: "echo the text back",
  schema: z.object({ text: z.string().min(1) }),
  call: (args) => ({ ok: true, data: { echoed: args.text } }),
});

const shared = defineTool({
  name: "shared",
  description: "same-named tool to force qualified exposure",
  schema: z.object({ from: z.string().min(1) }),
  call: (args) => ({ ok: true, data: { from: args.from } }),
});

const extra = defineTool({
  name: "extra",
  description: "extra tool on the second server",
  schema: z.object({ n: z.number().int().optional() }),
  call: (args) => ({ ok: true, data: { got: args.n ?? 0 } }),
});

const slowEcho = defineTool({
  name: "slow-echo",
  description: "echoes after a 800ms delay (for timeout tests)",
  schema: z.object({ text: z.string().min(1) }),
  call: async (args) => {
    await new Promise((r) => setTimeout(r, 800));
    return { ok: true, data: { echoed: args.text } };
  },
});

const boom = defineTool({
  name: "boom",
  description: "crashes the server process when called",
  schema: z.object({}),
  call: () => {
    process.exit(1);
  },
});

const toolsByMode: Record<string, ReturnType<typeof defineTool>[]> = {
  echo: [echo, ping],
  extra: [extra],
  dup: [shared],
  slow: [slowEcho, ping],
  crash: [boom, ping],
};

await runStdioServer(toolsByMode[mode] ?? [echo, ping], { serverName: `fixture-${mode}`, serverVersion: "0.1.0" });
