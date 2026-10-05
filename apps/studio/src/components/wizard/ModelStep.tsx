// Wizard step 2 (v0.2 §2, issue #48): model configuration — BYO-LLM, any vendor.
// Consumes the /api/providers contract (backend S2): catalog presets, configured
// entries with masked keys, and ad-hoc connection diagnostics. Tolerates the
// endpoint being absent (older server): a banner explains it and the
// demo-mode skip keeps working. All state is local — this is a wizard step,
// not a workspace; only `entries`/defaults are refreshed after every mutation.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  createProvider,
  deleteProvider,
  errorMessage,
  getProviders,
  patchSettings,
  testProvider,
  updateProvider,
  type CatalogEntry,
  type ProviderEntry,
  type ProviderEntryInput,
  type ProviderEntryWithMask,
  type ProvidersSnapshot,
  type TestResult,
} from "../../api";
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

const TYPE_LABELS: Record<string, string> = {
  "openai-compatible": "OpenAI 兼容",
  anthropic: "Anthropic",
  manual: "演示",
};

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

function prettySaveError(msg: string): string {
  if (msg.startsWith("PROVIDER_EXISTS")) return "该供应商已有配置 — 请在已配置列表中编辑它，或换一家供应商";
  return msg;
}

function syntheticError(err: unknown): TestResult {
  const msg = errorMessage(err);
  return { ok: false, latencyMs: 0, error: { code: "REQUEST_FAILED", message: msg }, hint: `请求失败：${msg}` };
}

interface RowTest {
  loading: boolean;
  result: TestResult | null;
}

export interface ModelStepProps {
  onBack: () => void;
  onFinish: () => void;
}

