// McpPanel (v0.2 §6 issue #53): slide-over from the left edge, conditional on
// the optional peer @videoos/mcp-host. Server rows (label/id, command, enabled
// switch, running dot, toolCount, lastError, start/stop), a per-server
// collapsible tools list (GET /api/mcp/tools) and the 合并工具到 Agent switch
// (settings.mcp.mergeTools). The host package is absent in the current tree —
// this panel is coded against the frozen contract and verified via the
// unavailable path (chip popover, see SessionList).
import { useEffect, useMemo, useState } from "react";
import { useStudio } from "../../store";
import { Button, ErrorText, Spinner, Switch } from "../ui";
import type { McpAggregatedTool } from "../../api";

export function McpPanel(): JSX.Element {
  const open = useStudio((s) => s.mcpOpen);
  const close = useStudio((s) => s.closeMcpPanel);
  const mcp = useStudio((s) => s.mcp);
  const setEnabled = useStudio((s) => s.setMcpServerEnabled);
  const startServer = useStudio((s) => s.mcpStartServer);
  const stopServer = useStudio((s) => s.mcpStopServer);
  const mergeTools = useStudio((s) => s.settings.values?.mcp?.mergeTools === true);
  const setMergeTools = useStudio((s) => s.setMcpMergeTools);
  const panelError = useStudio((s) => s.permissionsError);
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
    for (const t of mcp.tools ?? []) {
      const list = map.get(t.serverId) ?? [];
      list.push(t);
      map.set(t.serverId, list);
    }
    return map;
  }, [mcp.tools]);

  if (!open) return <></>;

  return (
    <div className="s4-drawer-wrap" role="presentation">
      <div className="s4-drawer-bg" role="presentation" onClick={close} />
      <aside className="s4-drawer mcp-drawer" role="dialog" aria-modal="true" aria-label="MCP 面板">
        <header className="s4-drawer-head">
          <span className="s4-drawer-title">MCP 服务器</span>
          <span className="s4-drawer-sub">{rows.length > 0 ? `${rows.length} 个` : ""}</span>
          <button type="button" className="s4-drawer-close" aria-label="关闭 MCP 面板" onClick={close}>
            ×
          </button>
        </header>

        {mcp.phase === "checking" ? (
          <div className="s4-empty">
            <Spinner label="探测 MCP 宿主…" />
          </div>
        ) : mcp.phase === "unavailable" ? (
          <div className="s4-drawer-body">
            <div className="s4-empty">
              <span>MCP 宿主未安装</span>
              <span className="s4-empty-sub">Agent Kit 交付 @videoos/mcp-host 后此处自动点亮。</span>
              <span className="s4-empty-sub mono">agent-kit/SPEC.md</span>
            </div>
          </div>
        ) : (
          <>
            <div className="s4-drawer-body">
              <ErrorText>{panelError}</ErrorText>
              {rows.length === 0 ? (
                <div className="s4-empty">
                  <span>尚未配置 MCP 服务器</span>
                  <span className="s4-empty-sub">通过 PUT /api/mcp/servers 或 Agent Kit 配置后显示在这里。</span>
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
                        <span className="mcp-tools-chip" title={`${status?.toolCount ?? 0} 个工具`}>
                          {status?.toolCount ?? 0} 工具
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
                          label={`启用 MCP 服务器 ${entry.id}`}
                          title={entry.enabled ? "已启用 — 点击停用" : "已停用 — 点击启用"}
                        />
                        <span className="mcp-state">{status?.running === true ? "运行中" : entry.enabled ? "启动中/已停" : "已停用"}</span>
                        <span className="spacer" />
                        {status?.running === true ? (
                          <Button small ghost disabled={mcp.busy !== null} onClick={() => void stopServer(entry.id)}>
                            停止
                          </Button>
                        ) : (
                          <Button small ghost disabled={mcp.busy !== null || !entry.enabled} onClick={() => void startServer(entry.id)}>
                            启动
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mcp-tools-sec">
                <span className="s4-sec-title">工具清单</span>
                {mcp.tools === null || mcp.tools.length === 0 ? (
                  <div className="s4-empty-sub pad">暂无可用工具 — 启用并运行服务器后显示。</div>
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
                        <span className="mcp-tools-chip">{tools.length} 工具</span>
                      </button>
                      {openTools[serverId] === true ? (
                        <div className="mcp-tool-list">
                          {tools.map((t) => (
                            <div className="mcp-tool" key={`${t.serverId}/${t.name}`}>
                              <span className="mcp-tool-name" title={`mcp_${t.serverId}_${t.name}`}>
                                {t.name}
                              </span>
                              <span className="mcp-tool-desc" title={t.description}>
                                {t.description}
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
                <Switch checked={mergeTools} onChange={setMergeTools} label="合并工具到 Agent" />
                <span className="skills-foot-text">合并工具到 Agent</span>
              </div>
              <span className="skills-foot-hint">
                开启后运行中服务器的工具以 mcp_&lt;server&gt;_&lt;tool&gt; 名称进入 Agent 工具表，并受权限矩阵同管。
              </span>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}
