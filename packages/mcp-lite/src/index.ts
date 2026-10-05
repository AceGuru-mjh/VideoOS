// @videoos/mcp-lite — MCP 协议原语包（SPEC §3.3）。
// 导出面：JsonRpcErrorCodes / readMessages / writeMessage / errorResponse / resultResponse /
//        LiteTool / runStdioServer（+ 服务器实现辅助：defineTool / LiteParamError / 消息类型）。
export {
  JsonRpcErrorCodes,
  createLineBuffer,
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";
export type {
  JsonRpcError,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  ReadMessagesOptions,
  WritableStreamLike,
} from "./protocol";

export { defineTool, LiteParamError, rawTool, zodToJsonSchema } from "./tool";
export type { LiteTool, ToolResult } from "./tool";

export { handleLiteMessage, LATEST_PROTOCOL_VERSION, runStdioServer } from "./server";
export type { RunStdioServerOptions } from "./server";
