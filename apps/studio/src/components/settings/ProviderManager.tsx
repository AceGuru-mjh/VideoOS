// ProviderManager (S6 extraction, v0.2 §5 issue #57): the provider CRUD body
// shared by wizard step 2 (components/wizard/ModelStep.tsx) and the settings
// center 模型与供应商 page. Contains everything ModelStep owned — Section A
// vendor catalog, Section B configuration form (key reveal / model combobox /
// pull list / inline test panel), Section C configured entries (default radio /
// enable toggle / row test / delete), the delete-confirm modal and the
// demo-mode + enter-main actions — exposed to the wizard footer through a
// render-prop. All state is local; only entries/defaults refresh after every
// mutation. Zero-regression refactor: the wizard keeps its exact DOM.
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  createProvider,
  deleteProvider,
  errorMessage,
  getProviders,
  patchSettings,
  testProvider,
  updateProvider,
  type CatalogEntry,
  type ProviderEntryInput,
  type ProviderEntryPatch,
  type ProviderEntryWithMask,
  type ProvidersSnapshot,
  type TestResult,
} from "../../api";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import type { TranslateFn } from "../../i18n/format";
import { Button, ErrorText, Modal, Spinner } from "../ui";

// Built-in catalog used when the server endpoint is unavailable (old server) —
// same shape the server-side catalog serves; display + prefill only.
const FALLBACK_CATALOG: CatalogEntry[] = [
  { id: "openai", label: "OpenAI", labelZh: "OpenAI", type: "openai-compatible", baseUrl: "https://api.openai.com/v1", suggestedModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini"], keyEnvHint: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", labelZh: "Anthropic", type: "anthropic", baseUrl: "https://api.anthropic.com", suggestedModels: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"], keyEnvHint: "ANTHROPIC_API_KEY" },
  { id: "deepseek", label: "DeepSeek", labelZh: "DeepSeek", type: "openai-compatible", baseUrl: "https://api.deepseek.com", suggestedModels: ["deepseek-chat", "deepseek-reasoner"], keyEnvHint: "DEEPSEEK_API_KEY" },
  { id: "zhipu", label: "Zhipu GLM", labelZh: "智谱 GLM", type: "openai-compatible", baseUrl: "https://open.bigmodel.cn/api/paas/v4", suggestedModels: ["glm-4-plus", "glm-4-flash"], keyEnvHint: "ZHIPU_API_KEY" },
  { id: "qwen", label: "Qwen", labelZh: "通义千问", type: "openai-compatible", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", suggestedModels: ["qwen-max", "qwen-plus", "qwen-turbo"], keyEnvHint: "DASHSCOPE_API_KEY" },
  { id: "moonshot", label: "Moonshot", labelZh: "月之暗面 Kimi", type: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1", suggestedModels: ["kimi-k2-0711-preview", "moonshot-v1-8k", "moonshot-v1-32k"], keyEnvHint: "MOONSHOT_API_KEY" },
  { id: "doubao", label: "Doubao", labelZh: "豆包", type: "openai-compatible", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", suggestedModels: ["doubao-1.5-pro-32k", "doubao-pro-32k"], keyEnvHint: "ARK_API_KEY" },
  { id: "ollama", label: "Ollama", labelZh: "Ollama 本地", type: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", suggestedModels: ["qwen2.5:7b", "llama3.1:8b"], keyEnvHint: "", local: true },
  { id: "custom", label: "Custom", labelZh: "自定义", type: "openai-compatible", baseUrl: "", suggestedModels: [], keyEnvHint: "" },
];

const EMPTY_SNAPSHOT: ProvidersSnapshot = {
  catalog: FALLBACK_CATALOG,
  entries: [],
  defaultProvider: null,
  defaultModel: null,
  keyEnvHints: {},
};

/** Defensive shaping of a server payload (the backend may drift mid-S2). */
function normalizeSnapshot(raw: ProvidersSnapshot): ProvidersSnapshot {
  const catalog = (Array.isArray(raw.catalog) ? raw.catalog : [])
    .filter((c) => c !== null && typeof c === "object" && typeof c.id === "string")
    .map((c) => ({
      ...c,
      label: typeof c.label === "string" && c.label.length > 0 ? c.label : c.id,
      labelZh: typeof c.labelZh === "string" && c.labelZh.length > 0 ? c.labelZh : typeof c.label === "string" && c.label.length > 0 ? c.label : c.id,
      baseUrl: typeof c.baseUrl === "string" ? c.baseUrl : "",
      suggestedModels: Array.isArray(c.suggestedModels) ? c.suggestedModels.filter((m) => typeof m === "string") : [],
      keyEnvHint: typeof c.keyEnvHint === "string" ? c.keyEnvHint : "",
    }));
  const entries = (Array.isArray(raw.entries) ? raw.entries : [])
    .filter((e) => e !== null && typeof e === "object" && typeof e.id === "string")
    .map((e) => ({ ...e, enabled: e.enabled !== false, keyMask: typeof e.keyMask === "string" ? e.keyMask : null }));
  return {
    catalog: catalog.length > 0 ? catalog : FALLBACK_CATALOG,
    entries,
    defaultProvider: typeof raw.defaultProvider === "string" ? raw.defaultProvider : null,
    defaultModel: typeof raw.defaultModel === "string" ? raw.defaultModel : null,
    keyEnvHints: raw.keyEnvHints !== null && typeof raw.keyEnvHints === "object" ? raw.keyEnvHints : {},
  };
}

/** PROVIDER_EXISTS gets a wizard/settings-specific hint; anything else passes
 *  through raw (the render path localizes known codes via useApiErrorMessage). */
function prettySaveError(msg: string, t: TranslateFn): string {
  if (msg.startsWith("PROVIDER_EXISTS")) return t("modelStep.errProviderExists");
  return msg;
}

function syntheticError(err: unknown, t: TranslateFn): TestResult {
  const msg = errorMessage(err);
  return { ok: false, latencyMs: 0, error: { code: "REQUEST_FAILED", message: msg }, hint: t("modelStep.requestFailed", { msg }) };
}

// ---- 高级参数（v0.2 §5.2 采样参数/超时）：全部可选，留空 = 服务端适配器默认 ----

type SamplingKey = "temperature" | "maxTokens" | "topP" | "timeoutMs";

/** 表单态（字符串；空串 = 未填写） */
interface SamplingInput {
  temperature: string;
  maxTokens: string;
  topP: string;
  timeoutMs: string;
}

const EMPTY_SAMPLING: SamplingInput = { temperature: "", maxTokens: "", topP: "", timeoutMs: "" };

/** 字段表：标签/提示/占位/范围（与服务端 ProviderEntrySchema 对齐；maxTokens 无上限） */
const SAMPLING_FIELDS: Array<{
  key: SamplingKey;
  label: string;
  hint: string;
  placeholder: string;
  min?: number;
  max?: number;
  integer: boolean;
}> = [
  { key: "temperature", label: "温度 temperature", hint: "0-2，如 0.7；留空用端点默认", placeholder: "0.7", min: 0, max: 2, integer: false },
  { key: "maxTokens", label: "最大输出 token 数", hint: "≥1 整数，如 2048；留空用端点默认", placeholder: "2048", min: 1, integer: true },
  { key: "topP", label: "核采样 top_p", hint: "0-1，如 0.9；留空用端点默认", placeholder: "1.0", min: 0, max: 1, integer: false },
  { key: "timeoutMs", label: "请求超时（毫秒）", hint: "1000-600000，如 120000；留空用默认 120000", placeholder: "120000", min: 1000, max: 600_000, integer: true },
];

/** 表单字符串 → 采样参数（仅含已填字段）；非空但非法 → 中文错误 */
/** 采样参数校验：错误经 t() 即时翻译（非 modelStep.* 前缀 → formatFormError 原样展示） */
function parseSamplingInput(
  input: SamplingInput,
  t: (key: string, params?: Record<string, string | number>) => string,
): { error: string } | { values: Partial<Record<SamplingKey, number>> } {
  const values: Partial<Record<SamplingKey, number>> = {};
  for (const field of SAMPLING_FIELDS) {
    const raw = input[field.key].trim();
    if (raw.length === 0) continue;
    const num = Number(raw);
    if (!Number.isFinite(num)) return { error: t("modelStep.errSamplingNumber", { label: field.label, value: raw }) };
    if (field.integer && !Number.isInteger(num)) return { error: t("modelStep.errSamplingInteger", { label: field.label, value: raw }) };
    if (field.min !== undefined && num < field.min) return { error: t("modelStep.errSamplingMin", { label: field.label, min: field.min, value: raw }) };
    if (field.max !== undefined && num > field.max) return { error: t("modelStep.errSamplingMax", { label: field.label, max: field.max, value: raw }) };
    values[field.key] = num;
  }
  return { values };
}

interface RowTest {
  loading: boolean;
  result: TestResult | null;
}

/** Everything the wizard footer needs to keep its flow semantics. */
export interface ProviderManagerFooterCtx {
  hasEnabledEntry: boolean;
  apiAbsent: boolean;
  demoBusy: boolean;
  finishing: boolean;
  onDemo: () => void;
  onFinish: () => void;
}

export interface ProviderManagerProps {
  /** wrapper class for the body column (wizard: "wizard-body model-body") */
  bodyClassName?: string;
  /** form field id prefix — keeps DOM ids unique per mount (wizard: "wiz") */
  idPrefix?: string;
  /** wizard flow exit (进入主界面 / 演示模式跳过 both land here); settings omits it */
  onFinish?: () => void;
  /** wizard-only footer (上一步 / 演示模式 / 进入主界面); settings renders none */
  footer?: (ctx: ProviderManagerFooterCtx) => ReactNode;
}

export function ProviderManager({ bodyClassName, idPrefix = "wiz", onFinish, footer }: ProviderManagerProps): JSX.Element {
  const { locale, t } = useI18n();
  const errText = useApiErrorMessage();

  // ---- server data ------------------------------------------------------
  const [snap, setSnap] = useState<ProvidersSnapshot>(EMPTY_SNAPSHOT);
  const [apiAbsent, setApiAbsent] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // ---- selection + form (Section B) --------------------------------------
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formKey, setFormKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [formModel, setFormModel] = useState("");
  // ---- 高级参数（默认折叠；空串 = 使用服务端默认） ----
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState<SamplingInput>(EMPTY_SAMPLING);
  const [models, setModels] = useState<string[]>([]);
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboHi, setComboHi] = useState(0);
  const [savedMask, setSavedMask] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // ---- async guards ------------------------------------------------------
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [defaultBusy, setDefaultBusy] = useState<string | null>(null);

  // ---- feedback -----------------------------------------------------------
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [rowTests, setRowTests] = useState<Record<string, RowTest>>({});

  const comboFiltered = useMemo(
    () => {
      const q = formModel.trim().toLowerCase();
      if (q.length === 0) return models;
      return models.filter((m) => m.toLowerCase().includes(q));
    },
    [models, formModel],
  );

  useEffect(() => {
    let alive = true;
    getProviders()
      .then((raw) => {
        if (!alive) return;
        if (raw === null) setApiAbsent(true);
        else setSnap(normalizeSnapshot(raw));
      })
      .finally(() => {
        if (alive) setInitializing(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = async (): Promise<void> => {
    const raw = await getProviders();
    if (raw === null) {
      setApiAbsent(true);
      return;
    }
    setApiAbsent(false);
    setSnap(normalizeSnapshot(raw));
  };

  // ---- selection ----------------------------------------------------------
  const applySelection = (cat: CatalogEntry, entry: ProviderEntryWithMask | null): void => {
    setSelected(cat);
    setEditingEntryId(entry !== null ? entry.id : null);
    setFormLabel(entry?.label ?? "");
    setFormBaseUrl(entry !== null && entry.baseUrl.length > 0 ? entry.baseUrl : cat.baseUrl);
    setFormModel(entry?.model ?? "");
    setFormKey("");
    setShowKey(false);
    // 高级参数回填：已存值 → 字符串，缺省 → 空（空 = 不发送/清除）
    setAdv({
      temperature: entry?.temperature !== undefined ? String(entry.temperature) : "",
      maxTokens: entry?.maxTokens !== undefined ? String(entry.maxTokens) : "",
      topP: entry?.topP !== undefined ? String(entry.topP) : "",
      timeoutMs: entry?.timeoutMs !== undefined ? String(entry.timeoutMs) : "",
    });
    setModels(cat.suggestedModels);
    setFetchedCount(null);
    setComboOpen(false);
    setComboHi(0);
    setSavedMask(entry?.keyMask ?? null);
    setJustSaved(false);
    setTestResult(null);
    setFormError(null);
  };

  const openVendor = (cat: CatalogEntry): void => {
    applySelection(cat, snap.entries.find((e) => e.id === cat.id) ?? null);
  };

  const openEntry = (entry: ProviderEntryWithMask): void => {
    const cat = snap.catalog.find((c) => c.id === entry.id);
    if (cat !== undefined) {
      applySelection(cat, entry);
      return;
    }
    // entry without a matching preset (e.g. server-generated custom id) —
    // synthesize a pseudo-catalog entry so the form still prefills correctly
    applySelection(
      { id: entry.id, label: entry.label ?? entry.id, labelZh: entry.label ?? entry.id, type: entry.type, baseUrl: entry.baseUrl, suggestedModels: entry.model.length > 0 ? [entry.model] : [], keyEnvHint: "" },
      entry,
    );
  };

  // ---- form helpers -------------------------------------------------------
  /** 解析高级参数；非法时返回 null（调用方自行展示错误） */
  const samplingValues = (): Partial<Record<SamplingKey, number>> | null => {
    const parsed = parseSamplingInput(adv, t);
    return "error" in parsed ? null : parsed.values;
  };

  const adhocEntry = (): ProviderEntryInput => {
    // the test endpoint requires an id — for a fresh custom vendor the catalog
    // id is harmless (only used for the env-key fallback server-side)
    const id = editingEntryId ?? (selected !== null ? selected.id : undefined);
    const label = formLabel.trim();
    const input: ProviderEntryInput = {
      type: selected?.type ?? "openai-compatible",
      baseUrl: formBaseUrl.trim(),
      model: formModel.trim(),
      enabled: true,
    };
    if (id !== undefined) input.id = id;
    if (label.length > 0) input.label = label;
    // 高级参数：仅携带已填字段（空 = 服务端默认）
    const sampling = samplingValues();
    if (sampling !== null) Object.assign(input, sampling);
    return input;
  };

  // Validation failures are stored as dictionary keys and translated at render
  // time, so a language switch updates an already-visible message instantly.
  const validate = (): string | null => {
    if (selected === null) return "modelStep.errNoVendor";
    if (formBaseUrl.trim().length === 0) return "modelStep.errBaseUrl";
    if (formModel.trim().length === 0) return "modelStep.errModel";
    const parsed = parseSamplingInput(adv, t);
    if ("error" in parsed) return parsed.error;
    return null;
  };

  const markFormDirty = (): void => {
    if (justSaved) setJustSaved(false);
  };

  // ---- test / fetch models -------------------------------------------------
  const runTest = async (): Promise<void> => {
    if (selected === null || testing || fetchingModels || apiAbsent) return;
    const err = validate();
    if (err !== null) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setJustSaved(false);
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testProvider({ entry: adhocEntry(), apiKey: formKey });
      setTestResult(res);
    } catch (e) {
      setTestResult(syntheticError(e, t));
    } finally {
      setTesting(false);
    }
  };

  const pullModels = async (): Promise<void> => {
    if (selected === null || testing || fetchingModels || apiAbsent) return;
    const err = validate();
    if (err !== null) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setTesting(true);
    setFetchingModels(true);
    setTestResult(null);
    try {
      const res = await testProvider({ entry: adhocEntry(), apiKey: formKey });
      setTestResult(res);
      if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
        setModels(res.models);
        setFetchedCount(res.models.length);
        setComboOpen(true);
        setComboHi(0);
      }
    } catch (e) {
      setTestResult(syntheticError(e, t));
    } finally {
      setTesting(false);
      setFetchingModels(false);
    }
  };

  // ---- save / delete --------------------------------------------------------
  const save = async (): Promise<void> => {
    if (selected === null || saving || apiAbsent) return;
    const err = validate();
    if (err !== null) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSaving(true);
    try {
      const label = formLabel.trim();
      const baseUrl = formBaseUrl.trim();
      const model = formModel.trim();
      const key = formKey;
      const sampling = samplingValues();
      const patch: ProviderEntryPatch = { type: selected.type, baseUrl, model, enabled: true };
      if (label.length > 0) patch.label = label;
      const createInput: ProviderEntryInput = { type: selected.type, baseUrl, model, enabled: true };
      if (selected.id !== "custom") createInput.id = selected.id;
      if (label.length > 0) createInput.label = label;
      if (sampling !== null) {
        // 编辑：已填 = 显式设值，清空 = null（清除回服务端默认）；创建：仅携带已填字段
        for (const field of SAMPLING_FIELDS) {
          if (editingEntryId !== null) patch[field.key] = sampling[field.key] ?? null;
          const value = sampling[field.key];
          if (editingEntryId === null && value !== undefined) createInput[field.key] = value;
        }
      }
      const res =
        editingEntryId !== null
          ? await updateProvider(editingEntryId, patch, key.length > 0 ? key : undefined)
          : await createProvider(createInput, key);
      setEditingEntryId(typeof res.entry?.id === "string" ? res.entry.id : editingEntryId);
      setSavedMask(typeof res.keyMask === "string" ? res.keyMask : (res.entry?.keyMask ?? null));
      if (res.entry != null) {
        setFormLabel(res.entry.label ?? "");
        setFormBaseUrl(res.entry.baseUrl);
        setFormModel(res.entry.model);
        // 高级参数以服务端存储为准回填（清空字段落库后即为无值 → 空串）
        setAdv({
          temperature: res.entry.temperature !== undefined ? String(res.entry.temperature) : "",
          maxTokens: res.entry.maxTokens !== undefined ? String(res.entry.maxTokens) : "",
          topP: res.entry.topP !== undefined ? String(res.entry.topP) : "",
          timeoutMs: res.entry.timeoutMs !== undefined ? String(res.entry.timeoutMs) : "",
        });
      }
      setJustSaved(true);
      await refresh();
    } catch (e) {
      setFormError(prettySaveError(errorMessage(e), t));
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async (): Promise<void> => {
    if (confirmDelete === null) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    setRowBusy(id);
    try {
      await deleteProvider(id);
      if (editingEntryId === id && selected !== null) applySelection(selected, null);
      await refresh();
    } catch (e) {
      const msg = errorMessage(e);
      setFormError(t("modelStep.deleteFailed", { msg: errText(msg) ?? msg }));
    } finally {
      setRowBusy(null);
    }
  };

  // ---- per-row actions -------------------------------------------------------
  const runRowTest = async (entry: ProviderEntryWithMask): Promise<void> => {
    if (rowTests[entry.id]?.loading === true) return;
    setRowTests((m) => ({ ...m, [entry.id]: { loading: true, result: null } }));
    try {
      const res = await testProvider({ id: entry.id });
      setRowTests((m) => ({ ...m, [entry.id]: { loading: false, result: res } }));
    } catch (e) {
      setRowTests((m) => ({ ...m, [entry.id]: { loading: false, result: syntheticError(e, t) } }));
    }
  };

  const makeDefault = async (entry: ProviderEntryWithMask): Promise<void> => {
    if (defaultBusy !== null || snap.defaultProvider === entry.id) return;
    setDefaultBusy(entry.id);
    setSnap((s) => ({ ...s, defaultProvider: entry.id, defaultModel: entry.model }));
    // tolerant — mirrors the general.settings PATCH convention
    await patchSettings({ providers: { defaultProvider: entry.id, defaultModel: entry.model } });
    await refresh();
    setDefaultBusy(null);
  };

  const toggleEnabled = async (entry: ProviderEntryWithMask): Promise<void> => {
    if (rowBusy !== null) return;
    setRowBusy(entry.id);
    try {
      await updateProvider(entry.id, { enabled: !entry.enabled });
      await refresh();
    } catch (e) {
      const msg = errorMessage(e);
      setFormError(t("modelStep.updateFailed", { msg: errText(msg) ?? msg }));
    } finally {
      setRowBusy(null);
    }
  };

  // ---- footer actions (wizard flow semantics; exposed via the footer ctx) ----
  // settings page: onFinish is a no-op — 演示模式 entry is still created
  const useDemo = async (onFinish: () => void): Promise<void> => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      await createProvider({ id: "demo", type: "manual", label: t("modelStep.demoEntryLabel"), baseUrl: "", model: "demo" }, "");
      if (snap.entries.length === 0) {
        // no real provider configured — make the demo entry the default
        await patchSettings({ providers: { defaultProvider: "demo", defaultModel: "demo" } });
      }
    } catch {
      // old server / duplicate — proceed either way (tolerant by contract)
    }
    setDemoBusy(false);
    onFinish();
  };

  const enterMain = async (onFinish: () => void): Promise<void> => {
    if (finishing) return;
    setFinishing(true);
    if (snap.defaultProvider === null) {
      const first = snap.entries.find((e) => e.enabled);
      if (first !== undefined) await patchSettings({ providers: { defaultProvider: first.id, defaultModel: first.model } });
    }
    setFinishing(false);
    onFinish();
  };

  // ---- combo keyboard -----------------------------------------------------------
  const comboKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Escape") {
      // close the dropdown without letting Esc bubble to the settings overlay
      e.stopPropagation();
      setComboOpen(false);
      return;
    }
    if (!comboOpen || models.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setComboHi((h) => Math.min(h + 1, comboFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setComboHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const pick = comboFiltered[comboHi];
      if (pick !== undefined) {
        e.preventDefault();
        setFormModel(pick);
        markFormDirty();
        setComboOpen(false);
      }
    }
  };

  const applyModel = (m: string): void => {
    setFormModel(m);
    markFormDirty();
    setComboOpen(false);
  };

  const hasEnabledEntry = snap.entries.some((e) => e.enabled);
  const entryName = (e: ProviderEntryWithMask): string => e.label ?? e.id;
  // Catalog product names are server data (label/labelZh) — only the *choice*
  // between them is locale-aware; the card keeps the other name as a hint.
  const catName = (c: CatalogEntry): string => (locale === "zh" ? c.labelZh : c.label);
  /** known provider types resolve through the dictionary; unknown types fall back to the raw value (same as before) */
  const typeLabel = (type: string): string => {
    if (type === "openai-compatible") return t("modelStep.typeOpenaiCompatible");
    if (type === "anthropic") return t("modelStep.typeAnthropic");
    if (type === "manual") return t("modelStep.typeManual");
    return type;
  };
  const localHint = (c: CatalogEntry): string => {
    if (c.local === true || c.type === "manual") return t("modelStep.hintLocalNoKey");
    if (c.keyEnvHint.length > 0) return t("modelStep.hintEnvVar", { name: c.keyEnvHint });
    return t("modelStep.hintKeyRequired");
  };
  /** formError render: a "modelStep." prefix marks a validation key (translated
   *  here so language switches apply live); anything else is a raw server error
   *  localized through useApiErrorMessage. */
  const formatFormError = (raw: string | null): string | null => {
    if (raw === null) return null;
    if (raw.startsWith("modelStep.")) return t(raw);
    return errText(raw);
  };

  const fid = (suffix: string): string => `${idPrefix}-${suffix}`;

  return (
    <>
      <div className={bodyClassName}>
        {apiAbsent ? (
          <div className="wiz-banner" role="status">
            {t("modelStep.apiAbsentBanner")}
          </div>
        ) : null}

        {initializing ? (
          <div className="wiz-loading">
            <Spinner label={t("modelStep.loadingCatalog")} />
          </div>
        ) : (
          <>
            {/* Section A · 选择供应商 */}
            <section className="wiz-sec" aria-label={t("modelStep.selectAria")}>
              <div className="wiz-sec-head">
                <h3 className="wiz-sec-title">{t("modelStep.selectTitle")}</h3>
                <span className="wiz-sec-hint">{t("modelStep.selectHint")}</span>
              </div>
              <div className="vendor-grid">
                {snap.catalog.map((c) => {
                  const configured = snap.entries.some((e) => e.id === c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`vendor-card${selected?.id === c.id ? " selected" : ""}`}
                      aria-pressed={selected?.id === c.id}
                      onClick={() => openVendor(c)}
                    >
                      <span className="vendor-head">
                        <span className="vendor-name">
                          {catName(c)}
                          {c.label !== c.labelZh ? <span className="en"> {locale === "zh" ? c.label : c.labelZh}</span> : null}
                        </span>
                        {configured ? <span className="chip ok">{t("modelStep.configuredChip")}</span> : null}
                      </span>
                      <span className="vendor-url">{c.baseUrl.length > 0 ? c.baseUrl : t("modelStep.anyEndpoint")}</span>
                      <span className="vendor-meta">
                        <span className="vendor-type">{c.local === true ? t("modelStep.typeLocal", { type: typeLabel(c.type) }) : typeLabel(c.type)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section B · 配置表单 */}
            {selected !== null ? (
              <section className="wiz-sec" aria-label={t("modelStep.configAria", { name: catName(selected) })}>
                <div className="wiz-sec-head">
                  <h3 className="wiz-sec-title">{t("modelStep.configTitle", { name: catName(selected) })}</h3>
                  {editingEntryId !== null ? <span className="chip">{editingEntryId}</span> : <span className="wiz-sec-hint">{t("modelStep.unsaved")}</span>}
                </div>
                <div className="wiz-form">
                  <div className="wiz-fields">
                    <div className="wiz-field">
                      <label htmlFor={fid("name")}>{t("modelStep.nameLabel")}</label>
                      <input
                        id={fid("name")}
                        className="wiz-input"
                        value={formLabel}
                        placeholder={catName(selected)}
                        spellCheck={false}
                        onChange={(e) => {
                          setFormLabel(e.target.value);
                          markFormDirty();
                        }}
                      />
                    </div>
                    <div className="wiz-field">
                      <label htmlFor={fid("baseurl")}>{t("modelStep.baseUrlLabel")}</label>
                      <input
                        id={fid("baseurl")}
                        className="wiz-input"
                        value={formBaseUrl}
                        placeholder={selected.id === "custom" ? "https://…/v1" : "https://…"}
                        spellCheck={false}
                        onChange={(e) => {
                          setFormBaseUrl(e.target.value);
                          markFormDirty();
                        }}
                      />
                    </div>
                    <div className="wiz-field full">
                      <label htmlFor={fid("key")}>{t("modelStep.apiKeyLabel")}</label>
                      <div className="key-row">
                        <input
                          id={fid("key")}
                          className="wiz-input"
                          type={showKey ? "text" : "password"}
                          value={formKey}
                          placeholder={selected.local === true || selected.type === "manual" ? t("modelStep.keyPlaceholderLocal") : "sk-…"}
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(e) => {
                            setFormKey(e.target.value);
                            markFormDirty();
                          }}
                        />
                        <button
                          type="button"
                          className="wiz-eye"
                          aria-pressed={showKey}
                          aria-label={showKey ? t("modelStep.hideKeyAria") : t("modelStep.showKeyAria")}
                          onClick={() => setShowKey((v) => !v)}
                        >
                          {showKey ? t("modelStep.hide") : t("modelStep.show")}
                        </button>
                      </div>
                      <span className="wiz-help">
                        {localHint(selected)}
                        {savedMask !== null ? <span className="chip" title={t("modelStep.savedKeyTitle")}>{t("modelStep.savedKeyChip", { mask: savedMask })}</span> : null}
                      </span>
                    </div>
                    <div className="wiz-field full">
                      <label htmlFor={fid("model")}>{t("modelStep.modelLabel")}</label>
                      <div className="combo-row">
                        <div className="combo-wrap">
                          <input
                            id={fid("model")}
                            className="wiz-input"
                            role="combobox"
                            aria-expanded={comboOpen && models.length > 0}
                            aria-autocomplete="list"
                            aria-controls={fid("model-list")}
                            value={formModel}
                            placeholder={t("modelStep.modelPlaceholder")}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => {
                              setFormModel(e.target.value);
                              markFormDirty();
                              setComboOpen(true);
                              setComboHi(0);
                            }}
                            onFocus={() => setComboOpen(true)}
                            onClick={() => setComboOpen(true)}
                            onBlur={() => setComboOpen(false)}
                            onKeyDown={comboKeyDown}
                          />
                          {comboOpen && models.length > 0 ? (
                            <div className="combo-list" id={fid("model-list")} role="listbox" aria-label={t("modelStep.modelListAria")}>
                              {comboFiltered.length === 0 ? (
                                <div className="combo-empty">{t("modelStep.comboEmpty")}</div>
                              ) : (
                                comboFiltered.map((m, i) => (
                                  <button
                                    key={m}
                                    type="button"
                                    role="option"
                                    aria-selected={i === comboHi}
                                    className={`combo-option${i === comboHi ? " active" : ""}`}
                                    onMouseDown={(ev) => {
                                      ev.preventDefault();
                                      applyModel(m);
                                    }}
                                    onMouseEnter={() => setComboHi(i)}
                                  >
                                    {m}
                                  </button>
                                ))
                              )}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="combo-toggle"
                          aria-label={t("modelStep.comboToggleAria")}
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => setComboOpen((o) => !o)}
                        >
                          ▾
                        </button>
                        <Button
                          small
                          ghost
                          disabled={fetchingModels || testing || apiAbsent}
                          onClick={() => void pullModels()}
                          title={apiAbsent ? t("modelStep.serviceUnavailable") : t("modelStep.fetchTitle")}
                        >
                          {fetchingModels ? <Spinner /> : null}
                          {t("modelStep.fetchModels")}
                        </Button>
                      </div>
                      <span className="wiz-help">
                        {fetchedCount !== null ? (
                          <span className="chip ok">{t("modelStep.fetchedChip", { n: fetchedCount })}</span>
                        ) : models.length > 0 ? (
                          t("modelStep.candidatesCount", { n: models.length })
                        ) : (
                          t("modelStep.noCandidates")
                        )}
                      </span>
                    </div>
                  </div>

                  {/* 高级参数（采样/超时，v0.2 §5.2）：默认折叠；留空 = 服务端默认；编辑时清空即清除 */}
                  <div className="wiz-field full" style={{ gap: 8 }}>
                    <div className="wiz-actions" style={{ justifyContent: "flex-start" }}>
                      <Button
                        small
                        ghost
                        aria-expanded={advOpen}
                        aria-controls={fid("adv-panel")}
                        onClick={() => setAdvOpen((o) => !o)}
                        title="温度 / 最大输出 token 数 / top_p / 请求超时 — 留空使用服务端默认"
                      >
                        {advOpen ? "收起高级参数" : "高级参数（采样与超时）"}
                      </Button>
                      {SAMPLING_FIELDS.some((f) => adv[f.key].trim().length > 0) ? (
                        <span className="chip" title="已自定义部分采样参数">已自定义</span>
                      ) : (
                        <span className="wiz-sec-hint">温度 / 最大输出 token 数 / top_p / 超时，留空用默认</span>
                      )}
                    </div>
                    {advOpen ? (
                      <div className="wiz-fields" id={fid("adv-panel")}>
                        {SAMPLING_FIELDS.map((field) => (
                          <div className="wiz-field" key={field.key}>
                            <label htmlFor={fid(`adv-${field.key}`)}>{field.label}</label>
                            <input
                              id={fid(`adv-${field.key}`)}
                              className="wiz-input mono"
                              type="text"
                              inputMode="decimal"
                              value={adv[field.key]}
                              placeholder={field.placeholder}
                              spellCheck={false}
                              aria-label={`${field.label}（${field.hint}）`}
                              onChange={(e) => {
                                setAdv((prev) => ({ ...prev, [field.key]: e.target.value }));
                                markFormDirty();
                              }}
                            />
                            <span className="wiz-help">{field.hint}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {testing || testResult !== null ? (
                    <div
                      className={`test-panel${testResult === null ? "" : testResult.ok ? " ok" : " err"}`}
                      role={testResult?.ok === true ? "status" : "alert"}
                    >
                      {testing ? <span className="t-line dim">{t("modelStep.testing")}</span> : null}
                      {!testing && testResult !== null ? (
                        <>
                          <span className="t-line">
                            {testResult.ok
                              ? testResult.models !== undefined
                                ? t("modelStep.testOkModels", { latency: testResult.latencyMs, n: testResult.models.length })
                                : t("modelStep.testOk", { latency: testResult.latencyMs })
                              : `${testResult.error?.code ?? "ERROR"} · ${testResult.latencyMs}ms`}
                          </span>
                          {!testResult.ok ? <span className="t-hint">{testResult.hint ?? testResult.error?.message ?? ""}</span> : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  <ErrorText>{formatFormError(formError)}</ErrorText>

                  <div className="wiz-actions">
                    <Button variant="primary" disabled={saving || apiAbsent} onClick={() => void save()} title={apiAbsent ? t("modelStep.serviceUnavailable") : undefined}>
                      {saving ? t("modelStep.saving") : t("modelStep.save")}
                    </Button>
                    <Button disabled={testing || fetchingModels || apiAbsent} onClick={() => void runTest()} title={apiAbsent ? t("modelStep.serviceUnavailable") : undefined}>
                      {testing ? t("modelStep.testing") : t("modelStep.testConnection")}
                    </Button>
                    {editingEntryId !== null ? (
                      <Button
                        ghost
                        disabled={rowBusy !== null}
                        onClick={() =>
                          setConfirmDelete({
                            id: editingEntryId,
                            name: formLabel.trim().length > 0 ? formLabel.trim() : (catName(selected).length > 0 ? catName(selected) : editingEntryId),
                          })
                        }
                      >
                        {t("modelStep.delete")}
                      </Button>
                    ) : null}
                    {justSaved ? <span className="chip ok">{t("modelStep.savedChip")}</span> : null}
                  </div>
                </div>
              </section>
            ) : null}

            {/* Section C · 已配置列表 */}
            {snap.entries.length > 0 ? (
              <section className="wiz-sec" aria-label={t("modelStep.entriesAria")}>
                <div className="wiz-sec-head">
                  <h3 className="wiz-sec-title">
                    {t("modelStep.entriesTitle")} <span className="count">{t("modelStep.entriesCount", { n: snap.entries.length })}</span>
                  </h3>
                  <span className="wiz-sec-hint">{t("modelStep.defaultHint")}</span>
                </div>
                <div className="entry-list" role="radiogroup" aria-label={t("modelStep.defaultGroupAria")}>
                  {snap.entries.map((entry) => {
                    const rt: RowTest | undefined = rowTests[entry.id];
                    const isDefault = snap.defaultProvider === entry.id;
                    return (
                      <div className={`entry-row${entry.enabled ? "" : " off"}`} key={entry.id}>
                        <label className="entry-default" title={isDefault ? t("modelStep.isDefaultTitle") : t("modelStep.setDefaultTitle")}>
                          <input
                            type="radio"
                            name={`${idPrefix}-default-provider`}
                            checked={isDefault}
                            disabled={defaultBusy !== null}
                            onChange={() => void makeDefault(entry)}
                          />
                          {t("modelStep.defaultLabel")}
                        </label>
                        <button type="button" className="entry-main" onClick={() => openEntry(entry)} title={t("modelStep.editEntryTitle")}>
                          <span className="entry-name">{entryName(entry)}</span>
                          <code className="entry-id">{entry.id}</code>
                          <span className="entry-model">{entry.model}</span>
                          {entry.keyMask !== null ? (
                            <code className="entry-key" title={t("modelStep.savedKeyTitle")}>
                              {entry.keyMask}
                            </code>
                          ) : null}
                        </button>
                        <div className="entry-actions">
                          {rt?.loading === true ? (
                            <Spinner />
                          ) : rt?.result != null ? (
                            rt.result.ok ? (
                              <span className="chip ok" title={t("modelStep.rowOkTitle", { latency: rt.result.latencyMs })}>
                                {rt.result.latencyMs}ms
                              </span>
                            ) : (
                              <span className="chip err" title={rt.result.hint ?? rt.result.error?.message ?? ""}>
                                {rt.result.error?.code ?? "ERROR"}
                              </span>
                            )
                          ) : null}
                          <label className="entry-toggle" title={entry.enabled ? t("modelStep.enabledTitle") : t("modelStep.disabledTitle")}>
                            <input type="checkbox" checked={entry.enabled} disabled={rowBusy !== null} onChange={() => void toggleEnabled(entry)} />
                            {t("modelStep.enableLabel")}
                          </label>
                          <Button small ghost disabled={rt?.loading === true} onClick={() => void runRowTest(entry)}>
                            {t("modelStep.test")}
                          </Button>
                          <Button small ghost disabled={rowBusy !== null} onClick={() => setConfirmDelete({ id: entry.id, name: entryName(entry) })}>
                            {t("modelStep.delete")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>

      {footer !== undefined
        ? footer({
            hasEnabledEntry,
            apiAbsent,
            demoBusy,
            finishing,
            onDemo: () => void useDemo(onFinish ?? (() => undefined)),
            onFinish: () => void enterMain(onFinish ?? (() => undefined)),
          })
        : null}

      {confirmDelete !== null ? (
        <Modal title={t("modelStep.deleteTitle")} onClose={() => setConfirmDelete(null)}>
          <p className="wiz-confirm-text">{t("modelStep.deleteConfirm", { name: confirmDelete.name })}</p>
          <div className="wiz-actions end">
            <Button onClick={() => setConfirmDelete(null)}>{t("modelStep.cancel")}</Button>
            <Button variant="primary" onClick={() => void doDelete()}>
              {t("modelStep.delete")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
