// Model Provider 公共契约（SPEC §6.1）：ChatMessage / ToolDefinition / ChatResponse / ModelProvider
// 所有 provider（openai-compatible / anthropic / manual）实现同一接口，ModelRouter 按策略切换。
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallRequest {
  id: string;
  name: string;
  /** 已 JSON.parse 的工具参数对象 */
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role=tool 时：对应 assistant toolCalls[].id */
  toolCallId?: string;
  /** role=tool 时：工具名（部分 provider 需要） */
  name?: string;
  /** role=assistant 时：模型发起的工具调用请求 */
  toolCalls?: ToolCallRequest[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object（zodToJsonSchema 产物） */
  parameters: Record<string, unknown>;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCallRequest[];
  model: string;
  usage?: ChatUsage;
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** 核采样概率（openai-compatible → top_p；anthropic → top_p） */
  topP?: number;
}

export interface ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: { vision: boolean; tools: boolean };
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
}

export interface ProviderCapabilities {
  vision: boolean;
  tools: boolean;
}

/** Provider 配置错误 / 请求失败 / 响应解析失败（message 以 `${code}: ` 开头便于断言） */
export class ProviderError extends Error {
  readonly code: string;
  /** HTTP 状态码（网络/HTTP 错误时存在） */
  readonly status?: number;
  /** 响应体前 500 字符（便于诊断） */
  readonly body?: string;

  constructor(code: string, message: string, opts: { status?: number; body?: string } = {}) {
    super(`${code}: ${message}`);
    this.name = "ProviderError";
    this.code = code;
    this.status = opts.status;
    this.body = opts.body;
  }
}

/** 去掉 baseUrl 末尾的斜杠（支持带/不带尾斜杠的配置写法；不做任何其它改写） */
export function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new ProviderError("PROVIDER_INVALID_BASE_URL", "baseUrl must be a non-empty string");
  }
  return baseUrl.replace(/\/+$/, "");
}
