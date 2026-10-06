// Provider 设置服务（issue #46/#47）：CRUD + Key 掩码 + Agent 装配桥 + 连通性测试。
// 分层约定：app.ts 路由薄壳 → 本模块业务；SettingsStore 管 settings.json（entries，永不含 Key），
// SecureStore 管 settings.secure.json（Key）。错误码：PROVIDER_EXISTS / PROVIDER_NOT_FOUND /
// PROVIDER_TEST_INVALID / SETTINGS_INVALID（zod 校验）—— 中文 hint 前端原样展示。
import {
  AnthropicProvider,
  ManualProvider,
  OpenAICompatibleProvider,
  ProviderError,
  createProvider,
  createProvidersFromEnv,
  normalizeBaseUrl,
  providerKeyEnvName,
  type ModelProvider,
} from "@videoos/agent";
import { z, type ZodType } from "zod";
import { ServerError } from "../errors";
import { PROVIDER_CATALOG, catalogKeyEnvHints, type CatalogEntry } from "./catalog";
import {
  ProviderEntryCreateSchema,
  ProviderEntryPatchSchema,
  ProviderEntrySchema,
  PROVIDER_SAMPLING_KEYS,
  type ProviderEntry,
  type ProviderEntryPatch,
  type ProviderSamplingKey,
  type SettingsValues,
} from "./schema";
import type { SecureStore } from "./secure";
import { issuesToMessage, type SettingsStore } from "./store";

// ---------------------------------------------------------------- 公共类型

/** GET /api/providers 响应 */
export interface ProviderListResult {
  catalog: CatalogEntry[];
  entries: Array<ProviderEntry & { keyMask: string | null }>;
  defaultProvider: string | null;
  defaultModel: string | null;
  keyEnvHints: Record<string, string>;
}

export type ProviderSource = "settings" | "env" | "none";

/** POST /api/providers/test 响应（issue #47） */
export interface ProviderTestResult {
  ok: boolean;
  latencyMs: number;
  error?: { code: string; message: string };
  /** 中文修复提示 / PROTOCOL_ERROR 时为响应体摘录（≤200 字符）；前端原样展示 */
  hint?: string;
  models?: string[];
}

export interface TestConnectionOptions {
  /** chat 探测超时毫秒（默认 15_000；测试注入用） */
  timeoutMs?: number;
  /** models 列表超时毫秒（默认 5_000；测试注入用） */
  modelsTimeoutMs?: number;
}

// ---------------------------------------------------------------- 内部常量

const DEFAULT_TEST_TIMEOUT_MS = 15_000;
const DEFAULT_MODELS_TIMEOUT_MS = 5_000;

/** 连通性错误 → 中文修复提示（issue #47 规格原文；PROTOCOL_ERROR 的 hint 是响应体摘录） */
const TEST_HINTS = {
  NETWORK_UNREACHABLE: "无法连接到服务地址，请检查 baseUrl 与网络/代理",
  TIMEOUT: "请求超时，服务无响应",
  AUTH_REJECTED: "API Key 无效或无权限",
  ENDPOINT_OR_MODEL_NOT_FOUND: "端点或模型不存在，请检查 baseUrl 是否包含 /v1 与模型名",
  RATE_LIMITED: "触发限流，请稍后重试",
  PROTOCOL_FALLBACK: "服务返回了异常响应",
} as const;

// ---------------------------------------------------------------- zod 校验助手 / 请求体 schema

function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ServerError("SETTINGS_INVALID", issuesToMessage(result.error.issues));
  }
  return result.data;
}

const ProviderCreateBodySchema = z
  .object({
    entry: ProviderEntryCreateSchema,
    /** 可选；空串 = 不存 Key */
    apiKey: z.string().optional(),
  })
  .strict();

const ProviderUpdateBodySchema = z
  .object({
    /** 局部条目（与现存条目字段级合并；缺省 = 仅改 Key） */
    entry: ProviderEntryPatchSchema.optional(),
    /** 缺省/空串 = 保持现 Key；显式 null = 删除 Key；非空 = 替换 */
    apiKey: z.string().nullable().optional(),
  })
  .strict();

const ProviderTestBodySchema = z.object({
  /** 已存条目 id（用存储条目 + 存储 Key 测试） */
  id: z.string().min(1).optional(),
  /** 临时条目（不保存直接测）；entry 与 id 同时提供时以 entry 为准 */
  entry: ProviderEntrySchema.optional(),
  /** Key 覆盖（缺省回退存储 Key / env） */
  apiKey: z.string().optional(),
});

// ---------------------------------------------------------------- Key 掩码 / 归一化

