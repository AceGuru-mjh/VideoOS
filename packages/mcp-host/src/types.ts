// McpHost 契约类型（SPEC §3.4）。
export interface McpServerConfig {
  /** "bun" 或绝对路径 exe */
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** 默认 true */
  enabled?: boolean;
  /** 单次 call 超时（毫秒），默认 30_000 */
  timeoutMs?: number;
  /** 工具白名单（缺省 = 全部） */
  allowedTools?: string[];
}

export interface McpHostConfig {
  servers: Record<string, McpServerConfig>;
}

/** listTools 条目 */
export interface HostToolInfo {
  server: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** tools/call 返回形状（与 @videoos/mcp-lite ToolResult 一致） */
export interface HostToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** on("log") 事件 */
export interface HostLogEvent {
  server: string;
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
}
