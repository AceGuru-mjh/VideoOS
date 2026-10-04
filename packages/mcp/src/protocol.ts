// MCP stdio 传输协议层：JSON-RPC 2.0 over 逐行 JSON（换行分隔；不做 LSP 风格 Content-Length 头）。
// 消息类型：Request{id,method,params} / Response{id,result|error} / Notification{method,params}。
// 错误码遵循 JSON-RPC 2.0 + MCP 规范扩展（-32002 Server not initialized）。

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

/** JSON-RPC 通知（无 id；不得有响应） */
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

/** JSON-RPC 2.0 标准错误码 + MCP 扩展 */
export const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** MCP 扩展：initialize 之前收到其他请求 */
  SERVER_NOT_INITIALIZED: -32002,
} as const;

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

/**
 * 逐行流式解析：readable（Node Readable / 任意 async iterable of string|Uint8Array）
 * → AsyncIterable<JsonRpcMessage>。容忍空行/尾随空白/\r\n；尾部无换行的残留行也会产出。
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
    if (trimmed.length === 0) return; // 容忍空行与纯空白行
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
  // EOF 后的残留行（无尾随换行）
  if (buffer.length > 0) yield* emit(buffer);
}

/** 最小可写流形状（Node WriteStream / Bun stdout 均满足） */
export interface MessageWritable {
  write(chunk: string | Uint8Array, callback?: (error: Error | null | undefined) => void): unknown;
}

/** 序列化并写出一条消息：JSON.stringify + "\n"，等待底层 flush（写回调）后返回。 */
export async function writeMessage(writable: MessageWritable, msg: JsonRpcMessage): Promise<void> {
  const line = `${JSON.stringify(msg)}\n`;
  await new Promise<void>((resolve, reject) => {
    const ok = writable.write(line, (err) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    });
    if (!ok) {
      // 背压：等待 drain（写缓冲清空）再返回，保证逐条 flush 语义
      const stream = writable as { once?: (event: string, cb: () => void) => void };
      if (typeof stream.once === "function") stream.once("drain", () => resolve());
    }
  });
}
