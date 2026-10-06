// McpSettingsPage (S6, v0.2 §5 issue #57): the settings center MCP page —
// 合并工具到 Agent switch (settings.mcp.mergeTools), the server table editor
// (id / command / args / enabled per the S4 PUT /api/mcp/servers full-array
// contract) and mcp.json 导入/导出 (export downloads the persisted config;
// import = file picker or paste + client-side validation). When the optional
// host package is absent (501 MCP_HOST_UNAVAILABLE) the page shows the dim
// informational state but keeps the editor alive via settings.mcp.servers
// (PATCH /api/settings) — config persists and lights up when the host lands.
import { useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { normalizeSettings } from "../../settings";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import type { TranslateFn } from "../../i18n/format";
import { Button, ErrorText, Modal, Spinner, Switch } from "../ui";
import { SettingsError, SettingsRow, SettingsSection, useSectionPatch } from "./fields";

interface EditRow {
  id: string;
  command: string;
  args: string;
  enabled: boolean;
}

interface McpEditorState {
  /** "live" = host endpoint usable (PUT /api/mcp/servers); "config" = host absent, settings.mcp.servers fallback */
  mode: "live" | "config";
  rows: EditRow[];
  loading: boolean;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function toRows(servers: api.McpServerEntry[]): EditRow[] {
  return servers.map((s) => ({ id: s.id, command: s.command, args: s.args.join(" "), enabled: s.enabled }));
}

/** rows → full McpServerEntry array (defaults per the S4 contract) */
function toEntries(rows: EditRow[]): api.McpServerEntry[] {
  return rows.map((r) => ({
    id: r.id.trim(),
    command: r.command.trim(),
    args: r.args.trim().length > 0 ? r.args.trim().split(/\s+/) : [],
    env: {},
    enabled: r.enabled,
    whitelist: [],
    timeoutMs: 30000,
  }));
}

/** zod-lite client validation (mirror of the server McpServerEntrySchema) — t 注入，错误文案走 mcp.err* 词典键 */
function validateRows(rows: EditRow[], t: TranslateFn): string | null {
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const id = r.id.trim();
    const command = r.command.trim();
    if (!ID_PATTERN.test(id))
      return t("mcp.errRow", { row: i + 1, msg: t("mcp.errInvalidId", { id: id.length > 0 ? id : t("mcp.errIdEmpty") }) });
    if (seen.has(id)) return t("mcp.errRow", { row: i + 1, msg: t("mcp.errDupId", { id }) });
    seen.add(id);
    if (command.length === 0) return t("mcp.errRowWithId", { row: i + 1, id, msg: t("mcp.errCommandRequired") });
  }
  return null;
}

/** accept both our export format and the standard {"mcpServers": {…}} client format — t 注入，错误文案走 mcp.err* 词典键 */
function parseImportedJson(text: string, t: TranslateFn): { servers: api.McpServerEntry[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: t("mcp.errJsonParse", { msg: err instanceof Error ? err.message : String(err) }) };
  }
  if (parsed === null || typeof parsed !== "object") return { error: t("mcp.errNotObject") };
  const obj = parsed as Record<string, unknown>;
  const out: api.McpServerEntry[] = [];
  const pushEntry = (rawId: string, raw: unknown): string | null => {
    if (raw === null || typeof raw !== "object") return t("mcp.errServerNotObject", { id: rawId });
    if (!ID_PATTERN.test(rawId)) return t("mcp.errInvalidId", { id: rawId });
    if (out.some((e) => e.id === rawId)) return t("mcp.errDupId", { id: rawId });
    const s = raw as Record<string, unknown>;
    const command = typeof s.command === "string" ? s.command : "";
    if (command.length === 0) return t("mcp.errServerNoCommand", { id: rawId });
    const args = Array.isArray(s.args) && s.args.every((a) => typeof a === "string") ? (s.args as string[]) : [];
    const env =
      s.env !== null && typeof s.env === "object" && Object.values(s.env).every((v) => typeof v === "string")
        ? (s.env as Record<string, string>)
        : {};
    const whitelist = Array.isArray(s.whitelist) && s.whitelist.every((w) => typeof w === "string") ? (s.whitelist as string[]) : [];
    const timeoutMs = typeof s.timeoutMs === "number" && Number.isFinite(s.timeoutMs) ? Math.min(600_000, Math.max(100, Math.round(s.timeoutMs))) : 30000;
    out.push({
      id: rawId,
      command,
      args,
      env,
      enabled: s.enabled !== false,
      whitelist,
      timeoutMs,
    });
    return null;
  };
  // format 1: our export {servers: [...]}
  if (Array.isArray(obj.servers)) {
    for (const raw of obj.servers) {
      if (raw === null || typeof raw !== "object" || typeof (raw as { id?: unknown }).id !== "string") return { error: t("mcp.errEntryNoId") };
      const err = pushEntry((raw as { id: string }).id, raw);
      if (err !== null) return { error: err };
    }
    return { servers: out };
  }
  // format 2: standard MCP client {mcpServers: {name: {command, args, env}}}
  if (obj.mcpServers !== null && typeof obj.mcpServers === "object") {
    for (const [name, raw] of Object.entries(obj.mcpServers as Record<string, unknown>)) {
      const err = pushEntry(name, raw);
      if (err !== null) return { error: err };
    }
    return { servers: out };
  }
  return { error: t("mcp.errUnknownFormat") };
}

