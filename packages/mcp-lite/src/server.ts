// MCP-Lite stdio 服务器运行时（agent-kit SPEC §3.3）：
// 30 行组装一个服务器 —— 读 stdin 行 → 路由 → 写 stdout 行。
// 与 @videoos/mcp 线协议逐字节兼容：
//   initialize（协商 + 门禁）/ notifications/initialized（静默）/ ping / tools/list / tools/call；
//   未初始化 → -32002；未知方法 → -32601（通知静默）；入参校验失败 → -32602（含字段路径）；
//   服务器级崩溃兜底 → -32603；坏 JSON 行 → -32700（id null）。
import {
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JsonRpcErrorCodes,
  LATEST_PROTOCOL_VERSION,
  readMessages,
  resultResponse,
  writeMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";
import { LiteValidationError, type LiteTool, type LiteToolResult } from "./tool";

export interface LiteServerOptions {
  serverName?: string;
  serverVersion?: string;
  /** 支持的协议版本（缺省 ["2025-03-26", "2024-11-05"]，最新在前） */
  supportedProtocolVersions?: string[];
  /** 工具调用前置钩子（审计/限流；返回 false → 拒绝调用） */
  onToolCall?: (name: string, args: Record<string, unknown>) => boolean | Promise<boolean>;
}

/** 可注入 IO（测试用；缺省 process.stdin/stdout） */
export interface LiteIO {
  input?: AsyncIterable<string | Uint8Array>;
  output?: { write(chunk: string | Uint8Array): unknown };
  /** 停止信号（缺省不监听信号；runStdioServer 主入口监听 SIGINT/SIGTERM） */
  signal?: { addEventListener(kind: "abort", cb: () => void): void };
}

/** 门禁外方法集合 */
const GATE_EXEMPT = new Set(["initialize"]);

export class LiteServer {
  private readonly tools = new Map<string, LiteTool>();
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly supportedProtocolVersions: string[];
  private readonly onToolCall?: LiteServerOptions["onToolCall"];
  private initialized = false;

  constructor(tools: LiteTool[], options: LiteServerOptions = {}) {
    for (const tool of tools) this.tools.set(tool.name, tool);
    this.serverName = options.serverName ?? "mcp-lite";
    this.serverVersion = options.serverVersion ?? "0.1.0";
    this.supportedProtocolVersions = options.supportedProtocolVersions ?? [LATEST_PROTOCOL_VERSION, "2024-11-05"];
    this.onToolCall = options.onToolCall;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** 处理一条已解析消息：通知 → null；请求 → 响应；形状非法 → -32600 */
  async handleRequest(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
      return errorResponse(null, JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request: message must be a JSON-RPC 2.0 object");
    }
    const m = msg as { jsonrpc?: unknown; method?: unknown; id?: unknown };
    if (m.jsonrpc !== "2.0" || typeof m.method !== "string" || m.method.length === 0) {
      return errorResponse(
        requestId(m.id),
        JsonRpcErrorCodes.INVALID_REQUEST,
        'Invalid Request: expected { jsonrpc: "2.0", method, params?, id? }',
      );
    }
    if (isJsonRpcNotification(msg)) return null; // 通知无响应（notifications/initialized 显式忽略）
    if (!isJsonRpcRequest(msg)) {
      return errorResponse(requestId(m.id), JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request: bad id field");
    }
    const req = msg as JsonRpcRequest;

    try {
      if (!this.initialized && !GATE_EXEMPT.has(req.method)) {
        return errorResponse(
          req.id,
          JsonRpcErrorCodes.SERVER_NOT_INITIALIZED,
          "Server not initialized: send an initialize request first",
        );
      }
      switch (req.method) {
        case "initialize":
          return resultResponse(req.id, this.handleInitialize(req.params));
        case "ping":
          return resultResponse(req.id, {});
        case "tools/list":
          return resultResponse(req.id, { tools: this.listTools() });
        case "tools/call":
          return resultResponse(req.id, await this.callTool(req.params));
        default:
          return errorResponse(
            req.id,
            JsonRpcErrorCodes.METHOD_NOT_FOUND,
            `Method not found: ${JSON.stringify(req.method)} (supported: initialize, ping, tools/list, tools/call)`,
          );
      }
    } catch (error) {
      if (error instanceof LiteValidationError) {
        return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, error.message);
      }
      return errorResponse(
        req.id,
        JsonRpcErrorCodes.INTERNAL_ERROR,
        `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private handleInitialize(params: unknown): {
    protocolVersion: string;
    capabilities: { tools: { listChanged: boolean } };
    serverInfo: { name: string; version: string };
  } {
    const requested =
      params !== null && typeof params === "object" &&
      typeof (params as { protocolVersion?: unknown }).protocolVersion === "string"
        ? (params as { protocolVersion: string }).protocolVersion
        : undefined;
    const fallback = this.supportedProtocolVersions[0] ?? LATEST_PROTOCOL_VERSION;
    const protocolVersion =
      requested !== undefined && this.supportedProtocolVersions.includes(requested) ? requested : fallback;
    this.initialized = true;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: this.serverName, version: this.serverVersion },
    };
  }

  /** 工具清单（MCP tools/list 形状） */
  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
  }

  /** tools/call 主路径：入参形状校验 → 工具调用 → MCP content 形状 */
  private async callTool(params: unknown): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
    if (params !== undefined && params !== null && typeof params !== "object") {
      throw new LiteValidationError("params must be an object: { name, arguments? }");
    }
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof p.name !== "string" || p.name.length === 0) {
      throw new LiteValidationError(`params.name must be a non-empty string (got ${JSON.stringify(p.name) ?? "undefined"})`);
    }
    let args: Record<string, unknown>;
    if (p.arguments === undefined || p.arguments === null) {
      args = {};
    } else if (typeof p.arguments === "object" && !Array.isArray(p.arguments)) {
      args = p.arguments as Record<string, unknown>;
    } else {
      throw new LiteValidationError(`params.arguments must be an object (got ${Array.isArray(p.arguments) ? "array" : typeof p.arguments})`);
    }

    const tool = this.tools.get(p.name);
    if (tool === undefined) {
      throw new LiteValidationError(
        `unknown tool: ${JSON.stringify(p.name)} (available: ${[...this.tools.keys()].sort().join(", ")})`,
      );
    }
    if (this.onToolCall !== undefined && !(await this.onToolCall(p.name, args))) {
      throw new LiteValidationError(`tool call denied by server policy: ${p.name}`);
    }

    // 服务器级兜底：工具自身永不抛出（defineTool 已捕获），此处防御工具表被外部篡改等极端情况 → -32603
    const result = await this.invokeTool(tool, args);
    const text = result.ok ? JSON.stringify(result.data ?? {}, null, 2) : (result.error ?? "unknown tool error");
    return { content: [{ type: "text", text }], isError: !result.ok };
  }

  private async invokeTool(tool: LiteTool, args: Record<string, unknown>): Promise<LiteToolResult> {
    try {
      return await tool.call(args);
    } catch (error) {
      if (error instanceof LiteValidationError) throw error; // -32602
      return { ok: false, error: `TOOL_ERROR: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

/** 请求 id 提取（非法 id → null） */
function requestId(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

/**
 * stdio 主循环：stdin 逐行读 → LiteServer 处理 → stdout 逐条响应。
 * 坏 JSON 行 → -32700（id null）；SIGINT/SIGTERM 优雅退出（exit 0）；stdin 关闭时自然返回。
 */
export async function runStdioServer(
  tools: LiteTool[],
  options: LiteServerOptions = {},
  io: LiteIO = {},
): Promise<void> {
  const server = new LiteServer(tools, options);
  const name = options.serverName ?? "mcp-lite";
  const input = io.input ?? (process.stdin as unknown as AsyncIterable<string | Uint8Array>);
  const output = io.output ?? process.stdout;
  const prefix = `[${name}]`;

  let exiting = false;
  const shutdown = (reason: string,code: number): void => {
    if (exiting) return;
    exiting = true;
    process.stderr.write(`${prefix} ${reason}, exiting\n`);
    try {
      process.stdin.destroy();
    } catch {
      // ignore
    }
    process.exit(code);
  };
  if (io.signal === undefined) {
    process.on("SIGINT", () => shutdown("received SIGINT", 0));
    process.on("SIGTERM", () => shutdown("received SIGTERM", 0));
  } else {
    io.signal.addEventListener("abort", () => shutdown("aborted", 0));
  }

  process.stderr.write(`${prefix} stdio server ready (${server.listTools().length} tools)\n`);

  for await (const msg of readMessages(input, {
    onParseError: (raw, error) => {
      const res = errorResponse(
        null,
        JsonRpcErrorCodes.PARSE_ERROR,
        `Parse error: ${error.message} (line: ${raw.slice(0, 200)})`,
      );
      try {
        writeMessage(output, res);
      } catch (e) {
        process.stderr.write(`${prefix} write failed: ${String(e)}\n`);
      }
    },
  })) {
    if (exiting) break;
    try {
      const response = await server.handleRequest(msg);
      if (response !== null) writeMessage(output, response);
    } catch (error) {
      // handleRequest 内部已兜底；此处防御极端情况
      process.stderr.write(`${prefix} unexpected error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
}
