// ContextPanel (S5 · v0.2 §6, issues #55/#56): the right column — upgraded from
// the S3 minimal panel into the tabbed visualization panel:
//   预览 (ChatPreview · compact frame player) | 管线 (TaskPipeline · 6-step
//   pipeline) | 用量 (UsagePanel · tokens / renders / cache / trend)
// Panel geometry & responsive behavior unchanged (310px, hidden <1200px).
// The last selected tab is remembered per session (component state); the 管线
// tab gets a live dot while a run is in flight.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useStudio } from "../../store";
import { ChatPreview } from "./ChatPreview";
import { TaskPipeline } from "./TaskPipeline";
import { UsagePanel } from "./UsagePanel";

type PanelTab = "preview" | "pipeline" | "usage";

const TAB_IDS: readonly PanelTab[] = ["preview", "pipeline", "usage"];

const DEFAULT_TAB: PanelTab = "preview";

export function ContextPanel(): JSX.Element {
  const { t } = useI18n();
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const activeRun = useStudio((s) => s.activeRun);
  const [tab, setTab] = useState<PanelTab>(DEFAULT_TAB);

  // remember the last tab per session（组件态，不进全局 store）
  const tabMemory = useRef<Map<string, PanelTab>>(new Map());
  useEffect(() => {
    const key = currentSessionId ?? "_none";
    setTab(tabMemory.current.get(key) ?? DEFAULT_TAB);
  }, [currentSessionId]);

  const selectTab = (next: PanelTab): void => {
    tabMemory.current.set(currentSessionId ?? "_none", next);
    setTab(next);
  };

  const liveRunning =
    activeRun !== null && activeRun.status === "running" && activeRun.sessionId === currentSessionId;

  // 页签文案直查词典（字面量键可被覆盖测试静态扫描；切语言即时生效）
  const tabLabels: Record<PanelTab, string> = {
    preview: t("context.tabPreview"),
    pipeline: t("context.tabPipeline"),
    usage: t("context.tabUsage"),
  };

  return (
    <aside className="chat-context" aria-label={t("context.panelAria")}>
      <div className="ctxv-tabs" role="tablist" aria-label={t("context.tabsAria")}>
        {TAB_IDS.map((tabId) => (
          <button
            key={tabId}
            type="button"
            role="tab"
            aria-selected={tab === tabId}
            className={`ctxv-tab${tab === tabId ? " on" : ""}`}
            onClick={() => selectTab(tabId)}
          >
            {tabLabels[tabId]}
            {tabId === "pipeline" && liveRunning ? (
              <span className="ctxv-live-dot" aria-label={t("context.runningAria")} />
            ) : null}
          </button>
        ))}
      </div>
      <div className="ctxv-body" role="tabpanel" aria-label={tabLabels[tab]}>
        {tab === "preview" ? <ChatPreview /> : null}
        {tab === "pipeline" ? <TaskPipeline /> : null}
        {tab === "usage" ? <UsagePanel /> : null}
      </div>
    </aside>
  );
}
