// PluginHost —— 进程内插件宿主（与 mcp-host 的外部进程模型互补：这里动态 import + activate）。
// 生命周期：discover（扫 roots 子目录 + manifest 校验）→ start（逐插件 import + activate + staging 提交）
// → listTools/callTool（全名路由 + zod 校验 + 错误隔离）→ emit（事件总线）→ stop（逆序 deactivate，幂等）。
// 核心不变量：单个插件在任何阶段失败都只记 skipped/log，绝不炸宿主与其他插件。
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "@videoos/mcp-lite";
import { loadManifest } from "./manifest";
import type { PluginManifest } from "./manifest";
import { createPluginContext } from "./context";
import type { EventHandler, PluginLogLevel, PluginToolResult, ToolRunnerFn } from "./types";

/** 宿主日志事件（on("log") 与构造器 onLog 双通道） */
export interface PluginLogEvent {
  /** ISO 时间戳 */
  at: string;
  /** 插件 id，或 "host"（宿主自身日志） */
  plugin: string;
  level: PluginLogLevel;
  message: string;
}

export interface PluginHostOptions {
  /** 插件根目录列表（每个 root 下的子目录都是插件候选） */
  roots: string[];
  /** 禁用的插件 id 列表（discover 可见，start 跳过并记 skipped） */
  disabled?: string[];
  /** 宿主日志回调（等价于 on("log", cb)，构造期即生效） */
  onLog?: (event: PluginLogEvent) => void;
}

export interface DiscoveredPlugin {
  dir: string;
  manifest: PluginManifest;
}

export interface SkippedEntry {
  dir: string;
  reason: string;
}

export interface DiscoverResult {
  plugins: DiscoveredPlugin[];
  skipped: SkippedEntry[];
}

export interface StartResult {
  started: string[];
  skipped: SkippedEntry[];
}

/** listTools 条目：name 为全名 "<pluginId>.<toolName>" */
export interface ListedPluginTool {
  plugin: string;
  name: string;
  description: string;
  /** JSON Schema（mcp-lite zodToJsonSchema 产物；无法转换时降级为 {type:"object"}） */
  parameters: Record<string, unknown>;
  /** 原始 zod schema（进程内桥接可自行再转换） */
  schema: ZodTypeAny;
}

export interface ListedPlugin {
  id: string;
  name: string;
  version: string;
  dir: string;
  tools: string[];
  subscriptions: string[];
}

/** 插件入口模块契约 */
interface PluginModule {
  default: (ctx: never) => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}

interface HostedTool {
  pluginId: string;
  name: string;
  description: string;
  schema: ZodTypeAny;
  run: ToolRunnerFn;
}

interface LoadedPlugin {
  dir: string;
  manifest: PluginManifest;
  module: PluginModule;
  /** activate 期间的 staging（成功后并入全局注册表；失败整包丢弃） */
  tools: Map<string, HostedTool>;
  subscriptions: Array<{ event: string; handler: EventHandler }>;
}

const MAX_SCAN_DEPTH_DIR_NAMES = new Set(["node_modules"]);

export class PluginHost {
  private readonly roots: string[];
  private readonly disabled: Set<string>;
  private readonly logListeners = new Set<(event: PluginLogEvent) => void>();
  private readonly tools = new Map<string, HostedTool>();
  private readonly subscriptions = new Map<string, Array<{ pluginId: string; handler: EventHandler }>>();
  private loaded: LoadedPlugin[] = [];
  private running = false;

