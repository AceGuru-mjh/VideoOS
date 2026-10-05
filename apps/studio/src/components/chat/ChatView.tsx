// ChatView (v0.2 §3): the chat-first primary shell — three-column responsive
// layout (sessions | stream+composer | context). The left column collapses
// into a drawer below 900px (hamburger), the right column hides below 1200px.
// The IDE remains reachable as 高级模式 via the top-bar toggle.
import { useEffect, useState } from "react";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { basename } from "../../api";
import { Button } from "../ui";
import { SessionList } from "./SessionList";
import { MessageStream } from "./MessageStream";
import { Composer } from "./Composer";
import { ContextPanel } from "./ContextPanel";
import { SkillsPanel } from "./SkillsPanel";
import { McpPanel } from "./McpPanel";
import { PermissionsModal } from "./PermissionsModal";

export function ChatView(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const currentSession = useStudio((s) => s.currentSession);
  const setUiMode = useStudio((s) => s.setUiMode);
  const wsConnected = useStudio((s) => s.wsConnected);
  const activeRun = useStudio((s) => s.activeRun);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // close the drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const running = activeRun !== null && activeRun.status === "running";
  const projectRoot = currentSession?.projectRoot ?? null;

  return (
    <div className="chat-shell">
      <header className="chat-topbar">
        <button
          type="button"
          className="chat-burger"
          aria-label={t("chatView.openSessionsAria")}
          title={t("chatView.sessionsTitle")}
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <span className="logo" aria-label="VideoOS Studio">
          <span className="glyph">▶</span>
          <span>VideoOS</span>
        </span>
        <span className="chat-title" title={currentSession?.title ?? ""}>
          {currentSession?.title ?? t("chatView.defaultTitle")}
        </span>
        {projectRoot !== null ? (
          <span className="chat-proj" title={projectRoot}>
            {basename(projectRoot)}
          </span>
        ) : null}
        <div className="chat-topbar-right">
          {running ? (
            <span className="indicator" title={t("chatView.runningTitle")}>
              <span className="spinner" aria-hidden="true" />
              {t("chatView.running")}
            </span>
          ) : null}
          <div className="seg-toggle" role="group" aria-label={t("topbar.languageSwitcher")}>
            <button type="button" className={`seg-btn${locale === "zh" ? " active" : ""}`} aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>
              {t("topbar.langZh")}
            </button>
            <button type="button" className={`seg-btn${locale === "en" ? " active" : ""}`} aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
              {t("topbar.langEn")}
            </button>
          </div>
          <span className="indicator" title={wsConnected ? t("topbar.wsConnected") : t("topbar.wsDisconnected")}>
            <span className={`dot${wsConnected ? " ok" : " err"}`} />
            ws
          </span>
          <Button onClick={() => setUiMode("ide")} title={t("chatView.ideTitle")}>
            {t("chatView.ide")}
          </Button>
        </div>
      </header>
      <div className="chat-body">
        <SessionList />
        <main className="chat-main" aria-label={t("chatView.mainAria")}>
          <MessageStream />
          <Composer />
        </main>
        <ContextPanel />
      </div>
      {drawerOpen ? (
        <div className="chat-drawer-wrap" role="presentation">
          <div className="chat-drawer-bg" role="presentation" onClick={() => setDrawerOpen(false)} />
          <div className="chat-drawer" role="dialog" aria-modal="true" aria-label={t("chatView.sessionsTitle")}>
            <SessionList onSelected={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}
      {/* S4 (v0.2 §6): skills / mcp slide-overs + agent permissions modal */}
      <SkillsPanel />
      <McpPanel />
      <PermissionsModal />
    </div>
  );
}
