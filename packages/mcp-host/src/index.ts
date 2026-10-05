// @videoos/mcp-host —— MCP 客户端宿主（agent-kit SPEC §3.4）公共 API 汇出。
// 依赖 @videoos/mcp-lite 的协议原语（parseLine / LATEST_PROTOCOL_VERSION），核心宿主逻辑自实现。
export {
  loadHostConfig,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESTART_BACKOFF_MS,
  HANDSHAKE_TIMEOUT_MS,
  MAX_RESTARTS_PER_WINDOW,
  RESTART_WINDOW_MS,
  STOP_GRACE_MS,
} from "./config";
export type { McpServerConfig, McpHostConfig } from "./config";

export { McpHost } from "./host";
export type { ToolCallResult, ListedTool, HostLogEvent, HostLogCallback, ServerStatus } from "./host";
