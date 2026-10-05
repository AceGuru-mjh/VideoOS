// plugin-kit 公共类型：工具结果、日志级别、事件 handler。
// PluginToolResult 与 mcp-lite LiteToolResult / VapToolResult 形状一致（进程内直通给桥接层）。
import type { z } from "zod";

/** 工具结果：成功带 data；失败带人类可读 error（建议 "CODE: msg" 前缀） */
export type PluginToolResult = { ok: true; data?: unknown } | { ok: false; error: string };

/** 宿主日志级别 */
export type PluginLogLevel = "info" | "warn" | "error";

/** 事件 handler：同步或异步；抛错由宿主捕获记 log，不中断其他订阅者 */
export type EventHandler = (payload: unknown) => void | Promise<void>;

/**
 * 存储态工具运行器（宿主侧）。`never` 入参使任意具体签名的 run 函数
 * 都能安全赋值（never 是 bottom 类型，参数逆变恒成立）。
 */
export type ToolRunnerFn = (args: never) => PluginToolResult | Promise<PluginToolResult>;

/** 宿主注入的 zod 实例类型（插件从 ctx.z 取，禁止自行 import zod） */
export type ZodNamespace = typeof z;
