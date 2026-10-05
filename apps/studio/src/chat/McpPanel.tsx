// MCP 面板（#53 UI）：host 可用（status.available）才渲染，否则整体隐藏（入口自隐藏）。
// 服务器卡片（运行/停止/异常徽章 + 可折叠工具清单）+ mergeTools 设置开关 +
// 增删服务器（PUT /api/mcp/servers 全量表；501 → 行内错误文案）。
import { useEffect, useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Badge, Collapse, EmptyState, Toggle } from "./ui";
import type { BadgeTone } from "./ui";

function serverBadge(server: api.McpServerStatus, t: (k: string) => string): { tone: BadgeTone; text: string } {
  if (!server.healthy) return { tone: "err", text: t("mcp.unhealthy") };
  if (server.running) return { tone: "ok", text: t("mcp.running") };
  if (server.enabled) return { tone: "warn", text: t("mcp.stopped") };
  return { tone: "dim", text: t("mcp.disabled") };
}

interface AddForm {
  name: string;
  command: string;
  args: string;
  enabled: boolean;
}

const EMPTY_FORM: AddForm = { name: "", command: "", args: "", enabled: true };

export function McpPanel({ open, onToggle }: { open: boolean; onToggle: () => void }): JSX.Element | null {
  const { t } = useI18n();
  const mcpStatus = useStudio((s) => s.mcpStatus);
  const settings = useStudio((s) => s.settings);
  const loadMcpStatus = useStudio((s) => s.loadMcpStatus);
  const setMergeTools = useStudio((s) => s.setMergeTools);

  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openTools, setOpenTools] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);

  // 挂载即探测（面板仅在右栏可见时挂载/展开后由 RightRail 触发刷新）
  useEffect(() => {
    void loadMcpStatus();
  }, [loadMcpStatus]);

  // 不可用 → 入口自隐藏（#53）
  if (mcpStatus === null || !mcpStatus.available) return null;

  const mergeTools = settings?.mcp.mergeTools ?? false;

  const describeError = (err: unknown): string =>
    err instanceof api.ApiError && err.status === 501 ? t("mcp.unavailableError") : api.errorMessage(err);

  /** 增/删后全量 PUT 服务器表 */
  const putServers = async (mutate: (servers: Record<string, api.McpServerEntry>) => Record<string, api.McpServerEntry>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const current = await api.getMcpServers();
      await api.putMcpServers(mutate({ ...current.servers }));
      await loadMcpStatus();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitAdd = async (): Promise<void> => {
    const name = form.name.trim();
    const command = form.command.trim();
    if (name.length === 0 || command.length === 0) return;
    const args = form.args.trim().split(/\s+/).filter((a) => a.length > 0);
    const ok = await putServers((servers) => {
      servers[name] = { command, args, env: {}, enabled: form.enabled, whitelist: [], timeoutMs: 30_000 };
      return servers;
    });
    if (ok) {
      setForm(EMPTY_FORM);
      setAddOpen(false);
    }
  };

  return (
    <Collapse
      title={t("mcp.title")}
      open={open}
      onToggle={onToggle}
      actions={<Badge tone={mcpStatus.running ? "ok" : "dim"}>{mcpStatus.running ? t("mcp.running") : t("mcp.stopped")}</Badge>}
    >
      <div className="rail-setting">
        <span className="rail-setting-label" title={t("mcp.mergeHint")}>
          {t("mcp.mergeTools")}
        </span>
        {settingsError ? <span className="settings-error" role="alert">{t("settings.saveFailed")}</span> : null}
        <Toggle
          checked={mergeTools}
          onChange={(v) => {
            setSettingsError(false);
            void setMergeTools(v).then((ok) => setSettingsError(!ok));
          }}
          label={t("mcp.mergeTools")}
        />
      </div>
      {mergeTools ? <div className="mcp-merge-hint">{t("mcp.mergeHint")}</div> : null}
      <div className="mcp-server-list">
        {mcpStatus.servers.length === 0 ? (
          <EmptyState>{t("mcp.noServers")}</EmptyState>
        ) : (
          mcpStatus.servers.map((server) => {
            const badge = serverBadge(server, t);
            return (
              <div key={server.name} className="mcp-card">
                <div className="mcp-card-head">
                  <button
                    type="button"
                    className="mcp-server-name"
                    onClick={() => setOpenTools((cur) => (cur === server.name ? null : server.name))}
                    aria-expanded={openTools === server.name}
                    title={server.toolCount > 0 ? t("mcp.toolCount", { n: server.toolCount }) : t("mcp.noTools")}
                  >
                    <span className="chev" aria-hidden="true">
                      {openTools === server.name ? "▾" : "▸"}
                    </span>
                    {server.name}
                    <span className="mcp-tool-count">{t("mcp.toolCount", { n: server.toolCount })}</span>
                  </button>
                  <Badge tone={badge.tone}>{badge.text}</Badge>
                  {confirmDelete === server.name ? (
                    <span className="confirm-inline">
                      {t("mcp.confirmDelete")}
                      <button
                        type="button"
                        className="icon-btn danger"
                        title={t("mcp.delete")}
                        disabled={busy}
                        onClick={() => {
                          setConfirmDelete(null);
                          void putServers((servers) => Object.fromEntries(Object.entries(servers).filter(([k]) => k !== server.name)));
                        }}
                      >
                        {t("chat.yes")}
                      </button>
                      <button type="button" className="icon-btn" title={t("mcp.cancel")} onClick={() => setConfirmDelete(null)}>
                        {t("chat.no")}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn danger"
                      title={t("mcp.delete")}
                      disabled={busy}
                      onClick={() => setConfirmDelete(server.name)}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {openTools === server.name ? (
                  <div className="mcp-tools">
                    {server.tools.length === 0 ? (
                      <span className="empty-note">{t("mcp.noTools")}</span>
                    ) : (
                      server.tools.map((tool) => (
                        <div key={tool.name} className="mcp-tool" title={tool.description}>
                          <span className="mcp-tool-name">{tool.name}</span>
                          <span className="mcp-tool-desc">{tool.description}</span>
                        </div>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {addOpen ? (
        <div className="mcp-add-form">
          <input
            className="mcp-add-field"
            type="text"
            value={form.name}
            placeholder={t("mcp.name")}
            aria-label={t("mcp.name")}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="mcp-add-field"
            type="text"
            value={form.command}
            placeholder={t("mcp.command")}
            aria-label={t("mcp.command")}
            onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
          />
          <input
            className="mcp-add-field"
            type="text"
            value={form.args}
            placeholder={t("mcp.args")}
            aria-label={t("mcp.args")}
            onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
          />
          <div className="rail-setting">
            <span className="rail-setting-label">{t("mcp.enabled")}</span>
            <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label={t("mcp.enabled")} />
          </div>
          <div className="mcp-add-actions">
            <button
              type="button"
              className="btn small primary"
              disabled={busy || form.name.trim().length === 0 || form.command.trim().length === 0}
              onClick={() => void submitAdd()}
            >
              {t("mcp.add")}
            </button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => setAddOpen(false)}>
              {t("mcp.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn small ghost mcp-add-btn" disabled={busy} onClick={() => setAddOpen(true)}>
          + {t("mcp.addServer")}
        </button>
      )}
      {error !== null ? (
        <div className="error-text" role="alert">
          {error}
        </div>
      ) : null}
    </Collapse>
  );
}