export function ModelStep({ onBack, onFinish }: ModelStepProps): JSX.Element {
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
    return input;
  };

  const validate = (): string | null => {
    if (selected === null) return "请先选择一家供应商";
    if (formBaseUrl.trim().length === 0) return "请填写 Base URL";
    if (formModel.trim().length === 0) return "请填写模型名 — 可从列表选择、拉取，或直接输入";
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
      setTestResult(syntheticError(e));
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
      setTestResult(syntheticError(e));
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
      const patch: Partial<ProviderEntry> = { type: selected.type, baseUrl, model, enabled: true };
      if (label.length > 0) patch.label = label;
      const createInput: ProviderEntryInput = { type: selected.type, baseUrl, model, enabled: true };
      if (selected.id !== "custom") createInput.id = selected.id;
      if (label.length > 0) createInput.label = label;
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
      }
      setJustSaved(true);
      await refresh();
    } catch (e) {
      setFormError(prettySaveError(errorMessage(e)));
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
      setFormError(`删除失败：${errorMessage(e)}`);
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
      setRowTests((m) => ({ ...m, [entry.id]: { loading: false, result: syntheticError(e) } }));
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
      setFormError(`更新失败：${errorMessage(e)}`);
    } finally {
      setRowBusy(null);
    }
  };

  // ---- footer actions ----------------------------------------------------------
  const useDemo = async (): Promise<void> => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      await createProvider({ id: "demo", type: "manual", label: "演示模式", baseUrl: "", model: "demo" }, "");
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

  const enterMain = async (): Promise<void> => {
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
  const localHint = (c: CatalogEntry): string =>
    c.local === true || c.type === "manual" ? "本地服务无需 Key" : c.keyEnvHint.length > 0 ? `也可设置环境变量 ${c.keyEnvHint}` : "端点需要鉴权时填写";

  return (
    <>
      <div className="wizard-body model-body">
        {apiAbsent ? (
          <div className="wiz-banner" role="status">
            模型服务暂不可用（旧版服务端），可跳过使用演示模式
          </div>
        ) : null}

        {initializing ? (
          <div className="wiz-loading">
            <Spinner label="加载供应商目录…" />
          </div>
        ) : (
          <>
            {/* Section A · 选择供应商 */}
            <section className="wiz-sec" aria-label="选择模型供应商">
              <div className="wiz-sec-head">
                <h3 className="wiz-sec-title">选择供应商</h3>
                <span className="wiz-sec-hint">任选一家模型服务（自带模型，BYO Key），或使用自定义端点</span>
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
                          {c.labelZh}
                          {c.label !== c.labelZh ? <span className="en"> {c.label}</span> : null}
                        </span>
                        {configured ? <span className="chip ok">已配置</span> : null}
                      </span>
                      <span className="vendor-url">{c.baseUrl.length > 0 ? c.baseUrl : "任意 OpenAI 兼容端点"}</span>
                      <span className="vendor-meta">
                        <span className="vendor-type">{c.local === true ? `本地 · ${TYPE_LABELS[c.type] ?? c.type}` : (TYPE_LABELS[c.type] ?? c.type)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Section B · 配置表单 */}
            {selected !== null ? (
              <section className="wiz-sec" aria-label={`配置 ${selected.labelZh}`}>
                <div className="wiz-sec-head">
                  <h3 className="wiz-sec-title">配置 · {selected.labelZh}</h3>
                  {editingEntryId !== null ? <span className="chip">{editingEntryId}</span> : <span className="wiz-sec-hint">未保存</span>}
                </div>
                <div className="wiz-form">
                  <div className="wiz-fields">
                    <div className="wiz-field">
                      <label htmlFor="wiz-name">名称（可选）</label>
                      <input
                        id="wiz-name"
                        className="wiz-input"
                        value={formLabel}
                        placeholder={selected.labelZh}
                        spellCheck={false}
                        onChange={(e) => {
                          setFormLabel(e.target.value);
                          markFormDirty();
                        }}
                      />
                    </div>
                    <div className="wiz-field">
                      <label htmlFor="wiz-baseurl">Base URL</label>
                      <input
                        id="wiz-baseurl"
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
                      <label htmlFor="wiz-key">API Key</label>
                      <div className="key-row">
                        <input
                          id="wiz-key"
                          className="wiz-input"
                          type={showKey ? "text" : "password"}
                          value={formKey}
                          placeholder={selected.local === true || selected.type === "manual" ? "本地服务无需填写" : "sk-…"}
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
                          aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                          onClick={() => setShowKey((v) => !v)}
                        >
                          {showKey ? "隐藏" : "显示"}
                        </button>
                      </div>
                      <span className="wiz-help">
                        {localHint(selected)}
                        {savedMask !== null ? <span className="chip" title="已保存的 API Key">已存 {savedMask}</span> : null}
                      </span>
                    </div>
                    <div className="wiz-field full">
                      <label htmlFor="wiz-model">模型</label>
                      <div className="combo-row">
                        <div className="combo-wrap">
                          <input
                            id="wiz-model"
                            className="wiz-input"
                            role="combobox"
                            aria-expanded={comboOpen && models.length > 0}
                            aria-autocomplete="list"
                            aria-controls="wiz-model-list"
                            value={formModel}
                            placeholder="模型名，如 deepseek-chat"
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
                            <div className="combo-list" id="wiz-model-list" role="listbox" aria-label="可选模型">
                              {comboFiltered.length === 0 ? (
                                <div className="combo-empty">无匹配模型 — 可手动输入或拉取列表</div>
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
                          aria-label="展开或收起模型列表"
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
                          title={apiAbsent ? "模型服务不可用" : "从服务端拉取可用模型列表（需可连通）"}
                        >
                          {fetchingModels ? <Spinner /> : null}
                          拉取模型列表
                        </Button>
                      </div>
                      <span className="wiz-help">
                        {fetchedCount !== null ? (
                          <span className="chip ok">已拉取 {fetchedCount} 个模型</span>
                        ) : models.length > 0 ? (
                          `${models.length} 个候选模型`
                        ) : (
                          "暂无候选模型 — 可拉取列表或直接输入名称"
                        )}
                      </span>
                    </div>
                  </div>

                  {testing || testResult !== null ? (
                    <div
                      className={`test-panel${testResult === null ? "" : testResult.ok ? " ok" : " err"}`}
                      role={testResult?.ok === true ? "status" : "alert"}
                    >
                      {testing ? <span className="t-line dim">测试中…</span> : null}
                      {!testing && testResult !== null ? (
                        <>
                          <span className="t-line">
                            {testResult.ok
                              ? `连接成功 · ${testResult.latencyMs}ms${testResult.models !== undefined ? ` · ${testResult.models.length} 个模型` : ""}`
                              : `${testResult.error?.code ?? "ERROR"} · ${testResult.latencyMs}ms`}
                          </span>
                          {!testResult.ok ? <span className="t-hint">{testResult.hint ?? testResult.error?.message ?? ""}</span> : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  <ErrorText>{formError}</ErrorText>

                  <div className="wiz-actions">
                    <Button variant="primary" disabled={saving || apiAbsent} onClick={() => void save()} title={apiAbsent ? "模型服务不可用" : undefined}>
                      {saving ? "保存中…" : "保存"}
                    </Button>
                    <Button disabled={testing || fetchingModels || apiAbsent} onClick={() => void runTest()} title={apiAbsent ? "模型服务不可用" : undefined}>
                      {testing ? "测试中…" : "测试连接"}
                    </Button>
                    {editingEntryId !== null ? (
                      <Button
                        ghost
                        disabled={rowBusy !== null}
                        onClick={() =>
                          setConfirmDelete({
                            id: editingEntryId,
                            name: formLabel.trim().length > 0 ? formLabel.trim() : (selected.labelZh.length > 0 ? selected.labelZh : editingEntryId),
                          })
                        }
                      >
                        删除
                      </Button>
                    ) : null}
                    {justSaved ? <span className="chip ok">已保存</span> : null}
                  </div>
                </div>
              </section>
            ) : null}

            {/* Section C · 已配置列表 */}
            {snap.entries.length > 0 ? (
              <section className="wiz-sec" aria-label="已配置的供应商">
                <div className="wiz-sec-head">
                  <h3 className="wiz-sec-title">
                    已配置 <span className="count">{snap.entries.length} 家</span>
                  </h3>
                  <span className="wiz-sec-hint">默认模型用于对话与规划</span>
                </div>
                <div className="entry-list" role="radiogroup" aria-label="默认供应商">
                  {snap.entries.map((entry) => {
                    const rt: RowTest | undefined = rowTests[entry.id];
                    const isDefault = snap.defaultProvider === entry.id;
                    return (
                      <div className={`entry-row${entry.enabled ? "" : " off"}`} key={entry.id}>
                        <label className="entry-default" title={isDefault ? "当前默认模型" : "设为默认模型"}>
                          <input
                            type="radio"
                            name="wiz-default-provider"
                            checked={isDefault}
                            disabled={defaultBusy !== null}
                            onChange={() => void makeDefault(entry)}
                          />
                          默认
                        </label>
                        <button type="button" className="entry-main" onClick={() => openEntry(entry)} title="点击编辑此供应商">
                          <span className="entry-name">{entryName(entry)}</span>
                          <code className="entry-id">{entry.id}</code>
                          <span className="entry-model">{entry.model}</span>
                          {entry.keyMask !== null ? (
                            <code className="entry-key" title="已保存的 API Key">
                              {entry.keyMask}
                            </code>
                          ) : null}
                        </button>
                        <div className="entry-actions">
                          {rt?.loading === true ? (
                            <Spinner />
                          ) : rt?.result != null ? (
                            rt.result.ok ? (
                              <span className="chip ok" title={`连接正常 · ${rt.result.latencyMs}ms`}>
                                {rt.result.latencyMs}ms
                              </span>
                            ) : (
                              <span className="chip err" title={rt.result.hint ?? rt.result.error?.message ?? ""}>
                                {rt.result.error?.code ?? "ERROR"}
                              </span>
                            )
                          ) : null}
                          <label className="entry-toggle" title={entry.enabled ? "已启用 — 点击停用" : "已停用 — 点击启用"}>
                            <input type="checkbox" checked={entry.enabled} disabled={rowBusy !== null} onChange={() => void toggleEnabled(entry)} />
                            启用
                          </label>
                          <Button small ghost disabled={rt?.loading === true} onClick={() => void runRowTest(entry)}>
                            测试
                          </Button>
                          <Button small ghost disabled={rowBusy !== null} onClick={() => setConfirmDelete({ id: entry.id, name: entryName(entry) })}>
                            删除
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

      <footer className="wizard-foot model-foot">
        <Button onClick={onBack}>上一步</Button>
        <span className="spacer" />
        {!hasEnabledEntry ? <span className="wiz-foot-hint">请先配置至少一个模型供应商，或选择演示模式</span> : null}
        <Button ghost disabled={demoBusy} onClick={() => void useDemo()}>
          {demoBusy ? "配置演示模式…" : "跳过，用演示模式"}
        </Button>
        <Button
          variant="primary"
          disabled={!hasEnabledEntry || finishing || demoBusy}
          title={hasEnabledEntry ? undefined : "请先配置至少一个模型供应商，或选择演示模式"}
          onClick={() => void enterMain()}
        >
          进入主界面
        </Button>
      </footer>

      {confirmDelete !== null ? (
        <Modal title="删除供应商" onClose={() => setConfirmDelete(null)}>
          <p className="wiz-confirm-text">
            确定删除「{confirmDelete.name}」的配置？已保存的 API Key 将一并删除，此操作不可撤销。
          </p>
          <div className="wiz-actions end">
            <Button onClick={() => setConfirmDelete(null)}>取消</Button>
            <Button variant="primary" onClick={() => void doDelete()}>
              删除
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
