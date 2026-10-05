// runStdioServer（SPEC §3.3）：读 stdin 行 → 路由 → 写 stdout 行。
// 行为：未 initialize 的请求回 -32002（initialize 本身除外）；未知方法 -32601（通知静默）；
//       tools/call 参数校验失败 -32602（message 含字段路径）；工具执行异常兜底 -32603；
//       工具业务失败走 result 级 { ok: false, error }。
// stdin 关闭（EOF）时返回；SIGINT/SIGTERM 优雅退出（exit 0）。
import {
  createLineBuffer,
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JsonRpcErrorCodes,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";
import type { JsonRpcMessage, JsonRpcResponse } from "./protocol";
import type { LiteTool } from "./tool";
import { LiteParamError } from "./tool";

export const LATEST_PROTOCOL_VERSION = "2025-03-26";

export interface RunStdioServerOptions {
  /** serverInfo.name（如 "mcp-fs"） */
  serverName?: string;
  /** serverInfo.version */
  serverVersion?: string;
}

/** 请求 id 提取（非法 id → null） */
function requestId(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

/** 消息形状校验：必须是 { jsonrpc: "2.0", method, params?, id? } */
function shapeError(msg: unknown): JsonRpcResponse | null {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return errorResponse(null, JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request: message must be a JSON-RPC 2.0 object");
  }
  const m = msg as { jsonrpc?: unknown; method?: unknown };
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || m.method.length === 0) {
    return errorResponse(
      requestId((msg as { id?: unknown }).id),
      JsonRpcErrorCodes.INVALID_REQUEST,
      'Invalid Request: expected { jsonrpc: "2.0", method, params?, id? }',
    );
  }
  return null;
}

/**
 * 单条消息处理器（runStdioServer 的核心路由；单元测试直连它，不必起进程）。
 * 通知（无 id）→ null（无响应）；请求 → 响应对象。
 */
export async function handleLiteMessage(
  msg: JsonRpcMessage,
  tools: LiteTool[],
  state: { initialized: boolean },
  opts: RunStdioServerOptions = {},
): Promise<JsonRpcResponse | null> {
  const invalid = shapeError(msg);
  if (invalid !== null) return invalid;

  if (isJsonRpcNotification(msg)) return null; // 通知静默（含 notifications/initialized）
  if (!isJsonRpcRequest(msg)) {
    return errorResponse(requestId((msg as { id?: unknown }).id), JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request: bad id field");
  }
  const req = msg;

  // 初始化门禁（MCP 规范）：initialize 之前收到其他请求 → -32002
  if (!state.initialized && req.method !== "initialize") {
    return errorResponse(
      req.id,
      JsonRpcErrorCodes.SERVER_NOT_INITIALIZED,
      "Server not initialized: send an initialize request first",
    );
  }

  try {
    switch (req.method) {
      case "initialize": {
        state.initialized = true;
        return resultResponse(req.id, {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: opts.serverName ?? "mcp-lite", version: opts.serverVersion ?? "0.1.0" },
        });
      }
      case "tools/list": {
        // parameters 为本项目契约键；inputSchema 为 MCP 标准键（双键输出，兼容两边客户端）
        return resultResponse(req.id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            inputSchema: t.parameters,
          })),
        });
      }
      case "tools/call": {
        if (req.params !== undefined && req.params !== null && typeof req.params !== "object") {
          return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, "params must be an object: { name, arguments? }");
        }
        const p = (req.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof p.name !== "string" || p.name.length === 0) {
          return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, `params.name must be a non-empty string (got ${JSON.stringify(p.name) ?? "undefined"})`);
        }
        let args: Record<string, unknown>;
        if (p.arguments === undefined || p.arguments === null) {
          args = {};
        } else if (typeof p.arguments === "object" && !Array.isArray(p.arguments)) {
          args = p.arguments as Record<string, unknown>;
        } else {
          return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, `params.arguments must be an object (got ${Array.isArray(p.arguments) ? "array" : typeof p.arguments})`);
        }
        const tool = tools.find((t) => t.name === p.name);
        if (tool === undefined) {
          return errorResponse(
            req.id,
            JsonRpcErrorCodes.INVALID_PARAMS,
            `unknown tool: ${JSON.stringify(p.name)} (available: ${tools.map((t) => t.name).join(", ") || "<none>"})`,
          );
        }
        const result = await tool.call(args);
        return resultResponse(req.id, {
          ...(result.ok ? { ok: true, ...(result.data !== undefined ? { data: result.data } : {}) } : { ok: false, ...(result.error !== undefined ? { error: result.error } : {}) }),
        });
      }
      default:
        return errorResponse(
          req.id,
          JsonRpcErrorCodes.METHOD_NOT_FOUND,
          `Method not found: ${JSON.stringify(req.method)} (supported: initialize, notifications/initialized, tools/list, tools/call)`,
        );
    }
  } catch (err) {
    if (err instanceof LiteParamError) {
      return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, err.message);
    }
    return errorResponse(
      req.id,
      JsonRpcErrorCodes.INTERNAL_ERROR,
      `Internal error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** stdio 主循环：stdin 逐行读取 → handleLiteMessage → stdout 逐条响应。 */
export async function runStdioServer(tools: LiteTool[], opts: RunStdioServerOptions = {}): Promise<void> {
  const state = { initialized: false };
  const name = opts.serverName ?? "mcp-lite";
  const buffer = createLineBuffer();
  const decoder = new TextDecoder();

  let exiting = false;
  const onSignal = (signal: string): void => {
    if (exiting) return;
    exiting = true;
    process.stderr.write(`[${name}] received ${signal}, exiting\n`);
    try {
      process.stdin.destroy();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  process.stderr.write(`[${name}] stdio server ready (${tools.length} tools)\n`);

  const respond = (msg: JsonRpcMessage): void => {
    try {
      writeMessage(process.stdout, msg);
    } catch (err) {
      process.stderr.write(`[${name}] write failed: ${String(err)}\n`);
    }
  };

  const handleLine = async (line: string): Promise<void> => {
    const messages = readMessages(line, {
      onParseError: (raw, err) => {
        respond(errorResponse(null, JsonRpcErrorCodes.PARSE_ERROR, `Parse error: ${err.message} (line: ${raw.slice(0, 200)})`));
      },
    });
    for (const msg of messages) {
      if (exiting) return;
      try {
        const response = await handleLiteMessage(msg, tools, state, opts);
        if (response !== null) respond(response);
      } catch (err) {
        process.stderr.write(`[${name}] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  };

  // process.stdin 是 async iterable（Node/Bun 一致）；逐 chunk 解码 → 行缓冲 → 逐行处理
  for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
    if (exiting) break;
    for (const line of buffer.feed(decoder.decode(chunk, { stream: true }))) {
      await handleLine(line);
    }
  }
  if (exiting) return;
  // EOF 残留行
  const rest = buffer.flush();
  if (rest !== null && rest.trim().length > 0) await handleLine(rest);
}