/** keyMask：首 3 + *** + 末 4（≤8 字符的短 Key 只显示 ***，避免整 Key 泄露） */
export function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 3)}***${key.slice(-4)}` : "***";
}

function keyMaskFor(secure: SecureStore, id: string): string | null {
  const key = secure.get(id) ?? process.env[providerKeyEnvName(id)];
  return key === undefined ? null : maskKey(key);
}

/** 读取归一化：enabled/tools 缺省补 true（存储形状允许缺省，API 层面始终显式） */
function normalizeEntry(entry: ProviderEntry): ProviderEntry {
  return { ...entry, enabled: entry.enabled ?? true, tools: entry.tools ?? true };
}

/** 采样参数 null 清除：patch 中显式 null 的采样键从合并结果里删掉（回退适配器默认，不落 settings.json） */
function stripSamplingNulls<T extends Record<string, unknown>>(merged: T, patch: ProviderEntryPatch): T {
  const next = { ...merged } as T & Partial<Record<ProviderSamplingKey, unknown>>;
  for (const key of PROVIDER_SAMPLING_KEYS) {
    if (patch[key] === null) delete next[key];
  }
  return next;
}

// ---------------------------------------------------------------- slug 生成（创建时 id 缺省）

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const valid = base.length > 0 && /^[a-z0-9][a-z0-9-]*$/.test(base) ? base : "provider";
  if (!taken.has(valid)) return valid;
  for (let n = 2; ; n++) {
    const candidate = `${valid}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------- CRUD（issue #46）

export function listProviders(settings: SettingsStore, secure: SecureStore): ProviderListResult {
  const values = settings.get();
  return {
    catalog: PROVIDER_CATALOG,
    entries: values.providers.entries.map((entry) => ({ ...normalizeEntry(entry), keyMask: keyMaskFor(secure, entry.id) })),
    defaultProvider: values.providers.defaultProvider,
    defaultModel: values.providers.defaultModel,
    keyEnvHints: catalogKeyEnvHints(),
  };
}

export function createProviderEntry(
  settings: SettingsStore,
  secure: SecureStore,
  body: unknown,
): { entry: ProviderEntry; keyMask: string | null } {
  const parsed = parseOrThrow(ProviderCreateBodySchema, body);
  const current = settings.get().providers;
  const taken = new Set(current.entries.map((e) => e.id));
  const id = parsed.entry.id !== undefined ? parsed.entry.id : uniqueSlug(slugify(parsed.entry.label ?? parsed.entry.type), taken);
  if (taken.has(id)) {
    throw new ServerError("PROVIDER_EXISTS", `provider "${id}" already exists（id 重复，换一个 id 或省略由服务端生成）`, 400);
  }
  // 归一化 enabled/tools 为显式值，再整体校验（含 baseUrl refine）
  const entry = parseOrThrow(ProviderEntrySchema, normalizeEntry({ ...parsed.entry, id }));
  settings.update({ providers: { entries: [...current.entries, entry] } });
  if (parsed.apiKey !== undefined && parsed.apiKey.length > 0) secure.set(id, parsed.apiKey);
  return { entry, keyMask: keyMaskFor(secure, id) };
}

export function updateProviderEntry(
  settings: SettingsStore,
  secure: SecureStore,
  id: string,
  body: unknown,
): { entry: ProviderEntry; keyMask: string | null } {
  const parsed = parseOrThrow(ProviderUpdateBodySchema, body);
  const values = settings.get();
  const existing = values.providers.entries.find((e) => e.id === id);
  if (existing === undefined) {
    throw new ServerError("PROVIDER_NOT_FOUND", `provider "${id}" not found`, 404);
  }
  const entryPatch = parsed.entry ?? {};
  if (entryPatch.id !== undefined && entryPatch.id !== id) {
    throw new ServerError("SETTINGS_INVALID", `entry.id ${JSON.stringify(entryPatch.id)} does not match route id "${id}"（不支持改名，请删除后重建）`);
  }
  // 字段级合并 → 整体校验（改 type 携带的 baseUrl 约束等在此拦截）；采样参数 null = 清除（stripSamplingNulls）
  const merged = parseOrThrow(
    ProviderEntrySchema,
    stripSamplingNulls({ ...normalizeEntry(existing), ...entryPatch, id }, entryPatch),
  );
  settings.update({ providers: { entries: values.providers.entries.map((e) => (e.id === id ? merged : e)) } });
  if (parsed.apiKey === null) secure.delete(id);
  else if (typeof parsed.apiKey === "string" && parsed.apiKey.length > 0) secure.set(id, parsed.apiKey);
  return { entry: merged, keyMask: keyMaskFor(secure, id) };
}

