// SessionList (v0.2 §3 + S4): left column of the chat view — search, + 新对话,
// per-row rename (inline) / delete (modal confirm), empty states and the
// footer: default model badge (click → re-run the wizard) + the S4 feature
// chips — Skills panel, MCP panel (dim 未安装 until the optional host package
// lands) and the Agent 权限 modal.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { basename } from "../../api";
import { Button, Modal, Spinner } from "../ui";
import { fmtRelTime } from "./util";

/** MCP 未安装 informational popover (anchored above the footer chip). */
function McpPopover(): JSX.Element {
  const setMcpPopover = useStudio((s) => s.setMcpPopover);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setMcpPopover(false);
    };
    const onKey = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === "Escape") setMcpPopover(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [setMcpPopover]);

  return (
    <div className="mcp-popover" role="dialog" aria-label="MCP 宿主未安装" ref={ref}>
      <div className="mcp-popover-title">MCP 宿主未安装</div>
      <div className="mcp-popover-text">Agent Kit 交付 @videoos/mcp-host 后此处自动点亮。</div>
      <div className="mcp-popover-path mono" title="宿主契约规格">
        agent-kit/SPEC.md
      </div>
      <button type="button" className="mcp-popover-close" aria-label="关闭提示" onClick={() => setMcpPopover(false)}>
        知道了
      </button>
    </div>
  );
}

/** The S4 footer chips: Skills / MCP / 权限 + the S6 设置 chip. */
function FooterChips(): JSX.Element {
  const openSkillsPanel = useStudio((s) => s.openSkillsPanel);
  const openMcpPanel = useStudio((s) => s.openMcpPanel);
  const openPermissions = useStudio((s) => s.openPermissions);
  const openSettings = useStudio((s) => s.openSettings);
  const mcpPhase = useStudio((s) => s.mcp.phase);
  const mcpPopoverOpen = useStudio((s) => s.mcpPopoverOpen);
  const skillsSnapshot = useStudio((s) => s.skills.snapshot);
  const pendingConfirms = useStudio((s) => s.pendingConfirms.filter((c) => c.status === "pending").length);

  const enabledSkills = skillsSnapshot?.skills.filter((s) => s.enabled).length ?? null;

  return (
    <div className="cs-slots">
      <button type="button" className="cs-slot-btn" onClick={openSkillsPanel} title="技能面板 — 列表 / 搜索 / 启停 / @ 引用">
        <span className="cs-slot-label">Skills</span>
        <span className="cs-slot-sub">{enabledSkills !== null ? `${enabledSkills} 个启用` : ""}</span>
      </button>
      <span className="cs-slot-wrap">
        <button
          type="button"
          className={`cs-slot-btn${mcpPhase === "unavailable" ? " dim" : ""}`}
          onClick={() => void openMcpPanel()}
          title={mcpPhase === "unavailable" ? "MCP 宿主未安装 — 点击查看详情" : "MCP 服务器面板"}
          aria-haspopup="dialog"
          aria-expanded={mcpPopoverOpen}
        >
          <span className="cs-slot-label">{mcpPhase === "checking" ? <Spinner /> : "MCP"}</span>
          <span className="cs-slot-sub">{mcpPhase === "unavailable" ? "未安装" : mcpPhase === "available" ? "可用" : ""}</span>
        </button>
        {mcpPopoverOpen ? <McpPopover /> : null}
      </span>
      <button
        type="button"
        className="cs-slot-btn"
        onClick={openPermissions}
        title="Agent 权限 — 自主级别 L1-L4 / 工具权限矩阵 / 危险命令黑名单"
      >
        <span className="cs-slot-label">权限{pendingConfirms > 0 ? <span className="cs-slot-badge" aria-label={`${pendingConfirms} 个待确认`} /> : null}</span>
        <span className="cs-slot-sub">{pendingConfirms > 0 ? `${pendingConfirms} 待确认` : ""}</span>
      </button>
      <button
        type="button"
        className="cs-slot-btn"
        onClick={openSettings}
        title="设置 — 通用 / 模型 / Agent / 渲染 / MCP / Skills / 界面 / 隐私 / 高级"
      >
        <span className="cs-slot-label">设置</span>
        <span className="cs-slot-sub">九大类</span>
      </button>
    </div>
  );
}

