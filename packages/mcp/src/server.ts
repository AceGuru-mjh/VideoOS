// MCP stdio 服务器（SPEC §8）：initialize / notifications/initialized / ping / tools/list / tools/call。
// 自实现协议（不依赖官方 SDK）；全部 VAP 工具自动映射为 MCP tools。
// JSON-RPC 错误码：-32700/-32600/-32601/-32602/-32603 + MCP 扩展 -32002（未初始化门禁）。
import {
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  JsonRpcErrorCodes,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";
import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from "./protocol";
import { SessionManager } from "./session-mgr";

/** MCP 规范最新协议版本（客户端请求不支持的版本时回退到它） */
export const LATEST_PROTOCOL_VERSION = "2025-03-26";

export interface McpServerOptions {
  /** serverInfo.name（默认 "videoos"） */
  serverName?: string;
  /** serverInfo.version（默认 "0.1.0"） */
  serverVersion?: string;
  /** 支持的协议版本（默认 ["2025-03-26", "2024-11-05"]，最新在前；客户端版本在列表内 → 回显，否则回列表最新） */
  supportedProtocolVersions?: string[];
}

/** 工具依赖形状 = @videoos/agent 的 VapToolRegistry（list()/call() 直连） */
export interface McpToolDeps {
  list(): Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  call(name: string, args: Record<string, unknown>, ctx: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

export interface McpServerDeps {
  tools: McpToolDeps;
  /** VapContext 装配（MCP 侧缓存同一实例；每连接一次） */
  getContext(): Promise<unknown>;
}

/** tools/call 参数校验错误（映射 -32602 invalid params） */
class RpcParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcParamError";
  }
}

/** 请求 id 提取（非法 id → null） */
function requestId(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

export class McpServer {
  private readonly deps: McpServerDeps;
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly supportedProtocolVersions: string[];
  /** 内部会话管理：上下文惰性单例 + 调用统计 */
  readonly sessions: SessionManager;
  private initialized = false;

  constructor(deps: McpServerDeps, options: McpServerOptions = {}) {
    this.deps = deps;
    this.serverName = options.serverName ?? "videoos";
    this.serverVersion = options.serverVersion ?? "0.1.0";
    this.supportedProtocolVersions =
      options.supportedProtocolVersions ?? [LATEST_PROTOCOL_VERSION, "2024-11-05"];
    // deps.getContext 透传给 SessionManager（首次调用才装配；与直接用 deps.getContext 行为一致）
    this.sessions = new SessionManager(() => deps.getContext());
  }

  /** 是否已完成 initialize（主要供测试/诊断） */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 处理一条已解析消息（runStdioServer 的主路径）。
   * 通知（无 id）→ null（不产生响应；notifications/initialized 显式忽略）；
   * 请求 → 响应对象；消息形状非法 → -32600。
   */
  async handleRequest(msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    // 形状防御：readMessages 产出的是 JSON.parse 的任意值
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
    if (isJsonRpcNotification(msg as JsonRpcMessage)) {
      // 通知无响应；notifications/initialized 是 initialize 的收尾（MCP 规范），显式忽略
      return null;
    }
    if (!isJsonRpcRequest(msg as JsonRpcMessage)) {
      return errorResponse(requestId(m.id), JsonRpcErrorCodes.INVALID_REQUEST, "Invalid Request: bad id field");
    }
    const req = msg as JsonRpcRequest;

    try {
      // 初始化门禁（MCP 规范）：initialize 之前收到其他请求 → -32002
      if (!this.initialized && req.method !== "initialize") {
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
    } catch (err) {
      if (err instanceof RpcParamError) {
        return errorResponse(req.id, JsonRpcErrorCodes.INVALID_PARAMS, err.message);
      }
      return errorResponse(
        req.id,
        JsonRpcErrorCodes.INTERNAL_ERROR,
        `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 处理完整一行（原始字符串）：解析错 → -32700（id null）；其余委托 handleRequest */
  async handleMessage(raw: string): Promise<string | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const res = errorResponse(
        null,
        JsonRpcErrorCodes.PARSE_ERROR,
        `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return JSON.stringify(res);
    }
    const response = await this.handleRequest(parsed as JsonRpcMessage);
    return response === null ? null : JSON.stringify(response);
  }

  // -------------------------------------------------------------------------
  // 方法实现
  // -------------------------------------------------------------------------

  private handleInitialize(params: unknown): {
    protocolVersion: string;
    capabilities: { tools: { listChanged: boolean } };
    serverInfo: { name: string; version: string };
  } {
    const requested =
      params !== null && typeof params === "object" && typeof (params as { protocolVersion?: unknown }).protocolVersion === "string"
        ? (params as { protocolVersion: string }).protocolVersion
        : undefined;
    // 版本协商：客户端版本在 supported 列表 → 回显；否则回最新（列表首项 = 最新；MCP 规范）
    const fallback =
      this.supportedProtocolVersions.length > 0 ? this.supportedProtocolVersions[0] : LATEST_PROTOCOL_VERSION;
    const protocolVersion =
      requested !== undefined && this.supportedProtocolVersions.includes(requested) ? requested : fallback;
    this.initialized = true;
    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: this.serverName, version: this.serverVersion },
    };
  }

  private listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.deps.tools.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    }));
  }

  private async callTool(params: unknown): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError: boolean;
  }> {
    if (params !== undefined && params !== null && typeof params !== "object") {
      throw new RpcParamError("params must be an object: { name, arguments? }");
    }
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof p.name !== "string" || p.name.length === 0) {
      throw new RpcParamError(`params.name must be a non-empty string (got ${JSON.stringify(p.name) ?? "undefined"})`);
    }
    // arguments 缺省 → {}；非对象 → -32602
    let args: Record<string, unknown>;
    if (p.arguments === undefined || p.arguments === null) {
      args = {};
    } else if (typeof p.arguments === "object" && !Array.isArray(p.arguments)) {
      args = p.arguments as Record<string, unknown>;
    } else {
      throw new RpcParamError(`params.arguments must be an object (got ${Array.isArray(p.arguments) ? "array" : typeof p.arguments})`);
    }

    this.sessions.recordToolCall();
    const ctx = await this.sessions.context();
    const result = await this.deps.tools.call(p.name, args, ctx);
    if (!result.ok) this.sessions.recordToolError();
    // VapToolResult → MCP content：ok=false → isError:true + text=error；data JSON.stringify 2 空格
    const text = result.ok ? JSON.stringify(result.data ?? {}, null, 2) : (result.error ?? "unknown tool error");
    return { content: [{ type: "text", text }], isError: !result.ok };
  }
}

