// VideoOS Studio — app shell: boot (health → workspace or welcome), WS wiring,
// layout composition (SPEC §10.1) + mode routing（chat 默认 / ide 高级模式）。
import { useEffect } from "react";
import * as api from "./api";
import { useStudio } from "./store";
import { Spinner } from "./components/ui";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { Welcome } from "./components/Welcome";
import { ProjectPanel } from "./components/ProjectPanel";
import { EditorPanel } from "./components/EditorPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { Timeline } from "./components/Timeline";
import { AgentPanel } from "./components/AgentPanel";
import { BottomDock } from "./components/BottomDock";
import { RenderDialog } from "./components/RenderDialog";
import { ChatView } from "./chat/ChatView";

export default function App(): JSX.Element {
  const booted = useStudio((s) => s.booted);
  const booting = useStudio((s) => s.booting);
  const project = useStudio((s) => s.project);
  const mode = useStudio((s) => s.mode);

  useEffect(() => {
    const store = useStudio.getState();
    void store.boot();
    const disposeWs = api.connectWs(
      (e) => {
        useStudio.getState().handleEvent(e);
      },
      (connected) => {
        useStudio.getState().setWs(connected);
        if (connected) {
          // re-sync after a possible gap: event backlog + render status
          void useStudio.getState().backfillEvents();
          void useStudio.getState().refreshRenderStatus();
        }
      },
    );
    // light poll: connection count shown in the status bar
    const poll = window.setInterval(() => {
      api
        .getHealth()
        .then((h) => useStudio.getState().setWsCount(h.wsConnections))
        .catch(() => useStudio.getState().setWsCount(0));
    }, 8000);
    return () => {
      disposeWs();
      window.clearInterval(poll);
    };
  }, []);

  return (
    <div id="app">
      <TopBar />
      {!booted || booting ? (
        <div className="boot-screen">
          <Spinner />
          <span>connecting to videoos server…</span>
        </div>
      ) : mode === "chat" ? (
        // 对话优先（v0.2 默认）：无需打开项目即可浏览会话（#51）
        <ChatView />
      ) : project !== null ? (
        <main className="workspace">
          <ProjectPanel />
          <section className="center-col">
            <EditorPanel />
            <BottomDock />
          </section>
          <section className="right-col">
            <div className="preview-col">
              <PreviewPanel />
              <Timeline />
            </div>
            <AgentPanel />
          </section>
        </main>
      ) : (
        <Welcome />
      )}
      <StatusBar />
      <RenderDialog />
    </div>
  );
}
