// ContextPanel (S5 · v0.2 §6, issues #55/#56): the right column — upgraded from
// the S3 minimal panel into the tabbed visualization panel:
//   预览 (ChatPreview · compact frame player) | 管线 (TaskPipeline · 6-step
//   pipeline) | 用量 (UsagePanel · tokens / renders / cache / trend)
// Panel geometry & responsive behavior unchanged (310px, hidden <1200px).
// The last selected tab is remembered per session (component state); the 管线
// tab gets a live dot while a run is in flight.
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../../store";
import { ChatPreview } from "./ChatPreview";
import { TaskPipeline } from "./TaskPipeline";
import { UsagePanel } from "./UsagePanel";

type PanelTab = "preview" | "pipeline" | "usage";

const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: "preview", label: "预览" },
  { id: "pipeline", label: "管线" },
  { id: "usage", label: "用量" },
];

const DEFAULT_TAB: PanelTab = "preview";

export function ContextPanel(): JSX.Element {
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

  return (
    <aside className="chat-context" aria-label="上下文面板">
      <div className="ctxv-tabs" role="tablist" aria-label="可视化面板">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ctxv-tab${tab === t.id ? " on" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.id === "pipeline" && liveRunning ? <span className="ctxv-live-dot" aria-label="执行中" /> : null}
          </button>
        ))}
      </div>
      <div className="ctxv-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label ?? "面板"}>
        {tab === "preview" ? <ChatPreview /> : null}
        {tab === "pipeline" ? <TaskPipeline /> : null}
        {tab === "usage" ? <UsagePanel /> : null}
      </div>
    </aside>
  );
}