  constructor(options: PluginHostOptions) {
    this.roots = [...options.roots];
    this.disabled = new Set(options.disabled ?? []);
    if (options.onLog !== undefined) this.logListeners.add(options.onLog);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** 订阅宿主日志；返回取消订阅函数。目前只支持 "log" 通道 */
  on(event: "log", callback: (event: PluginLogEvent) => void): () => void {
    if (event !== "log") {
      throw new Error('E_EVENT: PluginHost.on only supports the "log" channel');
    }
    this.logListeners.add(callback);
    return () => {
      this.logListeners.delete(callback);
    };
  }

  private log(plugin: string, level: PluginLogLevel, message: string): void {
    const entry: PluginLogEvent = { at: new Date().toISOString(), plugin, level, message };
    for (const listener of [...this.logListeners]) {
      try {
        listener(entry);
      } catch {
        // 日志通道绝不外溢（回调自身抛错忽略）
      }
    }
  }

  /** 扫描所有 roots 的子目录并校验 plugin.json（含禁用插件；重复 id 先到先得） */
  discover(): DiscoverResult {
    const plugins: DiscoveredPlugin[] = [];
    const skipped: SkippedEntry[] = [];
    const seen = new Set<string>();
    for (const root of this.roots) {
      let entries;
      try {
        entries = readdirSync(root, { withFileTypes: true });
      } catch (error) {
        this.log(
          "host",
          "warn",
          `plugin root not readable: ${root} (${error instanceof Error ? error.message : String(error)})`,
        );
        continue;
      }
      const directories = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of directories) {
        const dir = join(root, entry.name);
        if (entry.name.startsWith(".") || entry.name.startsWith("_") || MAX_SCAN_DEPTH_DIR_NAMES.has(entry.name)) {
          skipped.push({ dir, reason: "ignored directory (dot/underscore prefix or node_modules)" });
          continue;
        }
        const result = loadManifest(dir);
        if (!result.ok) {
          skipped.push({ dir, reason: result.error });
          continue;
        }
        if (seen.has(result.manifest.id)) {
          skipped.push({
            dir,
            reason: `duplicate plugin id "${result.manifest.id}" (already discovered in an earlier root)`,
          });
          continue;
        }
        seen.add(result.manifest.id);
        plugins.push({ dir, manifest: result.manifest });
      }
    }
    return { plugins, skipped };
  }

