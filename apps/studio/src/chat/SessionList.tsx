// 会话列表（#51）：搜索过滤、活动高亮、相对时间 + 消息数、
// 行内重命名（✎ → input，Enter 确认 / Esc 取消）、两步删除（✕ → 确认？ → 是/否）。
import { useState, type KeyboardEvent } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { EmptyState, relativeTime } from "./ui";

export function SessionList(): JSX.Element {
  const { t } = useI18n();
  const sessions = useStudio((s) => s.chatSessions);
  const sessionsLoading = useStudio((s) => s.sessionsLoading);
  const activeSessionId = useStudio((s) => s.activeSessionId);
  const selectSession = useStudio((s) => s.selectSession);
  const renameSession = useStudio((s) => s.renameSession);
  const deleteSession = useStudio((s) => s.deleteSession);

  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q.length === 0 ? sessions : sessions.filter((s) => s.title.toLowerCase().includes(q));

  const startRename = (id: string, title: string): void => {
    setRenamingId(id);
    setRenameText(title);
    setConfirmId(null);
  };

  const commitRename = (): void => {
    if (renamingId !== null && renameText.trim().length > 0) void renameSession(renamingId, renameText);
    setRenamingId(null);
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setRenamingId(null);
  };

  return (
    <div className="session-list-wrap">
      <input
        className="session-search"
        type="text"
        value={query}
        placeholder={t("chat.searchSessions")}
        aria-label={t("chat.searchSessions")}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="session-list" role="list">
        {sessionsLoading && sessions.length === 0 ? (
          <div className="skeleton-row" style={{ width: "70%" }} />
        ) : filtered.length === 0 ? (
          <EmptyState>{t("chat.noSessions")}</EmptyState>
        ) : (
          filtered.map((s) => (
            <div key={s.id} role="listitem" className={`session-item${s.id === activeSessionId ? " active" : ""}${confirmId === s.id ? " confirming" : ""}`}>
              {renamingId === s.id ? (
                <input
                  autoFocus
                  className="session-rename"
                  value={renameText}
                  aria-label={t("chat.rename")}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={onRenameKey}
                  onBlur={commitRename}
                />
              ) : (
                <>
                  <button type="button" className="session-main" onClick={() => void selectSession(s.id)} title={s.title}>
                    <span className="session-title">{s.title}</span>
                    <span className="session-meta">
                      {relativeTime(s.updatedAt, t)} · {t("chat.msgCount", { n: s.messageCount })}
                    </span>
                  </button>
                  <span className="session-actions">
                    {confirmId === s.id ? (
                      <span className="confirm-inline">
                        {t("chat.confirmDelete")}
                        <button type="button" className="icon-btn danger" title={t("chat.yes")} onClick={() => {
                          setConfirmId(null);
                          void deleteSession(s.id);
                        }}>
                          {t("chat.yes")}
                        </button>
                        <button type="button" className="icon-btn" title={t("chat.no")} onClick={() => setConfirmId(null)}>
                          {t("chat.no")}
                        </button>
                      </span>
                    ) : (
                      <>
                        <button type="button" className="icon-btn" title={t("chat.rename")} onClick={() => startRename(s.id, s.title)}>
                          ✎
                        </button>
                        <button type="button" className="icon-btn danger" title={t("chat.delete")} onClick={() => setConfirmId(s.id)}>
                          ✕
                        </button>
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
