// mcp-lite 协议原语（SPEC §3.2/§3.3）：JSON-RPC 2.0 逐行 stdio。
// 与 @videoos/mcp 线协议逐字节兼容：同样的消息形状、错误码与 -32002 初始化门禁。
// 自包含实现 —— 不依赖 @videoos/mcp（避免拖入 workspace/agent）。

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

/** JSON-RPC 2.0 标准错误码 + MCP 扩展（附录 C） */
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

export interface ReadMessagesOptions {
  /** 单行 JSON 解析失败回调（调用方据此回 -32700，id 只能为 null）；缺省静默跳过 */
  onParseError?: (raw: string, error: Error) => void;
}

/**
 * 解析一段文本 chunk 中的全部 JSON-RPC 消息：按 \n 切行，容忍空行/\r/尾随空白，
 * 尾部无换行的残留行也会产出（粘包/半包由调用方缓冲，见 createLineBuffer）。
 * 非法 JSON 行不产出消息，改走 onParseError。
 */
export function readMessages(chunk: string, options: ReadMessagesOptions = {}): JsonRpcMessage[] {
  const out: JsonRpcMessage[] = [];
  const lines = chunk.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 最后一段是残留半行时交给调用方缓冲 —— 仅当 chunk 以 \n 结尾它才是空串
    if (i === lines.length - 1 && line.length === 0) continue;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      out.push(JSON.parse(trimmed) as JsonRpcMessage);
    } catch (err) {
      options.onParseError?.(trimmed, err instanceof Error ? err : new Error(String(err)));
    }
  }
  return out;
}

/**
 * 流式行缓冲（粘包安全）：feed(chunk) 返回本次凑齐的完整行（不含换行）。
 * EOF 时 flush() 返回残留行（可能为空串）。
 */
export function createLineBuffer(): { feed(chunk: string): string[]; flush(): string | null } {
  let buffer = "";
  return {
    feed(chunk: string): string[] {
      buffer += chunk;
      const lines: string[] = [];
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        lines.push(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      return lines;
    },
    flush(): string | null {
      if (buffer.length === 0) return null;
      const rest = buffer;
      buffer = "";
      return rest;
    },
  };
}

/** 最小可写流形状（Node WriteStream / Bun stdout / Bun FileSink 均满足） */
export interface WritableStreamLike {
  write(chunk: string | Uint8Array, callback?: (error: Error | null | undefined) => void): unknown;
}

/** 序列化并写出一条消息：JSON.stringify + "\n"（逐行协议，无 Content-Length 头） */
export function writeMessage(w: WritableStreamLike, msg: JsonRpcMessage): void {
  w.write(`${JSON.stringify(msg)}\n`);
}
