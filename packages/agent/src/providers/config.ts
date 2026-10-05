// Provider 配置装载 + 工厂：VIDEOOS_PROVIDERS env（JSON 数组）→ ProviderConfig[] → createProvider
// apiKey 解析顺序：配置内 apiKey → env `VIDEOOS_PROVIDER_<ID>_KEY`（id 大写、非字母数字转下划线）。
import { AnthropicProvider } from "./anthropic";
import { ManualProvider } from "./manual";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { ProviderError } from "./types";
import type { ModelProvider } from "./types";

export type ProviderType = "openai-compatible" | "anthropic" | "manual";

/**
 * Provider 配置（VIDEOOS_PROVIDERS JSON 的条目形状）。
 * baseUrl 语义：
 * - openai-compatible：完整 base（含版本段），如 https://open.bigmodel.cn/api/paas/v4 或 https://api.openai.com/v1
 * - anthropic：不含 /v1，如 https://api.anthropic.com（请求时自动拼 /v1/messages）
 */
export interface ProviderConfig {
  id: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  /** manual 类型：内嵌脚本（演示/回放） */
  script?: Array<{ content?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>;
  model: string;
  vision?: boolean;
  tools?: boolean;
  // ---- 采样参数与超时（v0.2 §5.2）：openai-compatible / anthropic 构造级默认；manual 忽略 ----
  /** 默认采样温度（openai-compatible 0-2；anthropic 建议 ≤1） */
  temperature?: number;
  /** 默认单次请求最大输出 token 数（anthropic 必填 max_tokens 的默认值） */
  maxTokens?: number;
  /** 默认核采样概率 top_p（0-1） */
  topP?: number;
  /** 单次请求超时毫秒（默认 120_000） */
  timeoutMs?: number;
}

const ENV_PROVIDERS = "VIDEOOS_PROVIDERS";

/** env 变量名：VIDEOOS_PROVIDER_<ID>_KEY（id 归一为大写字母数字下划线） */
export function providerKeyEnvName(id: string): string {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `VIDEOOS_PROVIDER_${normalized}_KEY`;
}

/** 校验单个配置条目（缺 id/model/type、未知 type、缺 baseUrl 时抛 ProviderError） */
function validateConfig(entry: unknown, index: number): ProviderConfig {
  const at = `VIDEOOS_PROVIDERS[${index}]`;
  if (entry === null || typeof entry !== "object") {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${at}: must be an object`);
  }
  const cfg = entry as Partial<ProviderConfig>;
  if (typeof cfg.id !== "string" || cfg.id.length === 0) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${at}: "id" must be a non-empty string`);
  }
  if (cfg.type !== "openai-compatible" && cfg.type !== "anthropic" && cfg.type !== "manual") {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${at}: "type" must be "openai-compatible" | "anthropic" | "manual"`);
  }
  if (typeof cfg.model !== "string" || cfg.model.length === 0) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${at}: "model" must be a non-empty string`);
  }
  if (cfg.type !== "manual" && (typeof cfg.baseUrl !== "string" || cfg.baseUrl.length === 0)) {
    throw new ProviderError(
      "PROVIDER_CONFIG_INVALID",
      `${at}: "baseUrl" is required for type "${cfg.type}" (openai-compatible 需完整 base 如 https://open.bigmodel.cn/api/paas/v4；anthropic 需不含 /v1 如 https://api.anthropic.com)`,
    );
  }
  return cfg as ProviderConfig;
}

/**
 * 读取 env `VIDEOOS_PROVIDERS`（JSON：ProviderConfig[]）→ 配置数组（不实例化 provider）。
 * env 缺省/为空 → []；JSON 非法 → PROVIDER_CONFIG_INVALID。
 * apiKey 缺省时回填 `VIDEOOS_PROVIDER_<ID>_KEY`（来自传入 env 或 process.env）。
 */
export function loadProviderConfig(from: { env?: Record<string, string> } = {}): ProviderConfig[] {
  const env = from.env ?? process.env;
  const raw = env[ENV_PROVIDERS];
  if (raw === undefined || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${ENV_PROVIDERS} is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new ProviderError("PROVIDER_CONFIG_INVALID", `${ENV_PROVIDERS} must be a JSON array of provider configs`);
  }
  return parsed.map((entry, i) => {
    const cfg = validateConfig(entry, i);
    if (cfg.apiKey === undefined) {
      const key = env[providerKeyEnvName(cfg.id)];
      if (key !== undefined && key.length > 0) return { ...cfg, apiKey: key };
    }
    return cfg;
  });
}

/** 工厂：ProviderConfig → ModelProvider（采样参数仅 openai-compatible / anthropic 消费；manual 忽略） */
export function createProvider(cfg: ProviderConfig): ModelProvider {
  const validated = validateConfig(cfg, -1);
  const sampling = {
    ...(validated.temperature !== undefined ? { temperature: validated.temperature } : {}),
    ...(validated.maxTokens !== undefined ? { maxTokens: validated.maxTokens } : {}),
    ...(validated.topP !== undefined ? { topP: validated.topP } : {}),
    ...(validated.timeoutMs !== undefined ? { timeoutMs: validated.timeoutMs } : {}),
  };
  switch (validated.type) {
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        id: validated.id,
        baseUrl: validated.baseUrl ?? "",
        apiKey: validated.apiKey,
        model: validated.model,
        vision: validated.vision,
        tools: validated.tools,
        ...sampling,
      });
    case "anthropic":
      return new AnthropicProvider({
        id: validated.id,
        baseUrl: validated.baseUrl ?? "",
        apiKey: validated.apiKey,
        model: validated.model,
        vision: validated.vision,
        tools: validated.tools,
        ...sampling,
      });
    case "manual":
      return new ManualProvider({ id: validated.id, model: validated.model, script: validated.script ?? [] });
  }
}

/** 便捷装配：loadProviderConfig + createProvider（无配置 → []） */
export function createProvidersFromEnv(from: { env?: Record<string, string> } = {}): ModelProvider[] {
  return loadProviderConfig(from).map((cfg) => createProvider(cfg));
}
