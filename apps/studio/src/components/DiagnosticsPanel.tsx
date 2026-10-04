// DiagnosticsPanel: compiler diagnostics with severity colors, level filter,
// click → open the entry file in the editor.
import { useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { Chip } from "./ui";

type Filter = "all" | "error" | "warning" | "info";

const SEVERITY_GLYPH: Record<api.Diagnostic["level"], string> = {
  error: "✗",
  warning: "⚠",
  info: "ⓘ",
};

export function DiagnosticsPanel(): JSX.Element {
  const [filter, setFilter] = useState<Filter>("all");
  const compile = useStudio((s) => s.compile);
  const compileError = useStudio((s) => s.compileError);
  const project = useStudio((s) => s.project);
  const setActiveTab = useStudio((s) => s.setActiveTab);
  const loadFile = useStudio((s) => s.loadFile);

  const diagnostics = compile?.diagnostics ?? [];
  const counts = {
    error: diagnostics.filter((d) => d.level === "error").length,
    warning: diagnostics.filter((d) => d.level === "warning").length,
    info: diagnostics.filter((d) => d.level === "info").length,
  };
  const shown = filter === "all" ? diagnostics : diagnostics.filter((d) => d.level === filter);

  const revealEntry = (): void => {
    if (project === null) return;
    void loadFile(project.entry);
    setActiveTab(project.entry);
  };

  return (
    <div className="diagnostics-panel">
      <div className="diag-toolbar">
        <Chip tone={counts.error > 0 ? "err" : "ok"}>{counts.error} errors</Chip>
        <Chip tone={counts.warning > 0 ? "warn" : "default"}>{counts.warning} warnings</Chip>
        <Chip tone={counts.info > 0 ? "info" : "default"}>{counts.info} info</Chip>
        <label className="sr-only" htmlFor="diag-filter">
          filter diagnostics
        </label>
        <select id="diag-filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All</option>
          <option value="error">Errors</option>
          <option value="warning">Warnings</option>
          <option value="info">Info</option>
        </select>
      </div>

      {compileError !== null ? (
        <div className="error-text" role="alert">
          {compileError}
        </div>
      ) : null}

      {shown.length === 0 && compileError === null ? (
        <div className="empty-note">no diagnostics — everything looks good</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {shown.map((d, i) => (
            <li key={`${d.code}-${i}`}>
              <div
                className="diag-row"
                role="button"
                tabIndex={0}
                title="open entry file"
                onClick={revealEntry}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") revealEntry();
                }}
              >
                <span className={`diag-icon ${d.level}`}>{SEVERITY_GLYPH[d.level]}</span>
                <span className="code">{d.code}</span>
                <span className="message">{d.message}</span>
                {d.scene !== undefined ? <Chip title="scene">{d.scene}</Chip> : null}
                {d.layer !== undefined ? <Chip title="layer">{d.layer}</Chip> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
