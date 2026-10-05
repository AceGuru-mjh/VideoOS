// GoogleProvider：Gemini generateContent 原生适配器（SPEC §2.4）。
// POST {baseUrl}/v1beta/models/{model}:generateContent，header x-goog-api-key。
// 映射：system → systemInstruction；user/assistant → contents（role: user/model）；
// assistant toolCalls → functionCall parts；role=tool → user 的 functionResponse part；
// 工具定义 → tools.functionDeclarations；usageMetadata → ChatUsage。
// 错误：401/403 → PROVIDER_AUTH；429 → PROVIDER_RATE_LIMIT；fetch 抛错 → PROVIDER_NETWORK；
//       其余 HTTP → PROVIDER_HTTP_ERROR；非 JSON → PROVIDER_BAD_RESPONSE。
import { ProviderError } from "@videoos/agent";
import type { ChatMessage, ChatOptions, ChatResponse, ChatUsage, ModelProvider, ProviderCapabilities, ToolDefinition } from "@videoos/agent";
import type { FetchLike } from "../types";

export interface GoogleOptions {
  id: string;
  /** 不含路径的 base，如 https://generativelanguage.googleapis.com */
  baseUrl: string;
  apiKey?: string;
  /** apiKey 缺省时读取的 env 变量名 */
  apiKeyEnv?: string;
  model: string;
  vision?: boolean;
  tools?: boolean;
  timeoutMs?: number;
  /** 测试注入用：自定义 fetch */
  fetchImpl?: FetchLike;
}

/** Gemini generateContent 的 contents 条目（v1beta 线形状） */
interface GeminiContent {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
}

/** ChatMessage[] → Gemini 请求体片段（systemInstruction + contents） */
export function toGeminiContents(messages: ChatMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
} {
  const systemParts: string[] = [];
  const contents: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (m.content.length > 0) systemParts.push(m.content);
      continue;
    }
    if (m.role === "assistant") {
      const parts: Array<Record<string, unknown>> = [];
      if (m.content.length > 0) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
      }
      contents.push({ role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] });
      continue;
    }
    if (m.role === "tool") {
      // 工具结果以 user 轮的 functionResponse part 回传；content 尽量按 JSON 对象解析
      let response: unknown;
      try {
        response = JSON.parse(m.content);
      } catch {
        response = { result: m.content };
      }
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: m.name ?? m.toolCallId ?? "tool", response } }],
      });
      continue;
    }
    contents.push({ role: "user", parts: [{ text: m.content }] });
  }
  return {
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } } : {}),
    contents,
  };
}

/** ToolDefinition[] → Gemini tools 字段（functionDeclarations） */
export function toGeminiTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export class GoogleProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(opts: GoogleOptions) {
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
    const { systemInstruction, contents } = toGeminiContents(messages);
    const body: Record<string, unknown> = { contents };
    if (systemInstruction !== undefined) body.systemInstruction = systemInstruction;
    if (opts.tools !== undefined && opts.tools.length > 0) body.tools = toGeminiTools(opts.tools);
    const generationConfig: Record<string, number> = {};
    if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) generationConfig.maxOutputTokens = opts.maxTokens;
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const url = `${this.baseUrl}/v1beta/models/${this.model}:generateContent`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey ?? "",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError("PROVIDER_NETWORK", `${url}: ${(err as Error).message}`);
    }
    return this.parseResponse(url, res, await res.text());
  }

  /** 共享响应解析（chat 与后续扩展复用）；分类规则见文件头注释 */
  private parseResponse(url: string, res: Response, text: string): ChatResponse {
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("PROVIDER_AUTH", `${url} → HTTP ${res.status} (invalid or unauthorized API key)`, {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
      if (res.status === 429) {
        throw new ProviderError("PROVIDER_RATE_LIMIT", `${url} → HTTP 429 (rate limited)`, {
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
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string };
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new ProviderError("PROVIDER_BAD_RESPONSE", `non-JSON response from ${url}`, { body: text.slice(0, 500) });
    }
    if (json.error !== undefined) {
      throw new ProviderError("PROVIDER_API_ERROR", json.error.message ?? JSON.stringify(json.error), {
        body: text.slice(0, 500),
      });
    }

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const content = parts
      .filter((p) => typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
    const toolCalls = parts
      .filter((p) => p.functionCall !== undefined && typeof p.functionCall?.name === "string")
      .map((p, i) => ({
        id: `call_${i + 1}`,
        name: p.functionCall?.name as string,
        arguments: p.functionCall?.args ?? {},
      }));

    const usage: ChatUsage | undefined =
      json.usageMetadata !== undefined
        ? { promptTokens: json.usageMetadata.promptTokenCount, completionTokens: json.usageMetadata.candidatesTokenCount }
        : undefined;

    return {
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      model: this.model,
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}
