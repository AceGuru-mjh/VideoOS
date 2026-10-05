// testConnection 诊断器（SPEC §2.5）：错误五分支分类 + 延迟 + 可用模型实测。
// 策略：openai-compatible/custom → GET /models（404 时退化为最小 chat）；
//       google → GET /v1beta/models（Gemini listModels）；
//       anthropic / azure-openai → 最小 chat 请求（maxTokens: 1）。
// 分类表：401/403 → auth；404 且来自 chat 退化 → model；429 → rate-limit；
//         fetch 抛错 → network；其他 → unknown（附响应前 300 字符）。
import { ProviderError, providerKeyEnvName } from "@videoos/agent";
import { createProviderFromDescriptor } from "./factory";
import type { ConnectionReport, FetchLike, ProviderCreds, ProviderDescriptor } from "./types";

export interface TestConnectionOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/** 模型列表探测结果：ok=true 列表成功；ok=false 时 unavailable=true 表示网络层失败（无 HTTP 状态） */
type ListResult = { ok: true; models: string[] } | { ok: false; unavailable: boolean; status: number; body: string };

const DEFAULT_TIMEOUT_MS = 15_000;

interface ClassifyInput {
  status?: number;
  code?: string;
  body?: string;
  message: string;
  fromChatFallback: boolean;
}

/** 错误分类（SPEC §2.5 表） */
function classify(input: ClassifyInput): ConnectionReport["error"] {
  const { status, code } = input;
  if (status === 401 || status === 403 || code === "PROVIDER_AUTH") {
    return {
      kind: "auth",
      message: `认证失败（HTTP ${status ?? "?"}）：${input.message}`,
      hint: "请检查 API Key 是否正确 / 是否有余额 / 是否有该模型的调用权限",
    };
  }
  if (status === 429 || code === "PROVIDER_RATE_LIMIT") {
    return {
      kind: "rate-limit",
      message: `触发限流（HTTP ${status ?? "?"}）：${input.message}`,
      hint: "请求过于频繁或额度耗尽，请稍后重试",
    };
  }
  if (input.fromChatFallback && (status === 404 || code === "PROVIDER_MODEL_NOT_FOUND")) {
    return {
      kind: "model",
      message: `模型或部署不存在（HTTP 404）：${input.message}`,
      hint: "请检查模型名 / Azure 部署名是否正确（以 testConnection().models 实测列表为准）",
    };
  }
  if (code === "PROVIDER_NETWORK" || code === "PROVIDER_REQUEST_FAILED") {
    return {
      kind: "network",
      message: `网络请求失败：${input.message}`,
      hint: "请检查网络连接 / 代理设置 / baseUrl 是否正确",
    };
  }
  const detail = (input.body ?? input.message).slice(0, 300);
  return {
    kind: "unknown",
    message: `未知错误：${detail}`,
  };
}

/** GET {base}/models（openai-compatible 家）；200 → 模型列表；404 → null（调用方退化 chat） */
async function tryListOpenAiModels(
  base: string,
  apiKey: string | undefined,
  opts: TestConnectionOptions,
): Promise<ListResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(`${base}/models`, {
      method: "GET",
      headers: apiKey !== undefined && apiKey.length > 0 ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) {
      let json: { data?: Array<{ id?: string }> };
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, unavailable: false, status: res.status, body: `non-JSON response: ${text.slice(0, 200)}` };
      }
      const models = (json.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string");
      return { ok: true, models };
    }
    return { ok: false, unavailable: false, status: res.status, body: text };
  } catch (err) {
    return { ok: false, unavailable: true, status: 0, body: (err as Error).message };
  }
}

/** GET {base}/v1beta/models（Gemini listModels）；200 → 模型名列表（剥 models/ 前缀） */
async function tryListGeminiModels(
  base: string,
  apiKey: string | undefined,
  opts: TestConnectionOptions,
): Promise<ListResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  try {
    const res = await fetchImpl(`${base}/v1beta/models`, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey ?? "" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (res.ok) {
      let json: { models?: Array<{ name?: string }> };
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, unavailable: false, status: res.status, body: `non-JSON response: ${text.slice(0, 200)}` };
      }
      const models = (json.models ?? [])
        .map((m) => (typeof m.name === "string" ? m.name.replace(/^models\//, "") : undefined))
        .filter((id): id is string => id !== undefined);
      return { ok: true, models };
    }
    return { ok: false, unavailable: false, status: res.status, body: text };
  } catch (err) {
    return { ok: false, unavailable: true, status: 0, body: (err as Error).message };
  }
}

export async function testConnection(
  desc: ProviderDescriptor,
  creds: ProviderCreds = {},
  opts: TestConnectionOptions = {},
): Promise<ConnectionReport> {
  const started = Date.now();
  const apiKey = creds.apiKey ?? process.env[providerKeyEnvName(desc.id)];
  const base = (creds.baseUrl ?? desc.baseUrl).replace(/\/+$/, "");

  // ---------------------------------------------------------------- /models 快路径
  if (desc.type === "openai-compatible" || desc.type === "custom") {
    if (base.length === 0) {
      return {
        ok: false,
        latencyMs: 0,
        error: {
          kind: "unknown",
          message: "custom 端点未配置 baseUrl：请在设置中填写完整的 OpenAI 兼容 base（含版本段）",
          hint: "例如 https://your-gateway.com/v1",
        },
      };
    }
    const listed = await tryListOpenAiModels(base, apiKey, opts);
    if (listed.ok) {
      return { ok: true, latencyMs: Date.now() - started, models: listed.models };
    }
    if (listed.unavailable) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: classify({ code: "PROVIDER_NETWORK", message: listed.body, fromChatFallback: false }),
      };
    }
    if (listed.status !== 404) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: classify({ status: listed.status, body: listed.body, message: `GET ${base}/models → HTTP ${listed.status}`, fromChatFallback: false }),
      };
    }
    // 404：该家不支持 /models → 落到下方最小 chat 退化
  }

  if (desc.type === "google") {
    const listed = await tryListGeminiModels(base, apiKey, opts);
    if (!listed.ok) {
      if (listed.unavailable) {
        return {
          ok: false,
          latencyMs: Date.now() - started,
          error: classify({ code: "PROVIDER_NETWORK", message: listed.body, fromChatFallback: false }),
        };
      }
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: classify({ status: listed.status, body: listed.body, message: `GET ${base}/v1beta/models → HTTP ${listed.status}`, fromChatFallback: false }),
      };
    }
    return { ok: true, latencyMs: Date.now() - started, models: listed.models };
  }

  // ---------------------------------------------------------------- 最小 chat 退化
  const fromChatFallback = true;
  try {
    const provider = createProviderFromDescriptor(desc, { ...creds, apiKey, baseUrl: base.length > 0 ? base : undefined });
    await provider.chat([{ role: "user", content: "ping" }], { maxTokens: 1 });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    if (err instanceof ProviderError) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: classify({ status: err.status, code: err.code, body: err.body, message: err.message, fromChatFallback }),
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: classify({ message: err instanceof Error ? err.message : String(err), fromChatFallback }),
    };
  }
}
