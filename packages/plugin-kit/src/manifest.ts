// plugin-kit manifest 契约：plugins/<id>/plugin.json 的严格 zod 校验（未知字段报错带路径）。
// loadManifest(dir) 三段式：读文件 → JSON 语法 → schema 校验，再做两组交叉校验：
//   ① manifest.id 必须等于目录名（kebab-case）；② provides.tools 必须是 "<id>.<name>" 全名。
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

/** 插件权限白名单（宿主能力面：文件读 / 文件写 / 事件总线 / 工具注册） */
export const PLUGIN_PERMISSIONS = ["fs:read", "fs:write", "events", "tools"] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/** 当前插件 API 契约版本（manifest.apiVersion 必须精确匹配） */
export const PLUGIN_API_VERSION = "0.1";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const EVENT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
/** 工具全名：kebab 前缀 + "." + 非空剩余段（剩余段可再含 "."，如 "brand-guard.brand.lint"） */
const TOOL_FULL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\..+$/;

/** PluginManifest zod schema（严格模式：未知字段一律报错） */
export const pluginManifestSchema = z
  .object({
    id: z.string().regex(KEBAB_CASE, 'id must be kebab-case and equal to the directory name, e.g. "brand-guard"'),
    name: z.string().min(1, "name must be a non-empty display name"),
    version: z.string().regex(SEMVER, 'version must be x.y.z, e.g. "0.1.0"'),
    description: z.string().min(1, "description must be non-empty").max(200, "description must be at most 200 characters"),
    apiVersion: z.literal(PLUGIN_API_VERSION),
    permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
    provides: z
      .object({
        tools: z
          .array(
            z.string().regex(TOOL_FULL_NAME, 'tool name must be the full name "<pluginId>.<name>", e.g. "brand-guard.brand.lint"'),
          )
          .max(20, "at most 20 tools per plugin")
          .optional(),
        hooks: z
          .array(z.string().regex(EVENT_NAME, "hook must be a valid event name, e.g. \"plugin.loaded\""))
          .max(10, "at most 10 hooks (events the plugin subscribes to or emits)")
          .optional(),
      })
      .strict(),
    entry: z.literal("index.ts"),
    config: z.record(z.unknown()).optional(),
  })
  .strict();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export type ManifestLoadResult = { ok: true; manifest: PluginManifest } | { ok: false; error: string };

/** zod issues → 每条一行、带字段路径的人类可读摘要（与 mcp-host config.ts 同口径） */
function issuesToMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
}

/**
 * 读取并校验 plugins/<id>/plugin.json。
 * 失败返回 { ok:false, error }：error 带字段路径（schema 校验）或明确的交叉校验说明；
 * 成功返回深校验过的 manifest（config 保持 JSON 原值，由 PluginContext 再做深拷贝）。
 */
export function loadManifest(dir: string): ManifestLoadResult {
  const file = join(dir, "plugin.json");
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    return { ok: false, error: `plugin.json not readable: ${error instanceof Error ? error.message : String(error)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `plugin.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = pluginManifestSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `plugin.json: ${issuesToMessage(parsed.error)}` };
  }
  const manifest = parsed.data;
  const expectedId = basename(dir);
  if (manifest.id !== expectedId) {
    return { ok: false, error: `plugin.json id: "${manifest.id}" must equal the directory name "${expectedId}"` };
  }
  for (const tool of manifest.provides.tools ?? []) {
    if (!tool.startsWith(`${manifest.id}.`) || tool.length <= manifest.id.length + 1) {
      return {
        ok: false,
        error: `plugin.json provides.tools: "${tool}" must be the full name "${manifest.id}.<name>"`,
      };
    }
  }
  return { ok: true, manifest };
}
