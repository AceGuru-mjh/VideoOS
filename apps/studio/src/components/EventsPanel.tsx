// EventsPanel: raw WS event feed (last 200), type filter, monospace rows.
import type { ServerEvent } from "../api";
import { useStudio } from "../store";
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
  }
}

export function EventsPanel(): JSX.Element {
  const events = useStudio((s) => s.events);
  const eventFilter = useStudio((s) => s.eventFilter);
  const setEventFilter = useStudio((s) => s.setEventFilter);

  const shown = eventFilter === "all" ? events : events.filter((e) => e.type === eventFilter);

  return (
    <div className="events-panel">
      <div className="events-toolbar">
        <Chip>{events.length}/200</Chip>
        <label className="sr-only" htmlFor="event-filter">
          filter events
        </label>
        <select id="event-filter" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      <div className="events-list" role="log" aria-label="server events">
        {shown.length === 0 ? <div className="empty-note">no events yet — they stream in over the websocket</div> : null}
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
