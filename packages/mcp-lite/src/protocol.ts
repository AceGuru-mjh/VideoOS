// MCP-Lite 线协议层（Agent Kit 冻结契约 C）：
// JSON-RPC 2.0 over 逐行 JSON（\n 分隔，无 Content-Length 头），与 @videoos/mcp 逐字节兼容。
// 自包含实现 —— 不依赖 @videoos/mcp / @videoos/agent（见 agent-kit/SPEC.md §3.3）。

/** JSON-RPC 2.0 错误对象 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 请求（有 id） */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 通知（无 id；不得产生响应） */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** JSON-RPC 响应（result 与 error 互斥） */
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/** JSON-RPC 2.0 标准错误码 + MCP 扩展（agent-kit SPEC 附录 C） */
export const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** MCP 扩展：initialize 之前收到其他请求 */
  SERVER_NOT_INITIALIZED: -32002,
} as const;

/** MCP-Lite 支持的最新协议版本（协商回退值） */
export const LATEST_PROTOCOL_VERSION = "2025-03-26";

export function isJsonRpcRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return (msg as JsonRpcRequest).method !== undefined && (msg as JsonRpcRequest).id !== undefined;
}

export function isJsonRpcNotification(msg: JsonRpcMessage): msg is JsonRpcNotification {
  const probe = msg as { method?: unknown; id?: unknown };
  return probe.method !== undefined && probe.id === undefined;
}

export function isJsonRpcResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return (msg as JsonRpcResponse).result !== undefined || (msg as JsonRpcResponse).error !== undefined;
}

/** 构造错误响应 */
export function errorResponse(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

/** 构造成功响应 */
export function resultResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/** 解析单行 JSON-RPC 消息（坏 JSON 抛错；调用方回 -32700） */
export function parseLine(line: string): JsonRpcMessage {
  return JSON.parse(line.trim()) as JsonRpcMessage;
}

/**
 * 逐行流式解析：readable（Node Readable / 任意 async iterable of string|Uint8Array）
 * → AsyncIterable<JsonRpcMessage>。容忍空行/尾随空白/\r\n；尾部残留行也会产出。
 * 非法 JSON 行不产出消息，改走 onParseError 回调（调用方据此回 -32700，id 只能为 null）。
 */
export async function* readMessages(
  readable: AsyncIterable<string | Uint8Array>,
  options: { onParseError?: (raw: string, error: Error) => void } = {},
): AsyncGenerator<JsonRpcMessage> {
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = function* (line: string): Generator<JsonRpcMessage> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      yield JSON.parse(trimmed) as JsonRpcMessage;
    } catch (err) {
      options.onParseError?.(trimmed, err instanceof Error ? err : new Error(String(err)));
    }
  };

  for await (const chunk of readable) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      yield* emit(line);
    }
  }
  yield* emit(buffer);
}

/** 可写流最小接口（process.stdout 满足；测试可注入收集器） */
export interface WritableStreamLike {
  write(chunk: string | Uint8Array): unknown;
}

/** 写一条 JSON-RPC 消息（单行 JSON + \n） */
export function writeMessage(w: WritableStreamLike, msg: JsonRpcMessage): void {
  w.write(`${JSON.stringify(msg)}\n`);
}
