// SessionList (v0.2 §3 + S4): left column of the chat view — search, + 新对话,
// per-row rename (inline) / delete (modal confirm), empty states and the
// footer: default model badge (click → re-run the wizard) + the S4 feature
// chips — Skills panel, MCP panel (dim 未安装 until the optional host package
// lands) and the Agent 权限 modal.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { basename } from "../../api";
import { Button, Modal, Spinner } from "../ui";
import { fmtRelTime } from "./util";

/** MCP 未安装 informational popover (anchored above the footer chip). */
function McpPopover(): JSX.Element {
  const { t } = useI18n();
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
    <div className="mcp-popover" role="dialog" aria-label={t("sessions.popoverAria")} ref={ref}>
      <div className="mcp-popover-title">{t("sessions.popoverTitle")}</div>
      <div className="mcp-popover-text">{t("sessions.popoverText")}</div>
      <div className="mcp-popover-path mono" title={t("sessions.popoverPathTitle")}>
        agent-kit/SPEC.md
      </div>
      <button type="button" className="mcp-popover-close" aria-label={t("sessions.popoverCloseAria")} onClick={() => setMcpPopover(false)}>
        {t("sessions.popoverGotIt")}
      </button>
    </div>
  );
}

/** The S4 footer chips: Skills / MCP / 权限 + the S6 设置 chip. */
function FooterChips(): JSX.Element {
  const { t } = useI18n();
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
      <button type="button" className="cs-slot-btn" onClick={openSkillsPanel} title={t("sessions.skillsChipTitle")}>
        <span className="cs-slot-label">{t("sessions.skillsChipLabel")}</span>
        <span className="cs-slot-sub">{enabledSkills !== null ? t("sessions.skillsChipEnabled", { n: enabledSkills }) : ""}</span>
      </button>
      <span className="cs-slot-wrap">
        <button
          type="button"
          className={`cs-slot-btn${mcpPhase === "unavailable" ? " dim" : ""}`}
          onClick={() => void openMcpPanel()}
          title={mcpPhase === "unavailable" ? t("sessions.mcpChipTitleUnavailable") : t("sessions.mcpChipTitle")}
          aria-haspopup="dialog"
          aria-expanded={mcpPopoverOpen}
        >
          <span className="cs-slot-label">{mcpPhase === "checking" ? <Spinner /> : t("sessions.mcpChipLabel")}</span>
          <span className="cs-slot-sub">{mcpPhase === "unavailable" ? t("sessions.mcpChipNotInstalled") : mcpPhase === "available" ? t("sessions.mcpChipAvailable") : ""}</span>
        </button>
        {mcpPopoverOpen ? <McpPopover /> : null}
      </span>
      <button
        type="button"
        className="cs-slot-btn"
        onClick={openPermissions}
        title={t("sessions.permsChipTitle")}
      >
        <span className="cs-slot-label">{t("sessions.permsChipLabel")}{pendingConfirms > 0 ? <span className="cs-slot-badge" aria-label={t("sessions.permsBadgeAria", { n: pendingConfirms })} /> : null}</span>
        <span className="cs-slot-sub">{pendingConfirms > 0 ? t("sessions.permsChipPending", { n: pendingConfirms }) : ""}</span>
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
  const { t } = useI18n();
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
    name = t("sessions.modelLoading");
  } else if (snap === null) {
    dot = <span className="dot" />;
    name = t("sessions.modelUnavailable");
  } else if (snap.entries.length === 0 || snap.defaultProvider === null) {
    dot = <span className="dot err" />;
    name = t("sessions.modelNotConfigured");
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
      title={t("sessions.modelBadgeTitle")}
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
  const { t } = useI18n();
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
    <aside className="chat-sessions" aria-label={t("chatView.sessionsTitle")}>
      <div className="cs-head">
        <span className="cs-head-title">{t("sessions.headerTitle")}</span>
        <button type="button" className="cs-new" onClick={() => void create()} disabled={creating} title={t("sessions.newChatTitle")}>
          {creating ? <Spinner /> : t("sessions.newChatBtn")}
        </button>
      </div>
      <div className="cs-search">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("sessions.searchPlaceholder")}
          aria-label={t("sessions.searchAria")}
        />
      </div>
      <div className="cs-list" role="list">
        {sessionsUnavailable && sessions.length === 0 ? (
          <div className="cs-empty">
            <span>{t("chatStream.unavailableTitle")}</span>
            <span className="cs-empty-sub">{t("sessions.unavailableSubShort")}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="cs-empty">
            {sessions.length === 0 ? (
              <>
                <span>{t("sessions.noChats")}</span>
                <span className="cs-empty-sub">{t("sessions.noChatsSub")}</span>
              </>
            ) : (
              <span>{t("sessions.noMatch", { query: search })}</span>
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
                    aria-label={t("sessions.newNameAria")}
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
                      <span>{fmtRelTime(s.updatedAt, t)}</span>
                      <span>{t("sessions.messageCount", { n: s.messageCount })}</span>
                    </span>
                  </button>
                  <span className="cs-actions">
                    <button
                      type="button"
                      className="cs-act"
                      aria-label={t("sessions.renameAria")}
                      title={t("sessions.renameTitle")}
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
                      aria-label={t("sessions.deleteAria")}
                      title={t("sessions.deleteTitle")}
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
            {t("sessions.projectChip", { name: basename(currentSession.projectRoot) })}
          </div>
        ) : null}
      </div>

      {deleteTarget !== null ? (
        <Modal title={t("sessions.deleteModalTitle")} onClose={() => setDeleteTarget(null)}>
          <p className="wiz-confirm-text">
            {t("sessions.deleteConfirm", { title: deleteTarget.title, count: deleteTarget.messageCount })}
          </p>
          <div className="modal-footer">
            <Button onClick={() => setDeleteTarget(null)}>{t("sessions.cancel")}</Button>
            <Button
              className="danger"
              onClick={() => {
                void deleteSession(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {t("sessions.deleteConfirmBtn")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </aside>
  );
}