/**
 * stdio 主循环：stdin 逐行读取 → McpServer 处理 → stdout 逐条响应。
 * 解析失败的行 → -32700 响应（id null）；错误日志走 stderr；SIGINT/SIGTERM 优雅退出（exit 0）。
 */
export async function runStdioServer(deps: McpServerDeps, options?: McpServerOptions): Promise<void> {
  const server = new McpServer(deps, options);
  const name = options?.serverName ?? "videoos";
  const stdin = process.stdin as unknown as AsyncIterable<string | Uint8Array>;

  let exiting = false;
  const onSignal = (signal: string): void => {
    if (exiting) return;
    exiting = true;
    process.stderr.write(`[videoos/mcp] received ${signal}, exiting\n`);
    try {
      process.stdin.destroy();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  process.stderr.write(`[videoos/mcp] ${name} stdio server ready\n`);

  for await (const msg of readMessages(stdin, {
    onParseError: (raw, err) => {
      const res = errorResponse(
        null,
        JsonRpcErrorCodes.PARSE_ERROR,
        `Parse error: ${err.message} (line: ${raw.slice(0, 200)})`,
      );
      writeMessage(process.stdout, res).catch((e: unknown) => {
        process.stderr.write(`[videoos/mcp] write failed: ${String(e)}\n`);
      });
    },
  })) {
    if (exiting) break;
    try {
      const response = await server.handleRequest(msg);
      if (response !== null) await writeMessage(process.stdout, response);
    } catch (err) {
      // handleRequest 内部已兜底；此处防御极端情况
      process.stderr.write(`[videoos/mcp] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}
