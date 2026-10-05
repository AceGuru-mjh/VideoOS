// 内置供应商目录（issue #46）：8 家厂商预设 + custom（用户自填）。
// 注：@videoos/model-hub（agent-kit P1）落地后，本文件整体替换为 model-hub 的目录导出 ——
//     消费方（providers.ts / Studio UI）仅依赖 PROVIDER_CATALOG / CatalogEntry / catalogKeyEnvHints 三个名字。
export interface CatalogEntry {
  id: string;
  label: string;
  /** 中文显示名（含厂商特定提示，如豆包的接入点 ID 说明） */
  labelZh: string;
  type: "openai-compatible" | "anthropic" | "manual";
  /**
   * 完整 base：openai-compatible 含 /v1（GLM 例外：https://open.bigmodel.cn/api/paas/v4）；
   * anthropic 不含 /v1；custom 为空串（用户自填）。
   */
  baseUrl: string;
  suggestedModels: string[];
  /** 该厂商 Key 的通用环境变量名（提示用；local/custom 为空串） */
  keyEnvHint: string;
  /** 本地服务（Ollama）：无需 API Key */
  local?: boolean;
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    labelZh: "OpenAI",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    suggestedModels: ["gpt-4o-mini", "gpt-4o", "o4-mini"],
    keyEnvHint: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    labelZh: "Anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    suggestedModels: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
    keyEnvHint: "ANTHROPIC_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    labelZh: "DeepSeek（深度求索）",
    type: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
    keyEnvHint: "DEEPSEEK_API_KEY",
  },
  {
    id: "zhipu",
    label: "Zhipu",
    labelZh: "智谱 AI（GLM）",
    type: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    suggestedModels: ["glm-4-flash", "glm-4-plus"],
    keyEnvHint: "ZHIPU_API_KEY",
  },
  {
    id: "qwen",
    label: "Qwen",
    labelZh: "通义千问（阿里云百炼）",
    type: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    suggestedModels: ["qwen-plus", "qwen-max"],
    keyEnvHint: "DASHSCOPE_API_KEY",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    labelZh: "Kimi（月之暗面）",
    type: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    suggestedModels: ["moonshot-v1-8k", "kimi-k2-0711-preview"],
    keyEnvHint: "MOONSHOT_API_KEY",
  },
  {
    id: "doubao",
    label: "Doubao",
    // 真实豆包（火山方舟）以「接入点 ID」调用而非模型名 —— labelZh 内置提示
    labelZh: "豆包（火山方舟）· 模型或接入点ID",
    type: "openai-compatible",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    suggestedModels: ["doubao-pro-32k"],
    keyEnvHint: "ARK_API_KEY",
  },
  {
    id: "ollama",
    label: "Ollama",
    labelZh: "Ollama（本地运行，无需 Key）",
    type: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    suggestedModels: ["llama3.1", "qwen2.5"],
    keyEnvHint: "",
    local: true,
  },
  {
    id: "custom",
    label: "Custom",
    labelZh: "自定义 OpenAI 兼容服务",
    type: "openai-compatible",
    baseUrl: "",
    suggestedModels: [],
    keyEnvHint: "",
  },
];

/** 目录 id → Key 环境变量提示（local/custom 无 Key → 不含） */
export function catalogKeyEnvHints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of PROVIDER_CATALOG) {
    if (entry.keyEnvHint.length > 0) out[entry.id] = entry.keyEnvHint;
  }
  return out;
}
