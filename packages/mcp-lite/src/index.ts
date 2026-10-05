// @videoos/mcp-lite —— Agent Kit 本地 MCP 服务器协议原语包（自包含，不依赖 @videoos/mcp / @videoos/agent）。
// 用法（30 行组装一个 stdio 服务器）：
//   import { defineTool, runStdioServer, jailFromEnv, ok } from "@videoos/mcp-lite";
//   runStdioServer([defineTool("demo.echo", "echo", z.object({ text: z.string() }), ({ text }) => ok({ text }))], {
//     serverName: "mcp-demo",
//   });
export {
  JsonRpcErrorCodes,
  LATEST_PROTOCOL_VERSION,
  errorResponse,
  resultResponse,
  parseLine,
  readMessages,
  writeMessage,
  isJsonRpcRequest,
  isJsonRpcNotification,
  isJsonRpcResponse,
} from "./protocol";
export type { JsonRpcError, JsonRpcRequest, JsonRpcNotification, JsonRpcResponse, JsonRpcMessage, WritableStreamLike } from "./protocol";

export {
  defineTool,
  zodToJsonSchema,
  ok,
  err,
  ToolError,
  LiteValidationError,
} from "./tool";
export type { LiteTool, LiteToolResult, ToolRunner } from "./tool";

export { LiteServer, runStdioServer } from "./server";
export type { LiteServerOptions, LiteIO } from "./server";

export { jailFromEnv, createJail, createSyncJail } from "./jail";
export type { PathJail } from "./jail";

export {
  byteLength,
  truncateBytes,
  truncateList,
  withTimeout,
  TimeoutError,
  errorToResult,
  envInt,
} from "./util";
