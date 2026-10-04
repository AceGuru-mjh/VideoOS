// OpenAICompatibleProvider：任意 /v1 兼容端点（OpenAI / GLM / DeepSeek / Qwen / …）。
// 端点：POST `${baseUrl}/chat/completions`，Bearer 鉴权。
// 注意：baseUrl 必须是完整 base（如 https://api.openai.com/v1、https://open.bigmodel.cn/api/paas/v4），
//       构造时只去掉尾部斜杠，**不会自动补 /v1** —— 显式配置优于隐式猜测（GLM 的 base 就不含 /v1）。
import { ProviderError, normalizeBaseUrl } from "./types";
import type { ChatMessage, ChatOptions, ChatResponse, ChatUsage, ModelProvider, ProviderCapabilities, ToolDefinition } from "./types";

export interface OpenAICompatibleOptions {
  id: string;
  /** 完整 base URL（含版本段），如 https://open.bigmodel.cn/api/paas/v4 */
  baseUrl: string;
  /** API key；缺省读构造时传入的 apiKeyEnv 或默认 env OPENAI_API_KEY */
  apiKey?: string;
  /** apiKey 缺省时读取的 env 变量名（默认 "OPENAI_API_KEY"） */
  apiKeyEnv?: string;
  model: string;
  vision?: boolean;
  tools?: boolean;
  /** 请求超时（毫秒，默认 120_000） */
  timeoutMs?: number;
  /** 测试注入用：自定义 fetch（默认 globalThis.fetch） */
  fetchImpl?: typeof fetch;
}

interface OpenAIWireToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface OpenAIWireMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIWireToolCall[];
  tool_call_id?: string;
  name?: string;
}

/** ChatMessage[] → OpenAI wire 格式（assistant 的 toolCalls 展开；tool 消息带 tool_call_id） */
export function toOpenAiMessages(messages: ChatMessage[]): OpenAIWireMessage[] {
  return messages.map((m) => {
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content.length > 0 ? m.content : null,
        ...(m.toolCalls !== undefined && m.toolCalls.length > 0
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            }
          : {}),
      };
    }
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "", ...(m.name !== undefined ? { name: m.name } : {}) };
    }
    return { role: m.role, content: m.content };
  });
}

/** OpenAI tools 参数格式 */
export function toOpenAiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: OpenAICompatibleOptions) {
    if (typeof opts.id !== "string" || opts.id.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_ID", "provider id must be a non-empty string");
    }
    this.id = opts.id;
    this.model = opts.model;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey ?? process.env[opts.apiKeyEnv ?? "OPENAI_API_KEY"];
    this.capabilities = { vision: opts.vision ?? false, tools: opts.tools ?? true };
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (messages.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_INPUT", "chat(): messages must not be empty");
    }
    const body: Record<string, unknown> = { model: this.model, messages: toOpenAiMessages(messages) };
    if (opts.tools !== undefined && opts.tools.length > 0) body.tools = toOpenAiTools(opts.tools);
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    const url = `${this.baseUrl}/chat/completions`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey !== undefined && this.apiKey.length > 0 ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError("PROVIDER_REQUEST_FAILED", `${url}: ${(err as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new ProviderError("PROVIDER_HTTP_ERROR", `${url} → HTTP ${res.status}`, {
        status: res.status,
        body: text.slice(0, 500),
      });
    }

    let json: {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIWireToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", `non-JSON response from ${url}`, { body: text.slice(0, 500) });
    }
    if (json.error !== undefined) {
      throw new ProviderError("PROVIDER_API_ERROR", json.error.message ?? JSON.stringify(json.error), { body: text.slice(0, 500) });
    }
    const message = json.choices?.[0]?.message;
    if (message === undefined) {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", `no choices[0].message in response`, { body: text.slice(0, 500) });
    }

    const toolCalls = message.tool_calls?.map((tc) => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        throw new ProviderError("PROVIDER_BAD_RESPONSE", `tool_call "${tc.id}" has non-JSON arguments: ${tc.function.arguments.slice(0, 200)}`);
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    const usage: ChatUsage | undefined = json.usage !== undefined
      ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
      : undefined;

    return {
      content: message.content ?? "",
      ...(toolCalls !== undefined && toolCalls.length > 0 ? { toolCalls } : {}),
      model: this.model,
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}