export function deleteProviderEntry(settings: SettingsStore, secure: SecureStore, id: string): { ok: true } {
  const values = settings.get();
  if (!values.providers.entries.some((e) => e.id === id)) {
    throw new ServerError("PROVIDER_NOT_FOUND", `provider "${id}" not found`, 404);
  }
  const providers: {
    entries: ProviderEntry[];
    defaultProvider?: null;
    defaultModel?: null;
  } = { entries: values.providers.entries.filter((e) => e.id !== id) };
  // 默认供应商指向被删条目 → 成对清除 defaultProvider/defaultModel；defaultModel 形如 "<id>/<model>" 同样清除
  const wasDefault = values.providers.defaultProvider === id;
  const modelPointedHere =
    values.providers.defaultModel !== null &&
    (values.providers.defaultModel === id || values.providers.defaultModel.startsWith(`${id}/`));
  if (wasDefault) {
    providers.defaultProvider = null;
    providers.defaultModel = null;
  } else if (modelPointedHere) {
    providers.defaultModel = null;
  }
  settings.update({ providers });
  secure.delete(id);
  return { ok: true };
}

// ---------------------------------------------------------------- Agent 装配桥（settings 优先 → env 回退）

/** settings 配置的 enabled 条目 → ModelProvider[]（Key 解析：secure.json → env VIDEOOS_PROVIDER_<ID>_KEY） */
export function createProvidersFromSettings(values: SettingsValues, secure: SecureStore): ModelProvider[] {
  const enabled = values.providers.entries.filter((e) => e.enabled ?? true);
  const providers: ModelProvider[] = [];
  for (const entry of enabled) {
    try {
      providers.push(
        createProvider({
          id: entry.id,
          type: entry.type,
          baseUrl: entry.baseUrl,
          model: entry.model,
          ...(entry.vision !== undefined ? { vision: entry.vision } : {}),
          ...(entry.tools !== undefined ? { tools: entry.tools } : {}),
          // 采样参数与超时（v0.2 §5.2）：缺省 = 适配器默认；manual 构造时自动忽略
          ...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
          ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
          ...(entry.topP !== undefined ? { topP: entry.topP } : {}),
          ...(entry.timeoutMs !== undefined ? { timeoutMs: entry.timeoutMs } : {}),
          apiKey: secure.get(entry.id) ?? process.env[providerKeyEnvName(entry.id)],
        }),
      );
    } catch {
      // 防御：schema 校验过的条目理论上必然可构造；跳过坏条目不影响其余
    }
  }
  // defaultProvider 排最前（ModelRouter 无规则时 fallback 首个注册）
  const defaultId = values.providers.defaultProvider;
  if (defaultId !== null) {
    const index = providers.findIndex((p) => p.id === defaultId);
    if (index > 0) providers.unshift(providers.splice(index, 1)[0]);
  }
  return providers;
}

export function resolveAgentProviders(values: SettingsValues, secure: SecureStore): { providers: ModelProvider[]; source: ProviderSource } {
  const fromSettings = createProvidersFromSettings(values, secure);
  if (fromSettings.length > 0) return { providers: fromSettings, source: "settings" };
  try {
    const fromEnv = createProvidersFromEnv();
    if (fromEnv.length > 0) return { providers: fromEnv, source: "env" };
  } catch {
    // env 配置损坏 → 视为未配置（与 v0.1 agentConfig 探测行为一致）
  }
  return { providers: [], source: "none" };
}

// ---------------------------------------------------------------- 连通性测试（issue #47）

function truncateBody(text: string): string {
  return text.length > 200 ? text.slice(0, 200) : text;
}

interface TestFailure {
  code: string;
  message: string;
  hint?: string;
}

