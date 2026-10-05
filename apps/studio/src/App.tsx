// VideoOS Studio — app shell: boot (settings → wizard | health → workspace or
// welcome), WS wiring, layout composition (SPEC §10.1, v0.2 §2).
import { useEffect } from "react";
import * as api from "./api";
import { useStudio } from "./store";
import { Spinner } from "./components/ui";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { Welcome } from "./components/Welcome";
import { Wizard } from "./components/wizard/Wizard";
import { ProjectPanel } from "./components/ProjectPanel";
import { EditorPanel } from "./components/EditorPanel";
import { PreviewPanel } from "./components/PreviewPanel";
import { Timeline } from "./components/Timeline";
import { AgentPanel } from "./components/AgentPanel";
import { BottomDock } from "./components/BottomDock";
import { RenderDialog } from "./components/RenderDialog";

export default function App(): JSX.Element {
  const booted = useStudio((s) => s.booted);
  const booting = useStudio((s) => s.booting);
  const project = useStudio((s) => s.project);
  const wizardActive = useStudio((s) => s.wizardActive);

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
      {wizardActive ? (
        // first-run / forced wizard replaces the whole shell (v0.2 §2)
        <Wizard />
      ) : (
        <>
          <TopBar />
          {!booted || booting ? (
            <div className="boot-screen">
              <Spinner />
              <span>connecting to videoos server…</span>
            </div>
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
        </>
      )}
    </div>
  );
}