function ModelBadge(): JSX.Element {
  const [snap, setSnap] = useState<api.ProvidersSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const setWizardActive = useStudio((s) => s.setWizardActive);

  useEffect(() => {
    let alive = true;
    api
      .getProviders()
      .then((s) => {
        if (!alive) return;
        setSnap(s);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  let dot: JSX.Element;
  let name: string;
  let model: string | null = null;
  if (!loaded) {
    dot = <span className="dot" />;
    name = "加载模型配置…";
  } else if (snap === null) {
    dot = <span className="dot" />;
    name = "模型服务不可用";
  } else if (snap.entries.length === 0 || snap.defaultProvider === null) {
    dot = <span className="dot err" />;
    name = "未配置模型";
  } else {
    const entry = snap.entries.find((e) => e.id === snap.defaultProvider);
    const label = entry?.label !== undefined && entry.label.length > 0 ? entry.label : (entry?.id ?? snap.defaultProvider);
    dot = <span className="dot ok" />;
    name = label;
    model = snap.defaultModel !== null ? snap.defaultModel.split("/").pop() ?? snap.defaultModel : (entry?.model ?? null);
  }
  return (
    <button
      type="button"
      className="cs-model"
      onClick={() => setWizardActive(true)}
      title="点击打开模型配置向导（重新配置供应商 / 默认模型 / 演示模式）"
    >
      {dot}
      <span className="cs-model-body">
        <span className="cs-model-name">{name}</span>
        {model !== null ? <span className="cs-model-model">{model}</span> : null}
      </span>
    </button>
  );
}

export function SessionList({ onSelected }: { onSelected?: () => void }): JSX.Element {
  const sessions = useStudio((s) => s.sessions);
  const sessionsUnavailable = useStudio((s) => s.sessionsUnavailable);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const currentSession = useStudio((s) => s.currentSession);
  const selectSession = useStudio((s) => s.selectSession);
  const newSession = useStudio((s) => s.newSession);
  const renameSession = useStudio((s) => s.renameSession);
  const deleteSession = useStudio((s) => s.deleteSession);

  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<api.SessionSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming !== null) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const q = search.trim().toLowerCase();
  const filtered =
    q.length === 0
      ? sessions
      : sessions.filter(
          (s) =>
            s.title.toLowerCase().includes(q) || (s.projectRoot !== null && basename(s.projectRoot).toLowerCase().includes(q)),
        );

  const create = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    try {
      await newSession();
      onSelected?.();
    } finally {
      setCreating(false);
    }
  };

  const commitRename = (): void => {
    if (renaming === null) return;
    const id = renaming;
    const value = renameValue;
    setRenaming(null);
    if (value.trim().length > 0) void renameSession(id, value);
  };

  const onRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRenaming(null);
    }
  };

  return (
    <aside className="chat-sessions" aria-label="会话列表">
      <div className="cs-head">
        <span className="cs-head-title">对话</span>
        <button type="button" className="cs-new" onClick={() => void create()} disabled={creating} title="新建对话">
          {creating ? <Spinner /> : "+ 新对话"}
        </button>
      </div>
      <div className="cs-search">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索对话…"
          aria-label="搜索对话"
        />
      </div>
      <div className="cs-list" role="list">
        {sessionsUnavailable && sessions.length === 0 ? (
          <div className="cs-empty">
            <span>会话服务不可用</span>
            <span className="cs-empty-sub">当前服务端版本不支持对话，请升级到 v0.2 S3 之后的服务端。</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="cs-empty">
            {sessions.length === 0 ? (
              <>
                <span>还没有对话</span>
                <span className="cs-empty-sub">点击「+ 新对话」，或直接在输入框发消息。</span>
              </>
            ) : (
              <span>没有匹配「{search}」的对话</span>
            )}
          </div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} className={`cs-row${s.id === currentSessionId ? " active" : ""}`} role="listitem">
              {renaming === s.id ? (
                <div className="cs-rename">
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={onRenameKeyDown}
                    onBlur={commitRename}
                    aria-label="新名称"
                    maxLength={60}
                  />
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="cs-main"
                    onClick={() => {
                      void selectSession(s.id);
                      onSelected?.();
                    }}
                    title={s.projectRoot !== null ? `${s.title} — ${s.projectRoot}` : s.title}
                    aria-current={s.id === currentSessionId ? "true" : undefined}
                  >
                    <span className="cs-name">{s.title}</span>
                    <span className="cs-meta">
                      <span>{fmtRelTime(s.updatedAt)}</span>
                      <span>{s.messageCount} 条消息</span>
                    </span>
                  </button>
                  <span className="cs-actions">
                    <button
                      type="button"
                      className="cs-act"
                      aria-label="重命名对话"
                      title="重命名"
                      onClick={() => {
                        setRenaming(s.id);
                        setRenameValue(s.title);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="cs-act del"
                      aria-label="删除对话"
                      title="删除"
                      onClick={() => setDeleteTarget(s)}
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </div>
      <div className="cs-footer">
        <ModelBadge />
        <FooterChips />
        {currentSession !== null && currentSession.projectRoot !== null ? (
          <div className="cs-proj" title={currentSession.projectRoot}>
            项目 · {basename(currentSession.projectRoot)}
          </div>
        ) : null}
      </div>

      {deleteTarget !== null ? (
        <Modal title="删除对话" onClose={() => setDeleteTarget(null)}>
          <p className="wiz-confirm-text">
            删除「{deleteTarget.title}」后无法恢复（共 {deleteTarget.messageCount} 条消息）。确定删除吗？
          </p>
          <div className="modal-footer">
            <Button onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              className="danger"
              onClick={() => {
                void deleteSession(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              删除
            </Button>
          </div>
        </Modal>
      ) : null}
    </aside>
  );
}
