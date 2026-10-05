// mcp-host 测试夹具：慢工具服务器。
// slow.echo 睡眠 FIXTURE_SLEEP_MS（默认 3000）后返回 —— 测宿主 callTool 超时"只杀等待、不杀进程"，
// 以及超时后迟到响应按 id 丢弃、后续调用继续可用。
import { defineTool, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

const sleepMs = Number(process.env.FIXTURE_SLEEP_MS ?? "3000");

const tools = [
  defineTool(
    "slow.echo",
    `Sleep ${sleepMs}ms then echo (host timeout fixture).`,
    z.object({ text: z.string().describe("text to echo back after sleeping") }),
    async ({ text }) => {
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      return ok({ echo: text, sleptMs: sleepMs });
    },
  ),
  defineTool("slow.ping", "Return immediately (control tool for post-timeout liveness).", z.object({}), () =>
    ok({ pong: true }),
  ),
];

await runStdioServer(tools, { serverName: "fixture-slow", serverVersion: "0.0.0" });
