// BottomDock: tabbed container — Diagnostics | Tests | Agent | Events.
import { useStudio } from "../store";
import type { DockTab } from "../store";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TestsPanel } from "./TestsPanel";
import { AgentPanel } from "./AgentPanel";
import { EventsPanel } from "./EventsPanel";

const TABS: Array<{ id: DockTab; label: string }> = [
  { id: "diagnostics", label: "Diagnostics" },
  { id: "tests", label: "Tests" },
  { id: "agent", label: "Agent" },
  { id: "events", label: "Events" },
];

export function BottomDock(): JSX.Element {
  const dockTab = useStudio((s) => s.dockTab);
  const setDockTab = useStudio((s) => s.setDockTab);
  const errorCount = useStudio((s) => (s.compile?.diagnostics ?? []).filter((d) => d.level === "error").length);
  const failedTests = useStudio((s) => s.tests?.totalFailed ?? 0);

  return (
    <section className="dock" aria-label="Diagnostics, tests, agent and events">
      <div className="dock-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={dockTab === t.id}
            className={`dock-tab${dockTab === t.id ? " active" : ""}`}
            onClick={() => setDockTab(t.id)}
          >
            {t.label}
            {t.id === "diagnostics" && errorCount > 0 ? <span className="badge err">{errorCount}</span> : null}
            {t.id === "tests" && failedTests > 0 ? <span className="badge err">{failedTests}</span> : null}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel">
        {dockTab === "diagnostics" ? <DiagnosticsPanel /> : null}
        {dockTab === "tests" ? <TestsPanel /> : null}
        {dockTab === "agent" ? <AgentPanel dockMode /> : null}
        {dockTab === "events" ? <EventsPanel /> : null}
      </div>
    </section>
  );
}
