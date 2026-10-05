// Model Hub 契约（SPEC §2.2 / §2.3）：ProviderDescriptor / CatalogModel / ProviderCreds。
// 目录数据（catalog.json）是快照提示：运行时一律以 testConnection().models 实测为准。
import type { ModelProvider } from "@videoos/agent";

/** 目录条目的接入类型 */
export type DescriptorType =
  | "openai-compatible" // 复用 @videoos/agent OpenAICompatibleProvider
  | "anthropic" // 复用 @videoos/agent AnthropicProvider
  | "google" // 本包原生 GoogleProvider（Gemini generateContent）
  | "azure-openai" // 本包原生 AzureOpenAIProvider
  | "custom"; // 用户自定义（openai-compatible 行为，必填 baseUrl）

export interface CatalogModel {
  /** "glm-4.5"（供应商侧模型名） */
  id: string;
  /** "GLM-4.5"（展示名） */
  label: string;
  /** 上下文窗口（千 token） */
  contextK?: number;
  /** 是否支持工具调用 */
  tools: boolean;
  /** 是否支持视觉输入 */
  vision: boolean;
  /** ["fast"] / ["reasoning"] / ["cheap"] ... */
  tags?: string[];
  /** "≈¥1.4/M in" —— 仅展示用 */
  pricingHint?: string;
}

export interface ProviderDescriptor {
  /** 稳定小写 kebab，如 "deepseek"；与 env key 派生规则一致 */
  id: string;
  type: DescriptorType;
  /** "DeepSeek" */
  name: string;
  /** "深度求索" */
  nameZh: string;
  /** 默认完整 base（openai-compatible 含版本段；anthropic 不含 /v1；google 填 https://generativelanguage.googleapis.com；azure 填 https://<resource>.openai.azure.com；custom 为 ""） */
  baseUrl: string;
  /** 获取 key 的控制台地址 */
  keyUrl?: string;
  /** 文档地址 */
  docsUrl?: string;
  /** 本地推理（ollama / lmstudio）—— 无需 key */
  local?: boolean;
  /** 快照提示，运行时优先用 listModels 实测 */
  models: CatalogModel[];
  /** 接入注意事项（quirk） */
  notes?: string;
}

/** 工厂入参：凭据与覆盖项 */
export interface ProviderCreds {
  /** 缺省时按 @videoos/agent 规则读 env：VIDEOOS_PROVIDER_<ID>_KEY */
  apiKey?: string;
  /** 覆盖目录默认（custom 必填） */
  baseUrl?: string;
  /** 覆盖用户选择的模型（缺省取 models[0].id） */
  model?: string;
  timeoutMs?: number;
}

/** fetch 调用签名（与全局 fetch 兼容；测试注入用。比 typeof fetch 窄 —— 不要求 Bun 的 preconnect 属性） */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** 诊断报告（SPEC §2.5） */
export interface ConnectionReport {
  ok: boolean;
  /** 首个请求往返 */
  latencyMs: number;
  /** 实测 /models（或 Gemini listModels）结果 */
  models?: string[];
  error?: {
    kind: "auth" | "network" | "model" | "rate-limit" | "unknown";
    /** 人类可读（面向设置界面） */
    message: string;
    /** "请检查 API Key 是否正确 / 是否有余额" */
    hint?: string;
  };
}

export type { ModelProvider };
