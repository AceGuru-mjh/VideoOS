// BottomDock: tabbed container — Diagnostics | Tests | Agent | Events.
import { useI18n } from "../i18n";
import { useStudio } from "../store";
import type { DockTab } from "../store";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TestsPanel } from "./TestsPanel";
import { AgentPanel } from "./AgentPanel";
import { EventsPanel } from "./EventsPanel";

const TABS: Array<DockTab> = ["diagnostics", "tests", "agent", "events"];

export function BottomDock(): JSX.Element {
  const { t } = useI18n();
  const dockTab = useStudio((s) => s.dockTab);
  const setDockTab = useStudio((s) => s.setDockTab);
  const errorCount = useStudio((s) => (s.compile?.diagnostics ?? []).filter((d) => d.level === "error").length);
  const failedTests = useStudio((s) => s.tests?.totalFailed ?? 0);

  return (
    <section className="dock" aria-label={t("dock.ariaLabel")}>
      <div className="dock-tabs" role="tablist">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={dockTab === id}
            className={`dock-tab${dockTab === id ? " active" : ""}`}
            onClick={() => setDockTab(id)}
          >
            {t(`dock.${id}`)}
            {id === "diagnostics" && errorCount > 0 ? <span className="badge err">{errorCount}</span> : null}
            {id === "tests" && failedTests > 0 ? <span className="badge err">{failedTests}</span> : null}
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
