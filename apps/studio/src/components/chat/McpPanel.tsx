// McpPanel (v0.2 §6 issue #53): slide-over from the left edge, conditional on
// the optional peer @videoos/mcp-host. Server rows (label/id, command, enabled
// switch, running dot, toolCount, lastError, start/stop), a per-server
// collapsible tools list (GET /api/mcp/tools) and the 合并工具到 Agent switch
// (settings.mcp.mergeTools). The host package is absent in the current tree —
// this panel is coded against the frozen contract and verified via the
// unavailable path (chip popover, see SessionList).
import { useEffect, useMemo, useState } from "react";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { Button, ErrorText, Spinner, Switch } from "../ui";
import type { McpAggregatedTool } from "../../api";

export function McpPanel(): JSX.Element {
  const { t } = useI18n();
  const open = useStudio((s) => s.mcpOpen);
  const close = useStudio((s) => s.closeMcpPanel);
  const mcp = useStudio((s) => s.mcp);
  const setEnabled = useStudio((s) => s.setMcpServerEnabled);
  const startServer = useStudio((s) => s.mcpStartServer);
  const stopServer = useStudio((s) => s.mcpStopServer);
  const mergeTools = useStudio((s) => s.settings.values?.mcp?.mergeTools === true);
  const setMergeTools = useStudio((s) => s.setMcpMergeTools);
  const panelError = useStudio((s) => s.permissionsError);
  const errText = useApiErrorMessage();
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({});

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const rows = useMemo(() => {
    const entries = mcp.entries ?? [];
    const statusById = new Map((mcp.status ?? []).map((s) => [s.id, s]));
    return entries.map((e) => ({ entry: e, status: statusById.get(e.id) ?? null }));
  }, [mcp.entries, mcp.status]);

  const toolsByServer = useMemo(() => {
    const map = new Map<string, McpAggregatedTool[]>();
    for (const tool of mcp.tools ?? []) {
      const list = map.get(tool.serverId) ?? [];
      list.push(tool);
      map.set(tool.serverId, list);
    }
    return map;
  }, [mcp.tools]);

  if (!open) return <></>;

  return (
    <div className="s4-drawer-wrap" role="presentation">
      <div className="s4-drawer-bg" role="presentation" onClick={close} />
      <aside className="s4-drawer mcp-drawer" role="dialog" aria-modal="true" aria-label={t("mcp.panelAria")}>
        <header className="s4-drawer-head">
          <span className="s4-drawer-title">{t("mcp.title")}</span>
          <span className="s4-drawer-sub">{rows.length > 0 ? t("mcp.count", { n: rows.length }) : ""}</span>
          <button type="button" className="s4-drawer-close" aria-label={t("mcp.closeAria")} onClick={close}>
            ×
          </button>
        </header>

        {mcp.phase === "checking" ? (
          <div className="s4-empty">
            <Spinner label={t("mcp.checking")} />
          </div>
        ) : mcp.phase === "unavailable" ? (
          <div className="s4-drawer-body">
            <div className="s4-empty">
              <span>{t("mcp.hostNotInstalled")}</span>
              <span className="s4-empty-sub">{t("mcp.hostPendingText")}</span>
              <span className="s4-empty-sub mono">agent-kit/SPEC.md</span>
            </div>
          </div>
        ) : (
          <>
            <div className="s4-drawer-body">
              <ErrorText>{errText(panelError)}</ErrorText>
              {rows.length === 0 ? (
                <div className="s4-empty">
                  <span>{t("mcp.noServers")}</span>
                  <span className="s4-empty-sub">{t("mcp.noServersSub")}</span>
                </div>
              ) : (
                <div className="s4-list" role="list">
                  {rows.map(({ entry, status }) => (
                    <div className={`mcp-server${mcp.busy === entry.id ? " busy" : ""}`} key={entry.id} role="listitem">
                      <div className="mcp-server-top">
                        <span className={`mcp-dot${status?.running === true ? " run" : ""}`} aria-hidden="true" />
                        <span className="mcp-server-name" title={entry.label ?? entry.id}>
                          {entry.label ?? entry.id}
                        </span>
                        <span className="mcp-server-id">{entry.id}</span>
                        <span className="mcp-tools-chip" title={t("mcp.toolCount", { n: status?.toolCount ?? 0 })}>
                          {t("mcp.toolsChip", { n: status?.toolCount ?? 0 })}
                        </span>
                      </div>
                      <div className="mcp-cmd" title={`${entry.command} ${entry.args.join(" ")}`}>
                        {entry.command} {entry.args.join(" ")}
                      </div>
                      {status?.lastError !== undefined ? (
                        <div className="mcp-err" role="alert" title={status.lastError}>
                          {status.lastError}
                        </div>
                      ) : null}
                      <div className="mcp-server-acts">
                        {mcp.busy === entry.id ? <Spinner /> : null}
                        <Switch
                          checked={entry.enabled}
                          disabled={mcp.busy !== null}
                          onChange={(v) => void setEnabled(entry.id, v)}
                          label={t("mcp.enableLabel", { id: entry.id })}
                          title={entry.enabled ? t("mcp.enabledTitle") : t("mcp.disabledTitle")}
                        />
                        <span className="mcp-state">{status?.running === true ? t("mcp.running") : entry.enabled ? t("mcp.startingOrStopped") : t("mcp.disabled")}</span>
                        <span className="spacer" />
                        {status?.running === true ? (
                          <Button small ghost disabled={mcp.busy !== null} onClick={() => void stopServer(entry.id)}>
                            {t("mcp.stop")}
                          </Button>
                        ) : (
                          <Button small ghost disabled={mcp.busy !== null || !entry.enabled} onClick={() => void startServer(entry.id)}>
                            {t("mcp.start")}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mcp-tools-sec">
                <span className="s4-sec-title">{t("mcp.toolsTitle")}</span>
                {mcp.tools === null || mcp.tools.length === 0 ? (
                  <div className="s4-empty-sub pad">{t("mcp.noTools")}</div>
                ) : (
                  [...toolsByServer.entries()].map(([serverId, tools]) => (
                    <div className="mcp-tool-group" key={serverId}>
                      <button
                        type="button"
                        className="mcp-tool-group-head"
                        aria-expanded={openTools[serverId] === true}
                        onClick={() => setOpenTools((s) => ({ ...s, [serverId]: !(s[serverId] === true) }))}
                      >
                        <span className={`mcp-caret${openTools[serverId] === true ? " open" : ""}`} aria-hidden="true">
                          ▸
                        </span>
                        <span className="mcp-server-id">{serverId}</span>
                        <span className="mcp-tools-chip">{t("mcp.toolsChip", { n: tools.length })}</span>
                      </button>
                      {openTools[serverId] === true ? (
                        <div className="mcp-tool-list">
                          {tools.map((tool) => (
                            <div className="mcp-tool" key={`${tool.serverId}/${tool.name}`}>
                              <span className="mcp-tool-name" title={`mcp_${tool.serverId}_${tool.name}`}>
                                {tool.name}
                              </span>
                              <span className="mcp-tool-desc" title={tool.description}>
                                {tool.description}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <footer className="skills-foot">
              <div className="skills-foot-row">
                <Switch checked={mergeTools} onChange={setMergeTools} label={t("mcp.mergeTools")} />
                <span className="skills-foot-text">{t("mcp.mergeTools")}</span>
              </div>
              <span className="skills-foot-hint">{t("mcp.mergeHint")}</span>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