  /**
   * 加载全部未禁用插件：动态 import entry → activate(ctx) → staging 提交。
   * 单插件失败 → skipped 记原因，宿主继续。启动完成后逐插件 emit("plugin.loaded", {id})
   * 并 emit("host.started", {})（订阅者已在 activate 中注册，均能收到）。
   */
  async start(): Promise<StartResult> {
    if (this.running) {
      this.log("host", "warn", "start() ignored: host is already running");
      return { started: [], skipped: [] };
    }
    this.running = true;
    const { plugins, skipped } = this.discover();
    const started: string[] = [];
    for (const { dir, manifest } of plugins) {
      if (this.disabled.has(manifest.id)) {
        skipped.push({ dir, reason: `disabled by host (id "${manifest.id}")` });
        this.log(manifest.id, "info", "plugin disabled by host configuration");
        continue;
      }
      try {
        const module = await this.importPlugin(dir, manifest);
        const plugin: LoadedPlugin = { dir, manifest, module, tools: new Map(), subscriptions: [] };
        const context = createPluginContext({
          manifest,
          log: (level, message) => this.log(manifest.id, level, message),
          stageTool: (tool) => {
            if (plugin.tools.has(tool.name)) {
              throw new Error(`E_DUPLICATE: tool "${tool.name}" is already registered by plugin "${manifest.id}"`);
            }
            plugin.tools.set(tool.name, { pluginId: manifest.id, ...tool });
          },
          stageSubscription: (event, handler) => {
            plugin.subscriptions.push({ event, handler });
          },
          dispatchEvent: (event, payload) => this.emit(event, payload),
        });
        await module.default(context as never);
        // activate 成功 → 提交注册（半路失败的插件整包丢弃，不留脏数据）
        for (const tool of plugin.tools.values()) this.tools.set(tool.name, tool);
        for (const sub of plugin.subscriptions) {
          const list = this.subscriptions.get(sub.event) ?? [];
          list.push({ pluginId: manifest.id, handler: sub.handler });
          this.subscriptions.set(sub.event, list);
        }
        this.loaded.push(plugin);
        started.push(manifest.id);
        this.log(
          manifest.id,
          "info",
          `plugin activated (${plugin.tools.size} tool(s), ${plugin.subscriptions.length} subscription(s))`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ dir, reason: `activate failed: ${message}` });
        this.log(manifest.id, "error", `activate failed: ${message}`);
      }
    }
    for (const id of started) {
      await this.emit("plugin.loaded", { id });
    }
    await this.emit("host.started", {});
    return { started, skipped };
  }

  /** 逆序调用各插件 deactivate()（如有）+ 清空注册表；幂等，可重复调用 */
  async stop(): Promise<void> {
    if (!this.running && this.loaded.length === 0) return;
    const order = [...this.loaded].reverse();
    this.loaded = [];
    this.tools.clear();
    this.subscriptions.clear();
    this.running = false;
    for (const plugin of order) {
      const deactivate = plugin.module.deactivate;
      if (deactivate === undefined) continue;
      try {
        await deactivate();
        this.log(plugin.manifest.id, "info", "plugin deactivated");
      } catch (error) {
        this.log(
          plugin.manifest.id,
          "error",
          `deactivate failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** 全部已注册工具（name 为全名；parameters 为 JSON Schema） */
  listTools(): ListedPluginTool[] {
    return [...this.tools.values()].map((tool) => ({
      plugin: tool.pluginId,
      name: tool.name,
      description: tool.description,
      parameters: this.safeJsonSchema(tool),
      schema: tool.schema,
    }));
  }

  /** 已加载插件清单（诊断/测试用内省） */
  listPlugins(): ListedPlugin[] {
    return this.loaded.map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      dir: plugin.dir,
      tools: [...plugin.tools.keys()],
      subscriptions: [...new Set(plugin.subscriptions.map((sub) => sub.event))],
    }));
  }

  /**
   * 按全名调用插件工具：zod 入参校验（失败 → E_ARGS）；runner 抛错 → PLUGIN_ERROR（错误隔离，
   * 不炸宿主）；未注册 → TOOL_NOT_FOUND。runner 返回非规范形状时包装为 {ok:true, data}。
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<PluginToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      const available = [...this.tools.keys()].sort();
      return {
        ok: false,
        error: `TOOL_NOT_FOUND: ${name} (available: ${available.length > 0 ? available.join(", ") : "none"})`,
      };
    }
    const parsed = tool.schema.safeParse(args ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
        .join("; ");
      return { ok: false, error: `E_ARGS: ${detail}` };
    }
    try {
      const result = await tool.run(parsed.data as never);
      if (result === undefined || result === null) return { ok: true };
      if (typeof result === "object" && typeof (result as { ok?: unknown }).ok === "boolean") {
        return result as PluginToolResult;
      }
      return { ok: true, data: result };
    } catch (error) {
      return { ok: false, error: `PLUGIN_ERROR: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** 广播事件给所有已订阅 handler（按订阅顺序逐个 await）；handler 抛错记 log 不中断 */
  async emit(event: string, payload?: unknown): Promise<void> {
    const subs = this.subscriptions.get(event);
    if (subs === undefined || subs.length === 0) return;
    for (const { pluginId, handler } of [...subs]) {
      try {
        await handler(payload ?? null);
      } catch (error) {
        this.log(
          pluginId,
          "error",
          `event "${event}" handler failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async importPlugin(dir: string, manifest: PluginManifest): Promise<PluginModule> {
    const url = pathToFileURL(join(dir, manifest.entry)).href;
    const module = (await import(url)) as Partial<PluginModule>;
    if (typeof module.default !== "function") {
      throw new Error(`entry "${manifest.entry}" must export a default activate(ctx) function`);
    }
    if (module.deactivate !== undefined && typeof module.deactivate !== "function") {
      throw new Error(`entry "${manifest.entry}" deactivate export must be a function`);
    }
    return module as PluginModule;
  }

  private safeJsonSchema(tool: HostedTool): Record<string, unknown> {
    try {
      return zodToJsonSchema(tool.schema) as Record<string, unknown>;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log(tool.pluginId, "warn", `tool "${tool.name}" schema is not JSON-Schema convertible: ${reason}`);
      return { type: "object" };
    }
  }
}

/** 工厂函数（mcp-bridge 等组装方的惯用入口） */
export function createPluginHost(options: PluginHostOptions): PluginHost {
  return new PluginHost(options);
}
