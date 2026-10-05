// PluginContext —— 每插件独立实例的宿主能力门面：zod 注入、工具注册（staging）、
// 事件订阅/发布、受权限门禁的 fs。关键设计：
//   1. zod 由宿主注入（ctx.z）——plugins/ 不参与 workspace 依赖解析，插件不得自行 import zod；
//   2. registerTool/on/emit 越权即抛错 → activate 失败 → 宿主把该插件记入 skipped（错误隔离），
//      且 staging 中的半路注册不会并入全局注册表；
//   3. fs 是 node:fs 的朴素包装（无沙箱）：宿主若加载不受信插件，应自行包一层路径监狱。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import type { PluginManifest, PluginPermission } from "./manifest";
import type { EventHandler, PluginLogLevel, PluginToolResult, ToolRunnerFn } from "./types";

/** 受权限门禁的文件系统面（仅当 manifest 声明 fs:read / fs:write 时存在） */
export interface PluginFs {
  /** 读 UTF-8 文本（需 fs:read） */
  readFile(path: string): string;
  /** 写 UTF-8 文本（需 fs:write） */
  writeFile(path: string, data: string): void;
  /** 存在性检查（fs:read 或 fs:write 任一即可） */
  exists(path: string): boolean;
}

/** 每个插件的上下文（activate 的唯一入参） */
export interface PluginContext {
  /** 本插件 manifest（深校验过的 plugin.json） */
  readonly manifest: PluginManifest;
  /** manifest.config 的深拷贝（插件可自由改写，不影响其他插件） */
  readonly config: Record<string, unknown>;
  /** 宿主注入的 zod 实例——插件声明入参 schema 的唯一途径 */
  readonly z: typeof z;
  /** 文件系统面（无 fs 权限时为 undefined） */
  readonly fs: PluginFs | undefined;
  /** 记一条插件日志（宿主 on("log") 可观测） */
  log(message: string): void;
  /**
   * 订阅事件。要求："events" 权限 + 事件名已在 manifest.provides.hooks 声明，否则抛错。
   */
  on(event: string, handler: EventHandler): void;
  /**
   * 发布事件到宿主总线（广播给所有已订阅该事件的插件 handler）。
   * 要求同 on()。handler 抛错由宿主捕获记 log，不中断其他订阅者。
   */
  emit(event: string, payload?: unknown): Promise<void>;
  /**
   * 注册工具。要求："tools" 权限 + name 必须是 "<pluginId>.<name>" 全名，否则抛错。
   * run 接收经 schema 校验的入参，返回 PluginToolResult（或抛错 → 宿主转 PLUGIN_ERROR）。
   */
  registerTool<T extends z.ZodTypeAny>(registration: {
    name: string;
    description: string;
    schema: T;
    run: (args: z.infer<T>) => PluginToolResult | Promise<PluginToolResult>;
  }): void;
}

/** createPluginContext 的宿主注入面（host.ts 闭包提供，避免 context ↔ host 循环依赖） */
export interface PluginContextDeps {
  manifest: PluginManifest;
  log(level: PluginLogLevel, message: string): void;
  /** 工具进入插件级 staging（activate 成功后由宿主并入全局注册表） */
  stageTool(tool: { name: string; description: string; schema: z.ZodTypeAny; run: ToolRunnerFn }): void;
  /** 事件订阅进入插件级 staging */
  stageSubscription(event: string, handler: EventHandler): void;
  /** 插件内 emit → 宿主事件总线 */
  dispatchEvent(event: string, payload: unknown): Promise<void>;
}

/** 构造某插件的 PluginContext（host.ts 在 activate 前调用） */
export function createPluginContext(deps: PluginContextDeps): PluginContext {
  const { manifest } = deps;
  const has = (permission: PluginPermission): boolean => manifest.permissions.includes(permission);

  const assertEventAllowed = (event: string): void => {
    if (!has("events")) {
      throw new Error(`E_PERMISSION: plugin "${manifest.id}" needs the "events" permission to use on()/emit()`);
    }
    const declared = manifest.provides.hooks ?? [];
    if (!declared.includes(event)) {
      throw new Error(
        `E_EVENT: plugin "${manifest.id}" must declare "${event}" in provides.hooks before subscribing or emitting it`,
      );
    }
  };

  const fsApi: PluginFs | undefined =
    has("fs:read") || has("fs:write")
      ? {
          readFile(path) {
            if (!has("fs:read")) {
              throw new Error(`E_PERMISSION: plugin "${manifest.id}" needs "fs:read" to read files`);
            }
            return readFileSync(path, "utf8");
          },
          writeFile(path, data) {
            if (!has("fs:write")) {
              throw new Error(`E_PERMISSION: plugin "${manifest.id}" needs "fs:write" to write files`);
            }
            writeFileSync(path, data);
          },
          exists(path) {
            return existsSync(path);
          },
        }
      : undefined;

  return {
    manifest,
    // plugin.json 本身就是 JSON → JSON 往返即深拷贝，无需 structuredClone
    config: JSON.parse(JSON.stringify(manifest.config ?? {})) as Record<string, unknown>,
    z,
    fs: fsApi,
    log(message) {
      deps.log("info", message);
    },
    on(event, handler) {
      assertEventAllowed(event);
      deps.stageSubscription(event, handler);
    },
    emit(event, payload) {
      assertEventAllowed(event);
      return deps.dispatchEvent(event, payload);
    },
    registerTool(tool: {
      name: string;
      description: string;
      schema: z.ZodTypeAny;
      run: (args: never) => PluginToolResult | Promise<PluginToolResult>;
    }): void {
      if (!has("tools")) {
        throw new Error(
          `E_PERMISSION: plugin "${manifest.id}" needs the "tools" permission to register "${String(tool.name)}"`,
        );
      }
      if (
        typeof tool.name !== "string" ||
        !tool.name.startsWith(`${manifest.id}.`) ||
        tool.name.length <= manifest.id.length + 1
      ) {
        throw new Error(
          `E_NAME: tool name must be the full name "${manifest.id}.<name>" (got ${JSON.stringify(tool.name)})`,
        );
      }
      if (typeof tool.run !== "function") {
        throw new Error(`E_ARG: tool "${tool.name}" needs a run(args) function`);
      }
      deps.stageTool({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        run: tool.run as ToolRunnerFn,
      });
    },
  };
}
