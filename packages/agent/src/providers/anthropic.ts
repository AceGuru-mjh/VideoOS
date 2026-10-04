// AnthropicProvider：POST `${baseUrl}/v1/messages`（baseUrl 不含 /v1，如 https://api.anthropic.com）。
// headers：x-api-key + anthropic-version: 2023-06-01。
// 消息格式转换：system 提取为顶层 system 字段；assistant 的 toolCalls → tool_use content block；
// role=tool → user 的 tool_result content block。max_tokens 为 Anthropic 必填，默认 4096。
import { ProviderError, normalizeBaseUrl } from "./types";
import type { ChatMessage, ChatOptions, ChatResponse, ChatUsage, ModelProvider, ProviderCapabilities, ToolDefinition } from "./types";

export interface AnthropicOptions {
  id: string;
  /** 不含 /v1 的 base，如 https://api.anthropic.com（构造时只去尾斜杠） */
  baseUrl: string;
  apiKey?: string;
  /** apiKey 缺省时读取的 env 变量名（默认 "ANTHROPIC_API_KEY"） */
  apiKeyEnv?: string;
  model: string;
  /** Anthropic 必填 max_tokens 的默认值（未在 chat opts 指定时使用） */
  maxTokens?: number;
  vision?: boolean;
  tools?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

type WireContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface WireMessage {
  role: "user" | "assistant";
  content: string | WireContent[];
}

/** ChatMessage[] → Anthropic wire 格式（system 消息合并为顶层 system；tool 消息转为 user 的 tool_result） */
export function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: WireMessage[] } {
  const systemParts: string[] = [];
  const wire: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.length > 0) systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      wire.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content }],
      });
      continue;
    }
    if (m.role === "assistant") {
      const blocks: WireContent[] = [];
      if (m.content.length > 0) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      wire.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" });
      continue;
    }
    wire.push({ role: "user", content: m.content });
  }
  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: wire,
  };
}

/** Anthropic tools 参数格式（input_schema） */
export function toAnthropicTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

export class AnthropicProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly defaultMaxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AnthropicOptions) {
    if (typeof opts.id !== "string" || opts.id.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_ID", "provider id must be a non-empty string");
    }
    this.id = opts.id;
    this.model = opts.model;
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey ?? process.env[opts.apiKeyEnv ?? "ANTHROPIC_API_KEY"];
    this.defaultMaxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.capabilities = { vision: opts.vision ?? false, tools: opts.tools ?? true };
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResponse> {
    if (messages.length === 0) {
      throw new ProviderError("PROVIDER_INVALID_INPUT", "chat(): messages must not be empty");
    }
    const { system, messages: wireMessages } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      messages: wireMessages,
      ...(system !== undefined ? { system } : {}),
    };
    if (opts.tools !== undefined && opts.tools.length > 0) body.tools = toAnthropicTools(opts.tools);
    if (opts.temperature !== undefined) body.temperature = opts.temperature;

    const url = `${this.baseUrl}/v1/messages`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey ?? "",
          "anthropic-version": ANTHROPIC_VERSION,
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
      content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
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

    const blocks = json.content ?? [];
    const content = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    const toolCalls = blocks
      .filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
      .map((b) => ({ id: b.id as string, name: b.name as string, arguments: b.input ?? {} }));

    const usage: ChatUsage | undefined = json.usage !== undefined
      ? { promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens }
      : undefined;

    return {
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      model: this.model,
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}
