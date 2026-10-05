// mcp-host 测试夹具：最小 echo/add 双工具服务器。
// 不同实例用 env FIXTURE_TAG 区分（echo 输出带 tag），用于验证同名冲突时的全名路由。
import { defineTool, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

const tag = process.env.FIXTURE_TAG ?? "default";

const tools = [
  defineTool(
    "echo",
    "Echo the text back together with the fixture instance tag.",
    z.object({ text: z.string().describe("text to echo back") }),
    ({ text }) => ok({ echo: text, tag }),
  ),
  defineTool(
    "add",
    "Add two numbers and return the sum.",
    z.object({
      a: z.number().describe("left operand"),
      b: z.number().describe("right operand"),
    }),
    ({ a, b }) => ok({ sum: a + b }),
  ),
];

await runStdioServer(tools, { serverName: "fixture-echo", serverVersion: "0.0.0" });
