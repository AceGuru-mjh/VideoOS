// AzureOpenAIProvider：Azure OpenAI 原生适配器（SPEC §2.4）。
// POST {baseUrl}/openai/deployments/{model}/chat/completions?api-version=2024-10-21，header api-key。
// body/响应与 OpenAI 相同（复用 @videoos/agent 的 toOpenAiMessages / toOpenAiTools wire 转换）；
// model = 部署名（deployment）。错误分类与 GoogleProvider 一致。
import { ProviderError, toOpenAiMessages, toOpenAiTools } from "@videoos/agent";
import type { ChatMessage, ChatOptions, ChatResponse, ChatUsage, ModelProvider, ProviderCapabilities, ToolDefinition } from "@videoos/agent";
import type { FetchLike } from "../types";

export const AZURE_API_VERSION = "2024-10-21";

export interface AzureOpenAIOptions {
  id: string;
  /** 资源 base，如 https://my-resource.openai.azure.com（不含 /openai 段） */
  baseUrl: string;
  apiKey?: string;
  /** apiKey 缺省时读取的 env 变量名 */
  apiKeyEnv?: string;
  /** 部署名（deployment name）——目录模型 id 只是提示，实际以部署为准 */
  model: string;
  vision?: boolean;
  tools?: boolean;
  timeoutMs?: number;
  /** 测试注入用：自定义 fetch */
  fetchImpl?: FetchLike;
}

interface OpenAIWireToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export class AzureOpenAIProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: AzureOpenAIOptions) {
    if (typeof opts.id !== "string" || opts.id.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_ID", "provider id must be a non-empty string");
    }
    this.id = opts.id;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? (opts.apiKeyEnv !== undefined ? process.env[opts.apiKeyEnv] : undefined);
    this.capabilities = { vision: opts.vision ?? false, tools: opts.tools ?? true };
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (messages.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_INPUT", "chat(): messages must not be empty");
    }
    const body: Record<string, unknown> = { messages: toOpenAiMessages(messages) };
    if (opts.tools !== undefined && opts.tools.length > 0) body.tools = toOpenAiTools(opts.tools);
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

    const url = `${this.baseUrl}/openai/deployments/${this.model}/chat/completions?api-version=${AZURE_API_VERSION}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "api-key": this.apiKey ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError("PROVIDER_NETWORK", `${url}: ${(err as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("PROVIDER_AUTH", `${url} → HTTP ${res.status} (invalid api-key or no access to this deployment)`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
      if (res.status === 429) {
        throw new ProviderError("PROVIDER_RATE_LIMIT", `${url} → HTTP 429 (rate limited / quota exceeded)`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
      // Azure 对不存在的部署返回 404 —— 部署名写错是高频问题，单独提示
      if (res.status === 404) {
        throw new ProviderError("PROVIDER_HTTP_ERROR", `${url} → HTTP 404 (deployment "${this.model}" not found — model must be the deployment name)`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
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

    const usage: ChatUsage | undefined =
      json.usage !== undefined
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