export function McpSettingsPage(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const values = useStudio((s) => s.settings.values);
  const mergeTools = values?.mcp?.mergeTools === true;
  const setMergeTools = useStudio((s) => s.setMcpMergeTools);
  const { error: mergeError } = useSectionPatch("mcp");

  const [editor, setEditor] = useState<McpEditorState>({ mode: "config", rows: [], loading: true });
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // ---- 推荐服务器预设（agent-kit 28 个；旧服务端无该端点 → 保留 null 隐藏本节） ----
  const [presets, setPresets] = useState<api.McpServerEntry[] | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetDone, setPresetDone] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setEditor((e) => ({ ...e, loading: true }));
    // preferred: the live endpoint (also carries the 501 signal)
    const servers = await api.getMcpServers();
    if (servers !== null) {
      setEditor({ mode: "live", rows: toRows(servers), loading: false });
      return;
    }
    // host absent (501) — fall back to settings.mcp.servers so editing still works
    const snapshot = await api.getSettings();
    const rawServers =
      snapshot !== null && snapshot.mcp !== null && typeof snapshot.mcp === "object" && Array.isArray((snapshot.mcp as { servers?: unknown }).servers)
        ? ((snapshot.mcp as { servers: unknown[] }).servers as api.McpServerEntry[])
        : [];
    setEditor({ mode: "config", rows: toRows(rawServers), loading: false });
  };

  useEffect(() => {
    void load();
  }, []);

  // 推荐服务器预设：静态端点常驻可用（无需 mcp-host）；旧服务端 → null → 隐藏导入节
  useEffect(() => {
    let alive = true;
    void api.getMcpPresets().then((res) => {
      if (alive && res !== null) setPresets(res.presets);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 一键导入：按 id 合并（既有条目全量保留，含表格外 env/whitelist 字段；预设仅追加新增）→ PUT / patch 持久化 */
  const importPresets = async (): Promise<void> => {
    if (presets === null || presetBusy) return;
    setPresetBusy(true);
    setPresetError(null);
    setPresetDone(null);
    try {
      let existing: api.McpServerEntry[];
      if (editor.mode === "live") {
        const servers = await api.getMcpServers();
        if (servers === null) {
          setPresetError("无法读取当前服务器列表（MCP 宿主不可用），导入已取消");
          return;
        }
        existing = servers;
      } else {
        const snapshot = await api.getSettings();
        const rawServers =
          snapshot !== null && snapshot.mcp !== null && typeof snapshot.mcp === "object" && Array.isArray((snapshot.mcp as { servers?: unknown }).servers)
            ? ((snapshot.mcp as { servers: unknown[] }).servers as api.McpServerEntry[])
            : null;
        if (rawServers === null) {
          setPresetError("无法读取当前服务器配置，导入已取消");
          return;
        }
        existing = rawServers;
      }
      const taken = new Set(existing.map((e) => e.id));
      // 未保存的新行草稿（id+command 已填且不冲突）一并带上，避免一键导入冲掉刚输入的内容
      const drafts = toEntries(editor.rows.filter((r) => r.id.trim().length > 0 && r.command.trim().length > 0 && !taken.has(r.id.trim())));
      for (const draft of drafts) taken.add(draft.id);
      const added = presets.filter((p) => !taken.has(p.id));
      const merged = [...existing, ...drafts, ...added];
      if (editor.mode === "live") {
        const res = await api.putMcpServers(merged);
        setEditor((e) => ({ ...e, rows: toRows(res.servers) }));
      } else {
        await api.patchSettingsStrict({ mcp: { servers: merged } });
        setEditor((e) => ({ ...e, rows: toRows(merged) }));
      }
      const enabledAdded = added.filter((p) => p.enabled).length;
      setPresetDone(
        added.length === 0
          ? "推荐服务器已全部在列表中，无新增。"
          : `已导入 ${added.length} 个新服务器（其中 ${enabledAdded} 个默认启用）；time/color/json 等纯计算服务器即刻可用。`,
      );
    } catch (e) {
      setPresetError(`导入失败：${api.errorMessage(e)}`);
    } finally {
      setPresetBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    const err = validateRows(editor.rows, t);
    if (err !== null) {
      setEditorError(err);
      return;
    }
    setEditorError(null);
    setSaving(true);
    try {
      const entries = toEntries(editor.rows);
      if (editor.mode === "live") {
        const res = await api.putMcpServers(entries);
        setEditor((e) => ({ ...e, rows: toRows(res.servers) }));
      } else {
        // host absent (501) — persist via settings so the config survives
        // until the host package lands; enabled servers auto-start then
        const saved = await api.patchSettingsStrict({ mcp: { servers: entries } });
        useStudio.setState((st) => (st.settings.values === null ? {} : { settings: { values: normalizeSettings(saved) } }));
      }
    } catch (e) {
      const raw = api.errorMessage(e);
      setEditorError(t("mcp.errSaveFailed", { msg: errText(raw) ?? raw }));
    } finally {
      setSaving(false);
    }
  };

  const updateRow = (index: number, patch: Partial<EditRow>): void => {
    setEditor((e) => ({ ...e, rows: e.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
  };

  const addRow = (): void => {
    setEditor((e) => ({ ...e, rows: [...e.rows, { id: "", command: "", args: "", enabled: false }] }));
  };

  const removeRow = (index: number): void => {
    setEditor((e) => ({ ...e, rows: e.rows.filter((_, i) => i !== index) }));
  };

  const exportJson = (): void => {
    const payload = { mergeTools, servers: toEntries(editor.rows.filter((r) => r.id.trim().length > 0 && r.command.trim().length > 0)) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mcp.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyImport = async (servers: api.McpServerEntry[], mode: "replace" | "append"): Promise<void> => {
    setImportBusy(true);
    setImportError(null);
    try {
      let entries = servers;
      if (mode === "append") {
        const existing = new Set(editor.rows.map((r) => r.id.trim()));
        entries = [...toEntries(editor.rows.filter((r) => r.id.trim().length > 0)), ...servers.filter((s) => !existing.has(s.id))];
      }
      if (editor.mode === "live") {
        const res = await api.putMcpServers(entries);
        setEditor((e) => ({ ...e, rows: toRows(res.servers) }));
      } else {
        await api.patchSettingsStrict({ mcp: { servers: entries } });
        setEditor((e) => ({ ...e, rows: toRows(entries) }));
      }
      setImportOpen(false);
      setImportText("");
    } catch (e) {
      const raw = api.errorMessage(e);
      setImportError(t("mcp.errImportFailed", { msg: errText(raw) ?? raw }));
    } finally {
      setImportBusy(false);
    }
  };

  const onImportText = (): void => {
    const parsed = parseImportedJson(importText, t);
    if ("error" in parsed) {
      setImportError(parsed.error);
      return;
    }
    void applyImport(parsed.servers, "replace");
  };

  const onImportFile = (file: File): void => {
    void file.text().then((text) => {
      setImportText(text);
      const parsed = parseImportedJson(text, t);
      if ("error" in parsed) {
        setImportError(parsed.error);
        return;
      }
      void applyImport(parsed.servers, "replace");
    });
  };

  return (
    <>
      {editor.mode === "config" && !editor.loading ? (
        <div className="wiz-banner" role="status" title={t("mcp.settingsHostTitle")}>
          {t("mcp.settingsHostBanner")}
        </div>
      ) : null}

      <SettingsSection title={t("mcp.settingsMergeTitle")} hint={t("mcp.mergeHint")}>
        <SettingsRow label={t("mcp.mergeTools")}>
          <Switch checked={mergeTools} onChange={setMergeTools} label={t("mcp.mergeTools")} />
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={errText(mergeError)} />

      {presets !== null ? (
        <SettingsSection
          title="导入推荐服务器"
          hint={`agent-kit 内置 ${presets.length} 个 MCP 服务器（113 个工具）—— 按 id 合并进下方列表，不影响已有配置`}
        >
          <div className="set-note" role="note">
            默认启用（纯计算，导入即生效，需 MCP 宿主在线）：{presets.filter((p) => p.enabled).map((p) => p.id).join("、")}。默认停用（涉及文件/系统/网络，预置好 env 后在列表中一键开启）：{presets.filter((p) => !p.enabled).map((p) => p.id).join("、")}。
          </div>
          <div className="set-mcp-actions">
            <Button small variant="primary" disabled={presetBusy} onClick={() => void importPresets()}>
              {presetBusy ? "导入中…" : "一键导入推荐服务器"}
            </Button>
            {presetDone !== null ? <span className="chip ok">{presetDone}</span> : null}
          </div>
          <ErrorText>{presetError}</ErrorText>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title={t("mcp.title")}
        hint={t("mcp.settingsServersHint")}
      >
        {editor.loading ? (
          <div className="set-loading">
            <Spinner label={t("mcp.settingsLoading")} />
          </div>
        ) : (
          <>
            <div className="set-mcp-table" role="table" aria-label={t("mcp.settingsTableAria")}>
              <div className="set-mcp-head" role="row">
                <span className="set-mcp-col id" role="columnheader">id</span>
                <span className="set-mcp-col command" role="columnheader">command</span>
                <span className="set-mcp-col args" role="columnheader">{t("mcp.settingsColArgs")}</span>
                <span className="set-mcp-col on" role="columnheader">{t("mcp.settingsColEnabled")}</span>
                <span className="set-mcp-col del" role="columnheader" aria-label={t("mcp.settingsColDeleteAria")} />
              </div>
              {editor.rows.length === 0 ? (
                <div className="set-mcp-empty">
                  {t("mcp.noServers")} — {t("mcp.settingsEmptySub")}
                </div>
              ) : (
                editor.rows.map((r, i) => (
                  <div className="set-mcp-row" role="row" key={i}>
                    <input
                      className="set-input mono set-mcp-col id"
                      value={r.id}
                      placeholder="my-server"
                      aria-label={t("mcp.settingsRowFieldAria", { row: i + 1, field: "id" })}
                      spellCheck={false}
                      onChange={(e) => updateRow(i, { id: e.target.value })}
                    />
                    <input
                      className="set-input mono set-mcp-col command"
                      value={r.command}
                      placeholder="npx"
                      aria-label={t("mcp.settingsRowFieldAria", { row: i + 1, field: "command" })}
                      spellCheck={false}
                      onChange={(e) => updateRow(i, { command: e.target.value })}
                    />
                    <input
                      className="set-input mono set-mcp-col args"
                      value={r.args}
                      placeholder="-y @videoos/mcp-weather"
                      aria-label={t("mcp.settingsRowFieldAria", { row: i + 1, field: "args" })}
                      spellCheck={false}
                      onChange={(e) => updateRow(i, { args: e.target.value })}
                    />
                    <span className="set-mcp-col on">
                      <Switch
                        checked={r.enabled}
                        onChange={(v) => updateRow(i, { enabled: v })}
                        label={t("mcp.settingsRowEnableLabel", { id: r.id.length > 0 ? r.id : t("mcp.settingsRowLabel", { row: i + 1 }) })}
                      />
                    </span>
                    <span className="set-mcp-col del">
                      <button
                        type="button"
                        className="set-mcp-del"
                        aria-label={t("mcp.settingsRowDeleteAria", { row: i + 1 })}
                        title={t("mcp.settingsRowDeleteTitle")}
                        onClick={() => removeRow(i)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="set-mcp-actions">
              <Button small onClick={addRow}>
                {t("mcp.settingsAddServer")}
              </Button>
              <Button small variant="primary" disabled={saving || editor.rows.length === 0} onClick={() => void save()}>
                {saving ? t("mcp.settingsSaving") : t("mcp.settingsSaveList")}
              </Button>
              <span className="spacer" />
              <Button small ghost onClick={() => setImportOpen(true)}>
                {t("mcp.settingsImportJson")}
              </Button>
              <Button small ghost onClick={exportJson} disabled={editor.rows.length === 0}>
                {t("mcp.settingsExportJson")}
              </Button>
            </div>
            <ErrorText>{editorError}</ErrorText>
          </>
        )}
      </SettingsSection>
      <div className="set-note">{t("mcp.settingsNote")}</div>

      {importOpen ? (
        <Modal title={t("mcp.settingsImportJson")} onClose={() => (importBusy ? undefined : setImportOpen(false))}>
          <p className="wiz-confirm-text">{t("mcp.settingsImportModalText")}</p>
          <div className="set-import-actions">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="set-import-file"
              aria-label={t("mcp.settingsImportFileAria")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f !== undefined) onImportFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            className="set-import-text mono"
            rows={8}
            spellCheck={false}
            value={importText}
            placeholder={'{\n  "mcpServers": {\n    "weather": { "command": "npx", "args": ["-y", "mcp-weather"] }\n  }\n}'}
            aria-label={t("mcp.settingsImportTextAria")}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError !== null ? (
            <div className="set-error" role="alert">
              {importError}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={importBusy} onClick={() => setImportOpen(false)}>
              {t("mcp.settingsCancel")}
            </Button>
            <Button variant="primary" disabled={importBusy || importText.trim().length === 0} onClick={onImportText}>
              {importBusy ? t("mcp.settingsImporting") : t("mcp.settingsImportApply")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
