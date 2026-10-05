// @videoos/mcp-host — MCP 客户端宿主（SPEC §3.4）。
export { loadHostConfig, normalizeServerConfig, parseHostConfig } from "./config";
export { McpHost } from "./host";
export type { HostLogEvent, HostToolInfo, HostToolResult, McpHostConfig, McpServerConfig } from "./types";
