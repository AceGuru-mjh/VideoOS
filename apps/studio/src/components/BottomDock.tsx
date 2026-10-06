// BottomDock: tabbed container — Diagnostics | Tests | Agent | Events | Analytics.
// Analytics 标签（可视化套件）内含二级分段：项目分析（AnalyticsPanel）/ 系统健康（HealthPanel）。
import { useStudio } from "../store";
import type { DockTab } from "../store";
import { useI18n } from "../i18n";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TestsPanel } from "./TestsPanel";
import { AgentPanel } from "./AgentPanel";
import { EventsPanel } from "./EventsPanel";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { HealthPanel } from "./HealthPanel";

const TABS: Array<{ id: DockTab }> = [
  { id: "diagnostics" },
  { id: "tests" },
  { id: "agent" },
  { id: "events" },
  { id: "analytics" },
];

export function BottomDock(): JSX.Element {
  const { t } = useI18n();
  const dockTab = useStudio((s) => s.dockTab);
  const setDockTab = useStudio((s) => s.setDockTab);
  const errorCount = useStudio((s) => (s.compile?.diagnostics ?? []).filter((d) => d.level === "error").length);
  const failedTests = useStudio((s) => s.tests?.totalFailed ?? 0);
  const analyticsView = useStudio((s) => (s.dockTab === "analytics" ? s.analyticsView : "project"));
  const setAnalyticsView = useStudio((s) => s.setAnalyticsView);

  return (
    <section className="dock" aria-label={t("dock.regionAria")}>
      <div className="dock-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={dockTab === tab.id}
            className={`dock-tab${dockTab === tab.id ? " active" : ""}`}
            onClick={() => setDockTab(tab.id)}
          >
            {t(`dock.${tab.id}`)}
            {tab.id === "diagnostics" && errorCount > 0 ? <span className="badge err">{errorCount}</span> : null}
            {tab.id === "tests" && failedTests > 0 ? <span className="badge err">{failedTests}</span> : null}
          </button>
        ))}
        {dockTab === "analytics" ? (
          <div className="dock-subtabs" role="group" aria-label={t("analytics.subtabsAria")}>
            <button
              type="button"
              className={`dock-subtab${analyticsView === "project" ? " active" : ""}`}
              aria-pressed={analyticsView === "project"}
              onClick={() => setAnalyticsView("project")}
            >
              {t("analytics.subtabProject")}
            </button>
            <button
              type="button"
              className={`dock-subtab${analyticsView === "health" ? " active" : ""}`}
              aria-pressed={analyticsView === "health"}
              onClick={() => setAnalyticsView("health")}
            >
              {t("analytics.subtabHealth")}
            </button>
          </div>
        ) : null}
      </div>
      <div className="dock-body" role="tabpanel">
        {dockTab === "diagnostics" ? <DiagnosticsPanel /> : null}
        {dockTab === "tests" ? <TestsPanel /> : null}
        {dockTab === "agent" ? <AgentPanel dockMode /> : null}
        {dockTab === "events" ? <EventsPanel /> : null}
        {dockTab === "analytics" ? (
          analyticsView === "health" ? (
            <HealthPanel />
          ) : (
            <AnalyticsPanel />
          )
        ) : null}
      </div>
    </section>
  );
}
