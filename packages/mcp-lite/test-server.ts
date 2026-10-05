// MCP-Lite E2E 测试夹具（非包导出，仅由 bun test spawn；文件名避开 *.test.ts 防误收集）。
//   bun packages/mcp-lite/test-server.ts
import { defineTool, runStdioServer } from "./src/index";
import { z } from "zod";

await runStdioServer(
  [
    defineTool(
      "demo.echo",
      "Echo the text back.",
      z.object({ text: z.string().describe("text to echo") }),
      ({ text }) => ({ ok: true, data: { text } }),
    ),
    defineTool(
      "demo.add",
      "Add two integers.",
      z.object({ a: z.number().int(), b: z.number().int() }),
      ({ a, b }) => ({ ok: true, data: { sum: a + b } }),
    ),
    defineTool(
      "demo.fail",
      "Always fails with a structured tool error.",
      z.object({ message: z.string().default("boom") }),
      ({ message }) => ({ ok: false, error: `E_DEMO: ${message}` }),
    ),
    defineTool(
      "demo.throw",
      "Throws a raw error (server must catch it).",
      z.object({ message: z.string() }),
      ({ message }) => {
        throw new Error(message);
      },
    ),
  ],
  { serverName: "mcp-lite-test-server", serverVersion: "0.1.0" },
);
