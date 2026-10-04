// StatusBar: compile / tests / render state (left), canvas·fps / ws / version (right).
import * as api from "../api";
import { useStudio } from "../store";

export function StatusBar(): JSX.Element {
  const compile = useStudio((s) => s.compile);
  const compiling = useStudio((s) => s.compiling);
  const compileError = useStudio((s) => s.compileError);
  const tests = useStudio((s) => s.tests);
  const testsRunning = useStudio((s) => s.testsRunning);
  const renderStatus = useStudio((s) => s.renderStatus);
  const lastRender = useStudio((s) => s.lastRender);
  const wsConnected = useStudio((s) => s.wsConnected);
  const wsCount = useStudio((s) => s.wsCount);
  const serverVersion = useStudio((s) => s.serverVersion);
  const setDockTab = useStudio((s) => s.setDockTab);
  const openRenderDialog = useStudio((s) => s.openRenderDialog);

  const errorCount = (compile?.diagnostics ?? []).filter((d) => d.level === "error").length;
  const warningCount = (compile?.diagnostics ?? []).filter((d) => d.level === "warning").length;

  let compileItem: JSX.Element;
  if (compiling) {
    compileItem = <span className="status-item">compiling…</span>;
  } else if (compile !== null && compile.ok) {
    compileItem = (
      <span className="status-item ok" title={`${errorCount} errors, ${warningCount} warnings`}>
        ✓ compiled {compile.totalFrames}f/{compile.durationSeconds.toFixed(1)}s
      </span>
    );
  } else if (compile !== null || compileError !== null) {
    compileItem = (
      <button type="button" className="status-item err" title={compileError ?? "compile failed"} onClick={() => setDockTab("diagnostics")}>
        ✗ {errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "compile failed"}
      </button>
    );
  } else {
    compileItem = <span className="status-item">not compiled</span>;
  }

  let testsItem: JSX.Element;
  if (testsRunning) {
    testsItem = <span className="status-item">tests running…</span>;
  } else if (tests !== null) {
    const total = tests.totalPassed + tests.totalFailed;
    testsItem = (
      <button
        type="button"
        className={`status-item${tests.totalFailed > 0 ? " err" : " ok"}`}
        title={`${tests.totalPassed} passed / ${tests.totalFailed} failed`}
        onClick={() => setDockTab("tests")}
      >
        tests: {tests.totalPassed}/{total}
      </button>
    );
  } else {
    testsItem = <span className="status-item">tests: —</span>;
  }

  let renderItem: JSX.Element;
  if (renderStatus?.running === true && renderStatus.progress !== null) {
    const pct = renderStatus.progress.totalFrames > 0 ? Math.round((renderStatus.progress.frame / renderStatus.progress.totalFrames) * 100) : 0;
    renderItem = (
      <button type="button" className="status-item" onClick={() => openRenderDialog(true)}>
        render {pct}%
      </button>
    );
  } else if (renderStatus?.running === true) {
    renderItem = (
      <button type="button" className="status-item" onClick={() => openRenderDialog(true)}>
        render starting…
      </button>
    );
  } else if (lastRender !== null) {
    renderItem = (
      <button type="button" className="status-item ok" title={lastRender.video} onClick={() => openRenderDialog(true)}>
        ▶ {api.basename(lastRender.video)}
      </button>
    );
  } else {
    renderItem = <span className="status-item">render idle</span>;
  }

  const geom =
    compile?.width !== undefined && compile?.height !== undefined && compile?.fps !== undefined
      ? `${compile.width}×${compile.height} · ${compile.fps}fps`
      : "—";

  return (
    <footer className="statusbar">
      {compileItem}
      {testsItem}
      {renderItem}
      <span className="right">
        <span>{geom}</span>
        <span className={wsConnected ? "status-item ok" : "status-item err"}>
          {wsConnected ? "●" : "○"} {wsConnected ? `connected (${wsCount})` : "disconnected"}
        </span>
        <span>videoos {serverVersion.length > 0 ? serverVersion : "0.1.0"}</span>
      </span>
    </footer>
  );
}
