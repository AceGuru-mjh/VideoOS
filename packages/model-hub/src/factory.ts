// 工厂（SPEC §2.3）：ProviderDescriptor + ProviderCreds → ModelProvider。
// openai-compatible / custom 复用 @videoos/agent OpenAICompatibleProvider；anthropic 复用 AnthropicProvider；
// google / azure-openai 用本包原生适配器。目录未知 type → HUB_UNKNOWN_TYPE。
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
  ProviderError,
  providerKeyEnvName,
} from "@videoos/agent";
import type { ModelProvider } from "@videoos/agent";
import type { ProviderCreds, ProviderDescriptor } from "./types";
import { AzureOpenAIProvider } from "./providers/azure-openai";
import { GoogleProvider } from "./providers/google";

/** 从目录条目解析选型：模型名 + capabilities（缺省取 models[0]，找不到条目时按保守值） */
function resolveModel(desc: ProviderDescriptor, creds: ProviderCreds): {
  model: string;
  vision: boolean;
  tools: boolean;
} {
  const model = creds.model ?? desc.models[0]?.id;
  if (model === undefined || model.length === 0) {
    throw new ProviderError("HUB_NO_MODELS", `provider "${desc.id}" has no models in catalog`);
  }
  const entry = desc.models.find((m) => m.id === model);
  return { model, vision: entry?.vision ?? false, tools: entry?.tools ?? true };
}

export function createProviderFromDescriptor(
  desc: ProviderDescriptor,
  creds: ProviderCreds = {},
): ModelProvider {
  const { model, vision, tools } = resolveModel(desc, creds);
  const baseUrl = creds.baseUrl ?? desc.baseUrl;
  const apiKeyEnv = providerKeyEnvName(desc.id);

  switch (desc.type) {
    case "openai-compatible":
    case "custom": {
      if (baseUrl.length === 0) {
        throw new ProviderError(
          "HUB_MISSING_BASE_URL",
          `provider "${desc.id}" (type "${desc.type}") requires a non-empty baseUrl — set creds.baseUrl (custom endpoints must be filled in settings)`,
        );
      }
      return new OpenAICompatibleProvider({
        id: desc.id,
        baseUrl,
        apiKey: creds.apiKey,
        apiKeyEnv,
        model,
        vision,
        tools,
        timeoutMs: creds.timeoutMs,
      });
    }
    case "anthropic":
      return new AnthropicProvider({
        id: desc.id,
        baseUrl,
        apiKey: creds.apiKey,
        apiKeyEnv,
        model,
        vision,
        tools,
        timeoutMs: creds.timeoutMs,
      });
    case "google":
      return new GoogleProvider({
        id: desc.id,
        baseUrl,
        apiKey: creds.apiKey,
        apiKeyEnv,
        model,
        vision,
        tools,
        timeoutMs: creds.timeoutMs,
      });
    case "azure-openai":
      return new AzureOpenAIProvider({
        id: desc.id,
        baseUrl,
        apiKey: creds.apiKey,
        apiKeyEnv,
        model,
        vision,
        tools,
        timeoutMs: creds.timeoutMs,
      });
    default:
      throw new ProviderError(
        "HUB_UNKNOWN_TYPE",
        `unknown descriptor type "${(desc as { type: string }).type}" for provider "${desc.id}"`,
      );
  }
}
