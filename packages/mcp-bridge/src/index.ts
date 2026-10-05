// @videoos/mcp-bridge —— 插件工具 → MCP stdio 桥：PluginHost 进程内加载插件根目录，
// 全部插件工具转 LiteTool[]（name/description 透传，parameters 用 mcp-lite zodToJsonSchema 转换，
// call → host.callTool）。与 mcp-host 的外部进程模型互补：bridge 是"进程内插件"的进程外暴露面。
// env MCP_PLUGIN_ROOTS：插件根目录列表（冒号/分号分隔）；缺省 <repo>/plugins。
import { join } from "node:path";
import type { ZodTypeAny } from "zod";
import { runStdioServer, zodToJsonSchema, type LiteTool } from "@videoos/mcp-lite";
import { createPluginHost, type PluginHost } from "@videoos/plugin-kit";

const DEFAULT_PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..", "plugins");

function pluginRootsFromEnv(): string[] {
  const raw = process.env.MCP_PLUGIN_ROOTS?.trim();
  if (raw === undefined || raw.length === 0) return [DEFAULT_PLUGIN_ROOT];
  return raw
    .split(/[:;]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** zod → JSON Schema（防御：个别插件 schema 不可转换时降级，不让桥崩掉） */
function toParameters(schema: ZodTypeAny): Record<string, unknown> {
  try {
    return zodToJsonSchema(schema) as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}

const host: PluginHost = createPluginHost({ roots: pluginRootsFromEnv() });
const { started, skipped } = await host.start();
process.stderr.write(
  `[mcp-bridge] plugins started: ${started.length > 0 ? started.join(", ") : "(none)"}` +
    (skipped.length > 0
      ? `; skipped: ${skipped.map((entry) => `${entry.dir} (${entry.reason})`).join(" | ")}`
      : "") +
    "\n",
);

const tools: LiteTool[] = host.listTools().map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: toParameters(tool.schema),
  call: (args: Record<string, unknown>) => host.callTool(tool.name, args),
}));

try {
  await runStdioServer(tools, { serverName: "mcp-bridge", serverVersion: "0.1.0" });
} finally {
  await host.stop(); // stdin 结束自然返回 → 逆序 deactivate 再退出
}