/** 适配器 ProviderError → 测试错误分类（issue #47 规格） */
function classifyProviderError(err: unknown): TestFailure {
  if (!(err instanceof ProviderError)) {
    return { code: "PROTOCOL_ERROR", message: err instanceof Error ? err.message : String(err), hint: TEST_HINTS.PROTOCOL_FALLBACK };
  }
  switch (err.code) {
    case "PROVIDER_REQUEST_FAILED": {
      // 适配器把 fetch 抛错统一包成 REQUEST_FAILED（含网络拒绝与 Abort 超时）—— 按消息关键词分拣
      const message = err.message;
      return isTimeoutMessage(message)
        ? { code: "TIMEOUT", message, hint: TEST_HINTS.TIMEOUT }
        : { code: "NETWORK_UNREACHABLE", message, hint: TEST_HINTS.NETWORK_UNREACHABLE };
    }
    case "PROVIDER_HTTP_ERROR": {
      const status = err.status ?? 0;
      if (status === 401 || status === 403) return { code: "AUTH_REJECTED", message: err.message, hint: TEST_HINTS.AUTH_REJECTED };
      if (status === 404) return { code: "ENDPOINT_OR_MODEL_NOT_FOUND", message: err.message, hint: TEST_HINTS.ENDPOINT_OR_MODEL_NOT_FOUND };
      if (status === 429) return { code: "RATE_LIMITED", message: err.message, hint: TEST_HINTS.RATE_LIMITED };
      const excerpt = truncateBody(err.body ?? "");
      return { code: "PROTOCOL_ERROR", message: err.message, hint: excerpt.length > 0 ? excerpt : TEST_HINTS.PROTOCOL_FALLBACK };
    }
    case "PROVIDER_BAD_RESPONSE":
    case "PROVIDER_API_ERROR": {
      const excerpt = truncateBody(err.body ?? "");
      return { code: "PROTOCOL_ERROR", message: err.message, hint: excerpt.length > 0 ? excerpt : TEST_HINTS.PROTOCOL_FALLBACK };
    }
    default:
      return { code: "PROTOCOL_ERROR", message: err.message, hint: TEST_HINTS.PROTOCOL_FALLBACK };
  }
}

/** fetch 抛错消息是否超时类（Bun: "The operation timed out."；Node: "…aborted due to timeout"） */
function isTimeoutMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out");
}

/** 最小 chat 探测用的 provider 构造（注入小超时；响应长度经 chat opts maxTokens 限制） */
function buildTestProvider(entry: ProviderEntry, apiKey: string | undefined, timeoutMs: number): ModelProvider {
  if (entry.type === "manual") {
    return new ManualProvider({ id: entry.id, model: entry.model, script: [] });
  }
  const shared = {
    id: entry.id,
    baseUrl: entry.baseUrl,
    model: entry.model,
    vision: false,
    tools: false,
    timeoutMs,
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
  return entry.type === "openai-compatible" ? new OpenAICompatibleProvider(shared) : new AnthropicProvider(shared);
}

/** best-effort 模型列表：openai-compatible GET {base}/models；anthropic GET {base}/v1/models；失败仅省略 models */
async function fetchModels(entry: ProviderEntry, apiKey: string | undefined, timeoutMs: number): Promise<string[] | undefined> {
  try {
    const base = normalizeBaseUrl(entry.baseUrl);
    const url = entry.type === "anthropic" ? `${base}/v1/models` : `${base}/models`;
    const headers: Record<string, string> =
      entry.type === "anthropic"
        ? { "x-api-key": apiKey ?? "", "anthropic-version": "2023-06-01" }
        : apiKey !== undefined && apiKey.length > 0
          ? { authorization: `Bearer ${apiKey}` }
          : {};
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const json = JSON.parse(await res.text()) as { data?: Array<{ id?: unknown }> };
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.sort();
  } catch {
    return undefined;
  }
}

export async function testProviderConnection(
  settings: SettingsStore,
  secure: SecureStore,
  body: unknown,
  opts: TestConnectionOptions = {},
): Promise<ProviderTestResult> {
  const parsed = parseOrThrow(ProviderTestBodySchema, body);
  if (parsed.entry === undefined && parsed.id === undefined) {
    throw new ServerError("PROVIDER_TEST_INVALID", "body must provide either { id }（已存条目）或 { entry }（临时条目）");
  }
  let entry: ProviderEntry;
  if (parsed.entry !== undefined) {
    entry = parsed.entry;
  } else {
    const stored = settings.get().providers.entries.find((e) => e.id === parsed.id);
    if (stored === undefined) {
      throw new ServerError("PROVIDER_NOT_FOUND", `provider "${parsed.id}" not found`, 404);
    }
    entry = stored;
  }
  const apiKey = parsed.apiKey ?? secure.get(entry.id) ?? process.env[providerKeyEnvName(entry.id)];

  // manual → 确定性成功，无需网络
  if (entry.type === "manual") return { ok: true, latencyMs: 0 };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  const modelsTimeoutMs = opts.modelsTimeoutMs ?? DEFAULT_MODELS_TIMEOUT_MS;
  const started = Date.now();
  try {
    const provider = buildTestProvider(entry, apiKey, timeoutMs);
    await provider.chat([{ role: "user", content: "ping" }], { maxTokens: 16 });
  } catch (err) {
    const failure = classifyProviderError(err);
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: { code: failure.code, message: failure.message },
      ...(failure.hint !== undefined ? { hint: failure.hint } : {}),
    };
  }
  const latencyMs = Date.now() - started;
  const models = await fetchModels(entry, apiKey, modelsTimeoutMs);
  return { ok: true, latencyMs, ...(models !== undefined ? { models } : {}) };
}
