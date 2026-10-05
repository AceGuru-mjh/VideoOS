// EventsPanel: raw WS event feed (last 200), type filter, monospace rows.
import type { ServerEvent } from "../api";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Chip } from "./ui";

const FILTERS = ["all", "server", "vap", "compile", "render-progress", "render-done", "render-error", "test-done", "agent-done"] as const;

function summarize(e: ServerEvent): string {
  switch (e.type) {
    case "server":
      return e.message;
    case "vap":
      return `${e.event.kind}${e.event.tool !== undefined ? ` ${e.event.tool}` : ""}${
        e.event.detail !== undefined ? ` ${JSON.stringify(e.event.detail).slice(0, 110)}` : ""
      }`;
    case "compile":
      return `${e.ok ? "ok" : "FAILED"} · ${e.totalFrames}f / ${e.durationSeconds.toFixed(1)}s`;
    case "render-progress":
      return `${e.phase} · frame ${e.frame}/${e.totalFrames}`;
    case "render-done":
      return `${e.frames} frames · cache ${e.cacheHits}✓/${e.cacheMisses}✗ · ${e.video}`;
    case "render-error":
      return e.error;
    case "test-done":
      return `${e.totalPassed} passed / ${e.totalFailed} failed`;
    case "agent-done":
      return `${e.ok ? "ok" : "FAILED"} · ${e.toolCallCount} tools · ${e.summary.slice(0, 90)}`;
    // v0.2 §3 chat agent loop
    case "agent-run-start":
      return `run ${e.runId.slice(0, 8)} · session ${e.sessionId.slice(0, 8)}`;
    case "agent-text":
      return `text · ${e.text.slice(0, 100)}`;
    case "agent-tool":
      return `${e.name} ${e.status}${e.durationMs !== undefined ? ` · ${e.durationMs}ms` : ""}`;
    case "agent-run-done":
      return `${e.ok ? "ok" : "stopped"} · ${e.steps} steps${e.error !== undefined ? ` · ${e.error.slice(0, 80)}` : ""}`;
    // v0.2 §6 permission confirm flow (S4) — protocol-shaped rows, technical strings stay as-is
    case "agent-confirm":
      return `${e.tool.name} · confirm ${e.confirmId.slice(0, 8)} · run ${e.runId.slice(0, 8)}`;
    case "agent-resolved":
      return `${e.decision} · ${e.confirmId.slice(0, 8)}`;
  }
}

export function EventsPanel(): JSX.Element {
  const { t } = useI18n();
  const events = useStudio((s) => s.events);
  const eventFilter = useStudio((s) => s.eventFilter);
  const setEventFilter = useStudio((s) => s.setEventFilter);

  const shown = eventFilter === "all" ? events : events.filter((e) => e.type === eventFilter);

  return (
    <div className="events-panel">
      <div className="events-toolbar">
        <Chip>{events.length}/200</Chip>
        <label className="sr-only" htmlFor="event-filter">
          {t("events.filterLabel")}
        </label>
        <select id="event-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="events-list" role="log" aria-label={t("events.logAria")}>
        {shown.length === 0 ? <div className="empty-note">{t("events.empty")}</div> : null}
        {shown.map((e, i) => (
          <div key={`${i}-${e.type}`} className="event-row">
            <span className={`event-type ${e.type}`}>{e.type}</span>
            <span className="event-summary">{summarize(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
