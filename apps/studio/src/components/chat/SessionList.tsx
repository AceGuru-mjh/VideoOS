// SessionList (v0.2 §3): left column of the chat view — search, + 新对话,
// per-row rename (inline) / delete (modal confirm), empty states, footer with
// the default model badge (click → re-run the wizard) and disabled
// Skills / MCP placeholder slots (S4).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { basename } from "../../api";
import { Button, Modal, Spinner } from "../ui";
import { fmtRelTime } from "./util";

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
        <div className="cs-slots">
          <span className="cs-slot" title="Skills 面板即将推出" aria-disabled="true">
            Skills
          </span>
          <span className="cs-slot" title="MCP 面板即将推出" aria-disabled="true">
            MCP
          </span>
        </div>
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
