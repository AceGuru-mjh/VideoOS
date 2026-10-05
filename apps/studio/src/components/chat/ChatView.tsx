// ChatView (v0.2 §3): the chat-first primary shell — three-column responsive
// layout (sessions | stream+composer | context). The left column collapses
// into a drawer below 900px (hamburger), the right column hides below 1200px.
// The IDE remains reachable as 高级模式 via the top-bar toggle.
import { useEffect, useState } from "react";
import { useStudio } from "../../store";
import { basename } from "../../api";
import { Button } from "../ui";
import { SessionList } from "./SessionList";
import { MessageStream } from "./MessageStream";
import { Composer } from "./Composer";
import { ContextPanel } from "./ContextPanel";

export function ChatView(): JSX.Element {
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
          aria-label="打开会话列表"
          title="会话列表"
          onClick={() => setDrawerOpen(true)}
        >
          ☰
        </button>
        <span className="logo" aria-label="VideoOS Studio">
          <span className="glyph">▶</span>
          <span>VideoOS</span>
        </span>
        <span className="chat-title" title={currentSession?.title ?? ""}>
          {currentSession?.title ?? "对话"}
        </span>
        {projectRoot !== null ? (
          <span className="chat-proj" title={projectRoot}>
            {basename(projectRoot)}
          </span>
        ) : null}
        <div className="chat-topbar-right">
          {running ? (
            <span className="indicator" title="Agent 任务执行中">
              <span className="spinner" aria-hidden="true" />
              执行中
            </span>
          ) : null}
          <span className="indicator" title={wsConnected ? "websocket connected" : "websocket disconnected"}>
            <span className={`dot${wsConnected ? " ok" : " err"}`} />
            ws
          </span>
          <Button onClick={() => setUiMode("ide")} title="切换到高级模式（IDE）：场景编辑器、时间线、渲染管线">
            高级模式 IDE
          </Button>
        </div>
      </header>
      <div className="chat-body">
        <SessionList />
        <main className="chat-main" aria-label="对话">
          <MessageStream />
          <Composer />
        </main>
        <ContextPanel />
      </div>
      {drawerOpen ? (
        <div className="chat-drawer-wrap" role="presentation">
          <div className="chat-drawer-bg" role="presentation" onClick={() => setDrawerOpen(false)} />
          <div className="chat-drawer" role="dialog" aria-modal="true" aria-label="会话列表">
            <SessionList onSelected={() => setDrawerOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
