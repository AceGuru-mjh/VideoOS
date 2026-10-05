// E2E 用的最小服务器（被 server.test.ts 以 Bun.spawn 真进程拉起）。
import { z } from "zod/v4";
import { defineTool, runStdioServer } from "./index";

const echo = defineTool({
  name: "echo",
  description: "echo the text back",
  schema: z.object({ text: z.string().min(1) }),
  call: (args) => ({ ok: true, data: { echoed: args.text } }),
});

await runStdioServer([echo], { serverName: "mcp-lite-e2e", serverVersion: "0.1.0" });
