// catalog.json 的 zod 结构校验（SPEC §2.7）：id 唯一/kebab、baseUrl 合法（custom 允许空）、
// local 家不强制 keyUrl（非 local 家要求 keyUrl，方便设置界面直接跳转控制台）。
import { z } from "zod";
import type { ProviderDescriptor } from "./types";

const modelSchema = z.object({
  id: z.string().min(1, "model id must be a non-empty string"),
  label: z.string().min(1, "model label must be a non-empty string"),
  contextK: z.number().int().positive().optional(),
  tools: z.boolean(),
  vision: z.boolean(),
  tags: z.array(z.string().min(1)).optional(),
  pricingHint: z.string().optional(),
});

const descriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab-case (e.g. \"deepseek\")"),
  type: z.enum(["openai-compatible", "anthropic", "google", "azure-openai", "custom"]),
  name: z.string().min(1),
  nameZh: z.string().min(1),
  baseUrl: z.string(),
  keyUrl: z.string().url().optional(),
  docsUrl: z.string().url().optional(),
  local: z.boolean().optional(),
  models: z.array(modelSchema).min(1, "catalog entry must list at least one model"),
  notes: z.string().optional(),
});

/** baseUrl 规则：custom 允许空串（用户必填）；其余必须 http(s) 开头（azure 占位符含 <resource> 也满足前缀规则） */
function baseUrlRule(desc: { type: string; baseUrl: string; local?: boolean }): string | null {
  if (desc.type === "custom") return null;
  if (!/^https?:\/\//.test(desc.baseUrl)) {
    return `baseUrl must start with http:// or https:// (got ${JSON.stringify(desc.baseUrl)})`;
  }
  return null;
}

/** keyUrl 规则：custom/local 不强制；云端家必须有（设置界面跳转控制台） */
function keyUrlRule(desc: { type: string; local?: boolean; keyUrl?: string }): string | null {
  if (desc.type === "custom" || desc.local === true) return null;
  if (desc.keyUrl === undefined) return "non-local providers must set keyUrl (console URL for API keys)";
  return null;
}

export class CatalogValidationError extends Error {
  readonly violations: string[];
  constructor(violations: string[]) {
    super(`catalog validation failed (${violations.length} violation(s)):\n  - ${violations.join("\n  - ")}`);
    this.name = "CatalogValidationError";
    this.violations = violations;
  }
}

/**
 * 校验目录数据：逐条 schema 校验 + id 唯一性 + baseUrl/keyUrl 规则。
 * 任何违规抛 CatalogValidationError（violation 数组逐条列出，含条目索引与字段路径）。
 */
export function validateCatalog(input: unknown): ProviderDescriptor[] {
  if (!Array.isArray(input)) {
    throw new CatalogValidationError(["catalog root must be a JSON array of provider descriptors"]);
  }
  const violations: string[] = [];
  const seen = new Set<string>();
  const descriptors: ProviderDescriptor[] = [];

  input.forEach((entry, index) => {
    const at = `catalog[${index}]`;
    const parsed = descriptorSchema.safeParse(entry);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push(`${at}.${issue.path.join(".") || "<root>"}: ${issue.message}`);
      }
      return;
    }
    const desc = parsed.data as ProviderDescriptor;
    if (seen.has(desc.id)) violations.push(`${at}.id: duplicate id "${desc.id}"`);
    seen.add(desc.id);
    const base = baseUrlRule(desc);
    if (base !== null) violations.push(`${at}.baseUrl: ${base}`);
    const key = keyUrlRule(desc);
    if (key !== null) violations.push(`${at}.keyUrl: ${key}`);
    const modelIds = new Set<string>();
    desc.models.forEach((m, mi) => {
      if (modelIds.has(m.id)) violations.push(`${at}.models[${mi}].id: duplicate model id "${m.id}"`);
      modelIds.add(m.id);
    });
    descriptors.push(desc);
  });

  if (violations.length > 0) throw new CatalogValidationError(violations);
  return descriptors;
}
