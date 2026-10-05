// catalog 装载 + zod 校验测试（Issue #23 最小用例 + Issue #25 全量校验）。
import { describe, expect, it } from "bun:test";
import catalogJson from "./catalog.json";
import { CatalogValidationError, validateCatalog } from "./catalog-schema";
import { getDescriptor, loadCatalog } from "./index";
import type { ProviderDescriptor } from "./types";

const FIRST_BATCH = ["openai", "deepseek", "zhipu", "qwen", "moonshot", "doubao", "minimax", "siliconflow"];
const SECOND_BATCH = [
  "anthropic", "hunyuan", "yi", "ernie", "spark", "xai", "mistral", "openrouter",
  "groq", "together", "cohere", "perplexity", "google", "azure-openai", "ollama", "lmstudio",
];

describe("loadCatalog", () => {
  it("能解析 catalog.json（ Issue #23 最小验收）", () => {
    const catalog = loadCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(1);
    expect(catalog[0].id).toBe("openai");
  });

  it("返回 24 家真实供应商 + 1 条 custom 模板（Issue #25 验收）", () => {
    const catalog = loadCatalog();
    expect(catalog.length).toBe(25);
    const real = catalog.filter((d) => d.id !== "custom");
    expect(real.length).toBe(24);
  });

  it("首批 8 家全部在册（Issue #24）", () => {
    const ids = new Set(loadCatalog().map((d) => d.id));
    for (const id of FIRST_BATCH) expect(ids.has(id)).toBe(true);
  });

  it("第二批 16 家全部在册（Issue #25）", () => {
    const ids = new Set(loadCatalog().map((d) => d.id));
    for (const id of SECOND_BATCH) expect(ids.has(id)).toBe(true);
  });

  it("重复调用返回缓存实例（零重解析）", () => {
    expect(loadCatalog()).toBe(loadCatalog());
  });

  it("getDescriptor 按 id 查询", () => {
    expect(getDescriptor("zhipu")?.nameZh).toBe("智谱 GLM");
    expect(getDescriptor("nonexistent")).toBeUndefined();
  });
});

describe("catalog 数据规则", () => {
  it("id 全局唯一且为 kebab-case", () => {
    const ids = loadCatalog().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("ollama / lmstudio 标记 local: true 且不强制 keyUrl", () => {
    for (const id of ["ollama", "lmstudio"]) {
      const desc = getDescriptor(id);
      expect(desc?.local).toBe(true);
      expect(desc?.keyUrl).toBeUndefined();
    }
  });

  it("非 local 家全部带 keyUrl（设置界面直跳控制台）", () => {
    for (const desc of loadCatalog()) {
      if (desc.local === true || desc.type === "custom") continue;
      expect(desc.keyUrl).toBeDefined();
    }
  });

  it("google / azure-openai 类型与 baseUrl 形态正确", () => {
    const google = getDescriptor("google");
    expect(google?.type).toBe("google");
    expect(google?.baseUrl).toBe("https://generativelanguage.googleapis.com");
    const azure = getDescriptor("azure-openai");
    expect(azure?.type).toBe("azure-openai");
    expect(azure?.baseUrl).toContain("openai.azure.com");
  });

  it("custom 条目：baseUrl 为空（用户必填）", () => {
    const custom = getDescriptor("custom");
    expect(custom?.type).toBe("custom");
    expect(custom?.baseUrl).toBe("");
  });

  it("每家至少一个模型，模型 id 唯一", () => {
    for (const desc of loadCatalog()) {
      expect(desc.models.length).toBeGreaterThanOrEqual(1);
      const ids = desc.models.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("validateCatalog 负例", () => {
  const validEntry = (): ProviderDescriptor => ({
    id: "probe",
    type: "openai-compatible",
    name: "Probe",
    nameZh: "探针",
    baseUrl: "https://api.probe.example/v1",
    keyUrl: "https://probe.example/keys",
    models: [{ id: "probe-1", label: "Probe 1", tools: true, vision: false }],
  });

  const expectViolations = (input: unknown, ...fragments: string[]): void => {
    let thrown: unknown;
    try {
      validateCatalog(input);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CatalogValidationError);
    const msg = (thrown as CatalogValidationError).message;
    for (const fragment of fragments) expect(msg).toContain(fragment);
  };

  it("根不是数组 → 报错", () => {
    expectViolations({ not: "array" }, "must be a JSON array");
  });

  it("id 重复 → 报错", () => {
    const a = validEntry();
    const b = { ...validEntry(), id: "probe" };
    expectViolations([a, b], 'duplicate id "probe"');
  });

  it("id 非 kebab → 报错", () => {
    expectViolations([{ ...validEntry(), id: "Bad_ID" }], "kebab-case");
  });

  it("未知 type → 报错", () => {
    expectViolations([{ ...validEntry(), type: "quantum" as never }], "type");
  });

  it("baseUrl 非 http(s) → 报错（custom 除外）", () => {
    expectViolations([{ ...validEntry(), baseUrl: "ftp://x.example" }], "http:// or https://");
  });

  it("custom 允许空 baseUrl，但其它家不行", () => {
    expect(() => validateCatalog([{ ...validEntry(), type: "custom", baseUrl: "" }])).not.toThrow();
    expectViolations([{ ...validEntry(), baseUrl: "" }], "http:// or https://");
  });

  it("非 local 家缺 keyUrl → 报错", () => {
    const { keyUrl: _drop, ...withoutKey } = validEntry();
    expectViolations([withoutKey], "keyUrl");
  });

  it("local 家缺 keyUrl 放行", () => {
    const { keyUrl: _drop, ...withoutKey } = validEntry();
    expect(() => validateCatalog([{ ...withoutKey, local: true }])).not.toThrow();
  });

  it("models 为空 → 报错", () => {
    expectViolations([{ ...validEntry(), models: [] }], "at least one model");
  });

  it("模型重复 id → 报错", () => {
    const entry = validEntry();
    entry.models.push({ ...entry.models[0] });
    expectViolations([entry], 'duplicate model id');
  });

  it("catalog.json 全量过校验（loadCatalog 内嵌）", () => {
    expect(() => validateCatalog(catalogJson)).not.toThrow();
  });
});
