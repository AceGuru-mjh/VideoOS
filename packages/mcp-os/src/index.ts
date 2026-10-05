// @videoos/mcp-os —— 系统信息服务器（stdio MCP）：os.info / os.disk / os.env。
// 关键设计：info 严格遵守脱敏基线——不含用户名/家目录等身份字段；os.env 只回显显式请求的键，
// 键名或值命中 /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i 一律脱敏为 "***"（宁可多脱不可泄漏）。
import { statfs } from "node:fs/promises";
import * as os from "node:os";
import { defineTool, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const tools = [
  defineTool(
    "os.info",
    "Basic machine info (platform/arch/cpus/memory/hostname) for capability checks; deliberately excludes usernames and home paths.",
    z.object({}),
    () => {
      const cpus = os.cpus();
      return ok({
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpus: { model: cpus[0]?.model ?? "unknown", count: cpus.length },
        memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
      });
    },
  ),

  defineTool(
    "os.disk",
    "Filesystem usage for a path via statfs: total and free bytes (default path: the server's working directory).",
    z.object({
      path: z.string().optional().describe("filesystem path to stat (default: process.cwd())"),
    }),
    async ({ path }) => {
      const target = path !== undefined && path.length > 0 ? path : process.cwd();
      try {
        const info = await statfs(target);
        const totalBytes = Number(info.bsize) * Number(info.blocks);
        const freeBytes = Number(info.bsize) * Number(info.bavail);
        return ok({ path: target, totalBytes, freeBytes });
      } catch (error) {
        throw new ToolError("E_UNAVAILABLE", `statfs failed for ${target}: ${errMsg(error)}`);
      }
    },
  ),

  defineTool(
    "os.env",
    "Read selected environment variables by name; sensitive keys or values (KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL) are masked as \"***\".",
    z.object({
      keys: z
        .array(z.string().min(1))
        .max(100)
        .describe("environment variable names to read (only requested keys are returned)"),
    }),
    ({ keys }) => {
      const values: Record<string, string> = {};
      const missing: string[] = [];
      for (const key of keys) {
        const raw = process.env[key];
        if (raw === undefined) {
          missing.push(key);
          continue;
        }
        values[key] = SENSITIVE.test(key) || SENSITIVE.test(raw) ? "***" : raw;
      }
      return ok({ values, missing });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-os", serverVersion: "0.1.0" });
