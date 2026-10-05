// McpHost 配置装载（SPEC §3.4 / 附录 G）：mcp.json → McpHostConfig（未知字段报清晰错误）。
import { readFile } from "node:fs/promises";
import { z } from "zod/v4";
import type { McpHostConfig, McpServerConfig } from "./types";

const serverConfigSchema = z.strictObject({
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().min(100).max(600_000).optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
});

const hostConfigSchema = z.strictObject({
  servers: z.record(z.string().min(1), serverConfigSchema),
});

/** 校验后的配置条目（enabled 默认 true） */
export function normalizeServerConfig(name: string, cfg: McpServerConfig): McpServerConfig {
  return { ...cfg, enabled: cfg.enabled ?? true };
}

/** 解析 + 校验配置对象（loadHostConfig 与直接构造共用）；违规抛 Error，逐条列出字段路径 */
export function parseHostConfig(input: unknown): McpHostConfig {
  const parsed = hostConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid mcp.json: ${issues}`);
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, cfg] of Object.entries(parsed.data.servers)) {
    servers[name] = normalizeServerConfig(name, cfg as McpServerConfig);
  }
  return { servers };
}

/** 读 mcp.json → McpHostConfig（未知字段/缺 command 等都会给清晰错误） */
export async function loadHostConfig(path: string): Promise<McpHostConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read mcp.json at ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`mcp.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseHostConfig(json);
}
