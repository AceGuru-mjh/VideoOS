// @videoos/plugin-kit —— VideoOS 进程内插件运行时：manifest 严格校验 + 权限门禁 PluginContext + PluginHost。
// 30 秒上手：
//   const host = createPluginHost({ roots: ["<repo>/plugins"] });
//   const { started, skipped } = await host.start();   // 单插件失败只进 skipped
//   host.listTools();                                   // [{plugin, name, description, parameters, schema}]
//   await host.callTool("starter.hello", { name: "VideoOS" });
//   await host.stop();                                  // 逆序 deactivate，幂等
// 插件入口契约（plugins/<id>/index.ts，只允许 node:* 与 type-only 的本包 import）：
//   export default async function activate(ctx: PluginContext): Promise<void>
//   export function deactivate(): void  // 可选
export { pluginManifestSchema, loadManifest, PLUGIN_PERMISSIONS, PLUGIN_API_VERSION } from "./manifest";
export type { PluginManifest, PluginPermission, ManifestLoadResult } from "./manifest";
export { createPluginContext } from "./context";
export type { PluginContext, PluginFs, PluginContextDeps } from "./context";
export { PluginHost, createPluginHost } from "./host";
export type {
  PluginHostOptions,
  PluginLogEvent,
  DiscoveredPlugin,
  SkippedEntry,
  DiscoverResult,
  StartResult,
  ListedPluginTool,
  ListedPlugin,
} from "./host";
export type { PluginToolResult, PluginLogLevel, EventHandler, ToolRunnerFn, ZodNamespace } from "./types";
