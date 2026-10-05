// @videoos/model-hub — 供应商目录（catalog）+ 工厂 + 连通性诊断（SPEC §2）。
// 消费方：CLI / 桌面应用的「选择模型供应商」界面与设置面板。
import catalogJson from "./catalog.json";
import { validateCatalog } from "./catalog-schema";
import { createProviderFromDescriptor } from "./factory";
import { testConnection } from "./diagnostics";
import type { TestConnectionOptions } from "./diagnostics";
import type { ConnectionReport, ProviderCreds, ProviderDescriptor } from "./types";

export { CatalogValidationError, validateCatalog } from "./catalog-schema";
export { createProviderFromDescriptor } from "./factory";
export { GoogleProvider, toGeminiContents, toGeminiTools } from "./providers/google";
export type { GoogleOptions } from "./providers/google";
export { AzureOpenAIProvider, AZURE_API_VERSION } from "./providers/azure-openai";
export type { AzureOpenAIOptions } from "./providers/azure-openai";
export { testConnection } from "./diagnostics";
export type { TestConnectionOptions } from "./diagnostics";
export type {
  CatalogModel,
  ConnectionReport,
  DescriptorType,
  ProviderCreds,
  ProviderDescriptor,
} from "./types";

let cachedCatalog: ProviderDescriptor[] | undefined;

/** 装载目录（catalog.json → ProviderDescriptor[]；随 import 缓存，重复调用零开销） */
export function loadCatalog(): ProviderDescriptor[] {
  if (cachedCatalog === undefined) {
    cachedCatalog = validateCatalog(catalogJson);
  }
  return cachedCatalog;
}

/** 按 id 查目录条目 */
export function getDescriptor(id: string): ProviderDescriptor | undefined {
  return loadCatalog().find((d) => d.id === id);
}
